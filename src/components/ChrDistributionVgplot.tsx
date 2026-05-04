// vgplot-based chr16 distribution with brush-driven, high-resolution zoom.
//
// Overview (top): 250-bin (~360 kb) precomputed table covering full chr16.
//                 Fill encodes NPMI partner count (YlOrRd). Owns the
//                 `vg.intervalX({as: $brush})` brush.
// Zoom (bottom):  separate plot beside the overview. 250 bins recomputed
//                 on demand for the brushed range — 5 Mb brush → 20 kb
//                 bins, 1 Mb → 4 kb. Fed by useChrDistZoomBins.
//
// One containerRef wraps both plots; the Selection persists across the
// component's lifetime via a ref so subscribing to its 'value' events
// captures the brushed range without disturbing the brush UI.

import { useEffect, useMemo, useRef, useState } from 'react';
import * as vg from '@uwdata/vgplot';
import { loadObjects } from '@uwdata/mosaic-sql';
import { brushX, type D3BrushEvent } from 'd3-brush';
import { select } from 'd3-selection';
import {
  CHR16_END,
  composeBins,
  useChr16PartnerPositions,
  useChr16UniverseBins,
} from '../hooks/useChrDistribution';
import { useChrDistZoomBins } from '../hooks/useChrDistZoomBins';
import { useMosaicCoordinator } from '../hooks/useMosaicCoordinator';
import type { PickedRegion } from './RegionUMAP';
import { UMAPCard } from './UMAPHeaderChip';

const N_BINS_OVERVIEW = 250;
const N_BINS_ZOOM = 250;
const OVERVIEW_TABLE_BASE = 'dict_chr16_dist';
// Mirror the vg.margins values below so the d3-brush extent matches the
// plot area exactly. Update both together if the layout changes.
const PLOT_HEIGHT = 160;
const MARGIN_LEFT = 56;
const MARGIN_RIGHT = 16;
const MARGIN_TOP = 12;
const MARGIN_BOTTOM = 30;
// Default zoom range so the bottom plot has something useful to show
// before the user has brushed: 5 Mb centred on the picked region's
// midpoint, or the first 5 Mb of chr16 if nothing is picked.
const DEFAULT_ZOOM_SPAN = 5_000_000;

export type ChrDistributionVgplotProps = {
  picked: PickedRegion | null;
  customFileIds?: ReadonlyArray<string> | null;
};

export function ChrDistributionVgplot({
  picked,
  customFileIds,
}: ChrDistributionVgplotProps) {
  const overviewRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<HTMLDivElement>(null);
  const { coordinator, isReady } = useMosaicCoordinator();
  const [width, setWidth] = useState(0);

  // ---- overview bins (precomputed once across full chr16) -------------
  const { bins: universe } = useChr16UniverseBins(N_BINS_OVERVIEW);
  const { positions: partnerPositions } = useChr16PartnerPositions(
    picked?.token_id ?? null,
    'NPMI',
    30,
    customFileIds,
  );
  const overviewBins = useMemo(
    () => composeBins(universe, partnerPositions, N_BINS_OVERVIEW),
    [universe, partnerPositions],
  );
  const maxPartnerOverview = useMemo(() => {
    if (!overviewBins) return 1;
    return Math.max(1, ...overviewBins.map((b) => b.partners));
  }, [overviewBins]);

  const overviewCounterRef = useRef(0);
  const previousOverviewRef = useRef<string | null>(null);
  const [overviewTable, setOverviewTable] = useState<string | null>(null);
  useEffect(() => {
    if (!isReady || !overviewBins) return;
    let cancelled = false;
    overviewCounterRef.current += 1;
    const tableName = `${OVERVIEW_TABLE_BASE}_${overviewCounterRef.current}`;
    const previous = previousOverviewRef.current;
    coordinator
      .exec(
        loadObjects(
          tableName,
          overviewBins as unknown as Record<string, unknown>[],
        ),
      )
      .then(() => {
        if (cancelled) return;
        previousOverviewRef.current = tableName;
        if (previous) {
          coordinator.exec(`DROP TABLE IF EXISTS ${previous}`).catch(() => {});
        }
        setOverviewTable(tableName);
      })
      .catch(() => {
        /* ignored — table-name versioning means a transient failure
           doesn't break subsequent rebuilds */
      });
    return () => {
      cancelled = true;
    };
  }, [coordinator, isReady, overviewBins]);

  // brushed range comes from a d3-brush attached to the rendered SVG
  // (vgplot's Selection-based intervalX wasn't reliably emitting events
  // through to React, so we wire it ourselves).
  const [brushRange, setBrushRange] = useState<[number, number] | null>(null);

  // Effective zoom range — brushed if present, else a default 5 Mb window
  // centred on the picked region (or the first 5 Mb of chr16).
  const effectiveZoomRange = useMemo<[number, number]>(() => {
    if (brushRange) return brushRange;
    const center = picked?.midpoint ?? DEFAULT_ZOOM_SPAN / 2;
    const lo = Math.max(0, center - DEFAULT_ZOOM_SPAN / 2);
    const hi = Math.min(CHR16_END, lo + DEFAULT_ZOOM_SPAN);
    return [lo, hi];
  }, [brushRange, picked]);

  // ---- zoom bins (recomputed for the active range) --------------------
  const {
    tableName: zoomTable,
    version: zoomVersion,
    maxPartner: maxPartnerZoom,
  } = useChrDistZoomBins(
    effectiveZoomRange,
    picked,
    customFileIds,
    N_BINS_ZOOM,
  );

  // ---- container width ------------------------------------------------
  useEffect(() => {
    const el = overviewRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        setWidth(Math.max(0, Math.floor(e.contentRect.width)));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- mount overview plot + brush ------------------------------------
  useEffect(() => {
    const el = overviewRef.current;
    if (!el || !overviewTable) return;
    const w = width || el.clientWidth || 600;

    const overview = vg.plot(
      vg.frame({ stroke: '#ddd' }),
      vg.rectY(vg.from(overviewTable), {
        x1: 'start',
        x2: 'end',
        y: 'universe',
        fill: 'partners',
        stroke: '#888',
        strokeWidth: 0.25,
      }),
      ...(picked
        ? [
            vg.ruleX([picked.midpoint], {
              stroke: 'currentColor',
              strokeWidth: 1.5,
              strokeDasharray: '3,2',
            }),
          ]
        : []),
      vg.colorScheme('YlOrRd'),
      vg.colorDomain([0, maxPartnerOverview]),
      vg.xDomain([0, CHR16_END]),
      vg.xLabel('chr16 position'),
      vg.xTickFormat((d: number) => `${(d / 1e6).toFixed(0)}M`),
      vg.yLabel(
        `universe regions / ${(CHR16_END / N_BINS_OVERVIEW / 1000).toFixed(0)}-kb bin`,
      ),
      vg.yTickFormat('s'),
      vg.width(w),
      vg.height(PLOT_HEIGHT),
      vg.margins({
        left: MARGIN_LEFT,
        right: MARGIN_RIGHT,
        top: MARGIN_TOP,
        bottom: MARGIN_BOTTOM,
      }),
      vg.style({ fontSize: '9px' }),
    );

    el.appendChild(overview);

    // vgplot renders its <svg> asynchronously into the wrapper <div>, so
    // we have to wait for it to appear before mounting the brush. Use a
    // MutationObserver scoped to the wrapper; bail after a short timeout
    // so we don't leak observers if rendering never completes.
    let cleanupBrush: (() => void) | null = null;
    const attachBrush = (svg: SVGSVGElement) => {
      const px0 = MARGIN_LEFT;
      const px1 = w - MARGIN_RIGHT;
      const innerSpan = px1 - px0;
      const dataToPixel = (d: number) =>
        px0 + (d / CHR16_END) * innerSpan;
      const pixelToData = (p: number) =>
        ((p - px0) / innerSpan) * CHR16_END;
      const brush = brushX<unknown>()
        .extent([
          [px0, MARGIN_TOP],
          [px1, PLOT_HEIGHT - MARGIN_BOTTOM],
        ])
        .on('end', (event: D3BrushEvent<unknown>) => {
          if (!event.selection) {
            setBrushRange(null);
            return;
          }
          const [a, b] = event.selection as [number, number];
          const lo = Math.max(0, Math.min(pixelToData(a), pixelToData(b)));
          const hi = Math.min(
            CHR16_END,
            Math.max(pixelToData(a), pixelToData(b)),
          );
          setBrushRange([lo, hi]);
        });
      const layer = select(svg)
        .append('g')
        .attr('class', 'chr-brush')
        .style('cursor', 'crosshair');
      layer.call(brush);
      if (brushRange) {
        layer.call(brush.move, [
          dataToPixel(brushRange[0]),
          dataToPixel(brushRange[1]),
        ]);
      }
      cleanupBrush = () => layer.remove();
    };

    const existing =
      overview instanceof SVGElement
        ? (overview as unknown as SVGSVGElement)
        : (overview.querySelector('svg') as SVGSVGElement | null);
    if (existing) {
      attachBrush(existing);
    }
    let observer: MutationObserver | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    if (!cleanupBrush && !(overview instanceof SVGElement)) {
      observer = new MutationObserver(() => {
        const svg = overview.querySelector('svg') as SVGSVGElement | null;
        if (svg) {
          observer?.disconnect();
          observer = null;
          attachBrush(svg);
        }
      });
      observer.observe(overview, { childList: true, subtree: true });
      timeoutId = setTimeout(() => {
        observer?.disconnect();
        observer = null;
      }, 5000);
    }

    return () => {
      observer?.disconnect();
      if (timeoutId) clearTimeout(timeoutId);
      cleanupBrush?.();
      overview.remove();
    };
    // brushRange intentionally omitted — we don't want the plot to
    // remount on every brush update; we only restore it once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, overviewTable, maxPartnerOverview, picked]);

  // ---- mount zoom plot ------------------------------------------------
  useEffect(() => {
    const el = zoomRef.current;
    if (!el || !zoomTable) return;
    const w = width || el.clientWidth || 600;
    const span = effectiveZoomRange[1] - effectiveZoomRange[0];
    const binWidth = span / N_BINS_ZOOM;
    const binWidthLabel =
      binWidth >= 1000
        ? `${Math.round(binWidth / 1000)}-kb`
        : `${Math.round(binWidth)}-bp`;

    const zoom = vg.plot(
      vg.frame({ stroke: '#ddd' }),
      vg.rectY(vg.from(zoomTable), {
        x1: 'start',
        x2: 'end',
        y: 'universe',
        fill: 'partners',
        stroke: '#888',
        strokeWidth: 0.25,
      }),
      ...(picked &&
      picked.midpoint >= effectiveZoomRange[0] &&
      picked.midpoint <= effectiveZoomRange[1]
        ? [
            vg.ruleX([picked.midpoint], {
              stroke: 'currentColor',
              strokeWidth: 1.5,
              strokeDasharray: '3,2',
            }),
          ]
        : []),
      vg.colorScheme('YlOrRd'),
      vg.colorDomain([0, maxPartnerZoom]),
      vg.xDomain(effectiveZoomRange),
      vg.xLabel('chr16 zoom'),
      vg.xTickFormat((d: number) => `${(d / 1e6).toFixed(2)}M`),
      vg.yLabel(`universe regions / ${binWidthLabel} bin`),
      vg.yTickFormat('s'),
      vg.width(w),
      vg.height(PLOT_HEIGHT),
      vg.margins({
        left: MARGIN_LEFT,
        right: MARGIN_RIGHT,
        top: MARGIN_TOP,
        bottom: MARGIN_BOTTOM,
      }),
      vg.style({ fontSize: '9px' }),
    );

    el.appendChild(zoom);
    return () => {
      zoom.remove();
    };
  }, [
    width,
    zoomTable,
    zoomVersion,
    maxPartnerZoom,
    effectiveZoomRange,
    picked,
  ]);

  const poolLabel =
    customFileIds && customFileIds.length > 0
      ? `${customFileIds.length.toLocaleString()} files`
      : 'full corpus';
  const zoomLabel = brushRange
    ? `chr16 ${(brushRange[0] / 1e6).toFixed(2)}–${(brushRange[1] / 1e6).toFixed(2)}M`
    : `default ${(effectiveZoomRange[0] / 1e6).toFixed(1)}–${(effectiveZoomRange[1] / 1e6).toFixed(1)}M (drag to change)`;

  return (
    <UMAPCard
      title="chr16 distribution"
      suffix={`(pool: ${poolLabel} · ${zoomLabel})`}
    >
      <div className="p-2 flex flex-col gap-2">
        <div ref={overviewRef} className="w-full" />
        <div ref={zoomRef} className="w-full" />
      </div>
    </UMAPCard>
  );
}
