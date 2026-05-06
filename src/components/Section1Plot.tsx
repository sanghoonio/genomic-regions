// Section 1 — universe band + per-file activity, with three rendering
// modes that mirror the reference page:
//   continuous → bigwig signal as faceted area charts (per-file y scale)
//   peaks      → BED peak rectangles colored by assay
//   tokens     → universe tokens that fired in each file, colored by class
// The plot mounts via useEffect+ref so cleanup is explicit (Strict Mode).

import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import * as Plot from '@observablehq/plot';
import type { CandidateInterval } from '../lib/candidateIntervals';
import type { FeaturedFile } from '../lib/types';
import {
  useIntervalRegions,
  intervalActivations,
} from '../hooks/useIntervalSection1';
import {
  useIntervalSignal,
  useIntervalTracks,
} from '../hooks/useIntervalSignalAndTracks';
import {
  SCREEN_CLASS_ORDER,
  SCREEN_CLASS_COLOR_RANGE,
  ASSAY_COLORS,
  classColor,
} from '../lib/colors';
export type Section1Mode = 'continuous' | 'peaks' | 'tokens';
import type { PickedRegion } from './RegionUMAP';

const UNIVERSE_LABEL = 'UNIVERSE';
const PAD_LABEL = ' '; // invisible facet pad row so axis ticks clear the bottom

export type Section1PlotProps = {
  interval: CandidateInterval;
  files: FeaturedFile[] | null;
  mode: Section1Mode;
  /** Fires when the user clicks a universe rect or a token-activation
   * bar. The supplied PickedRegion is shaped to match what RegionUMAP
   * emits, so callers can wire this directly into the same picked state. */
  onPick?: (region: PickedRegion) => void;
  /** Controls slot rendered in the SVG's marginTop band, anchored at
   * the plot's left edge. Sits inline with the swatch legend on the
   * right so the row reads as a single header strip for the plot. */
  controls?: ReactNode;
};

export function Section1Plot({
  interval,
  files,
  mode,
  onPick,
  controls,
}: Section1PlotProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { regions, loading: regionsLoading, error: regionsError } =
    useIntervalRegions(interval);
  // Continuous + peaks data only exists for parquet-sourced intervals.
  const isParquetInterval = interval.source === 'parquet';
  const { rows: signalRows } = useIntervalSignal(
    isParquetInterval && mode === 'continuous' ? interval.interval_id : null,
  );
  const { rows: peakRows } = useIntervalTracks(
    isParquetInterval && mode === 'peaks' ? interval.interval_id : null,
  );

  const universeRows = useMemo(() => {
    if (!regions) return [];
    return regions.map((r) => ({ ...r, row: UNIVERSE_LABEL }));
  }, [regions]);

  const tokenActivations = useMemo(() => {
    if (mode !== 'tokens') return null;
    return intervalActivations(regions, files);
  }, [mode, regions, files]);

  const allFileLabels = useMemo(() => {
    if (!files) return [] as string[];
    return Array.from(new Set(files.map(fileLabelOf))).sort();
  }, [files]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !regions) return;

    // Layout values mirror genomic-regions-observable/src/index.md exactly.
    // The user tuned these for pixel-perfect axis alignment in Observable;
    // any divergence breaks the alignment.
    const isContinuous = mode === 'continuous';
    const isTokens = mode === 'tokens';
    const baseRows = [UNIVERSE_LABEL, ...allFileLabels];
    const yDomain = isContinuous ? [...baseRows, PAD_LABEL] : baseRows;
    // plotHeight intentionally uses baseRows.length (N), not yDomain.length —
    // continuous's PAD facet shares the existing total area so toggling
    // doesn't reflow surrounding content.
    const plotHeight = Math.max(220, 20 * baseRows.length);

    const xScale = {
      domain: [interval.start, interval.end],
      label: interval.chrom,
      grid: true,
      tickFormat: (d: number) => `${(d / 1e6).toFixed(2)}M`,
      // Default x axis stays in non-continuous; suppressed only in continuous
      // mode where the bottom rule of the PAD facet would otherwise overlap.
      ...(isContinuous ? { axis: null as null } : {}),
    };

    const ySpec = isContinuous
      ? {
          y: { axis: null as null },
          fy: {
            domain: yDomain,
            label: null as null,
            padding: 0,
            axis: null as null,
          },
        }
      : { y: { label: null as null, domain: yDomain, padding: 0.2 } };

    const colorSpec = isTokens
      ? {
          domain: SCREEN_CLASS_ORDER,
          range: SCREEN_CLASS_COLOR_RANGE,
          legend: false,
        }
      : {
          domain: Object.keys(ASSAY_COLORS),
          range: Object.values(ASSAY_COLORS),
          legend: false,
        };

    const universeMarks = [
      Plot.rect(universeRows, {
        x1: 'start',
        x2: 'end',
        ...(isContinuous
          ? { fy: () => UNIVERSE_LABEL, y1: 0, y2: 1 }
          : { y: 'row' }),
        // Function fill (returns a color string) bypasses Plot's
        // categorical scale entirely — matches the Observable original's
        // pixel-perfect layout. Column-name fills here route through the
        // scale and shift internal padding.
        fill: isTokens
          ? (d: { cclass: string }) => classColor(d.cclass)
          : 'black',
        insetTop: 2,
        insetBottom: 2,
        clip: true,
        title: (d: { region: string; cclass: string; start: number; end: number }) =>
          `${d.region} · ${d.cclass} · ${(d.end - d.start).toLocaleString()} bp`,
      }),
    ];

    const guideMarks = isContinuous
      ? []
      : [
          Plot.ruleY(allFileLabels, { stroke: '#eee', strokeWidth: 1 }),
          Plot.ruleY([UNIVERSE_LABEL], { stroke: '#888', strokeWidth: 1 }),
        ];

    const fileMarks = isContinuous
      ? [
          Plot.areaY(signalRows ?? [], {
            x: 'position',
            y: 'value',
            fy: 'file_label',
            fill: 'assay',
            fillOpacity: 0.85,
            curve: 'step',
            clip: true,
          }),
          // Invisible anchor so Plot allocates a real band for the pad row.
          Plot.rect([{}], {
            fy: () => PAD_LABEL,
            x1: interval.start,
            x2: interval.end,
            y1: 0,
            y2: 1,
            fillOpacity: 0,
          }),
          // With fy padding=0 the facets are flush; this draws a thin line
          // along the bottom of every non-pad facet so the rows are visually
          // delimited (data-driven so the pad row gets no border).
          Plot.ruleY(
            baseRows.map((label) => ({ fy: label, y: 0 })),
            { fy: 'fy', y: 'y', stroke: '#ddd', strokeWidth: 0.5 },
          ),
          // Custom y axis: tick marks + labels positioned near the bottom edge
          // of each non-pad band. Default axis is suppressed (`axis: null`)
          // since it centers in the band; `dy` shifts axisFy elements from
          // band center to its bottom rule. `ticks` restricts both tick marks
          // and labels to non-pad rows.
          Plot.axisFy({
            anchor: 'left',
            dy: 7.5,
            fontSize: 10,
            tickSize: 6,
            ticks: baseRows,
          }),
          // Custom x axis shifted 1px down — keeps tickFormat/label from the
          // scale config (which still drives the gridlines). labelOffset
          // bumped 1 above Plot's default so the title lands at +2 total
          // while the ticks stay at +1.
          Plot.axisX({
            anchor: 'bottom',
            dy: 3,
            tickFormat: (d: number) => `${(d / 1e6).toFixed(2)}M`,
            label: interval.chrom,
            labelOffset: 38,
          }),
        ]
      : mode === 'peaks'
        ? [
            Plot.barX(peakRows ?? [], {
              x1: 'peak_start',
              x2: 'peak_end',
              y: 'file_label',
              fill: 'assay',
              stroke: 'white',
              strokeWidth: 0.5,
              insetTop: 3,
              insetBottom: 3,
              clip: true,
              title: (d: {
                file_label: string;
                peak_start: number;
                peak_end: number;
              }) =>
                `${d.file_label}\npeak ${d.peak_start.toLocaleString()}–${d.peak_end.toLocaleString()} (${(d.peak_end - d.peak_start).toLocaleString()} bp)`,
            }),
          ]
        : tokenActivations
          ? [
              Plot.barX(tokenActivations, {
                x1: 'start',
                x2: 'end',
                y: 'file_label',
                fill: (d: { cclass: string }) => classColor(d.cclass),
                stroke: 'white',
                strokeWidth: 0.5,
                insetTop: 3,
                insetBottom: 3,
                clip: true,
                title: (d: {
                  file_label: string;
                  token_id: number;
                  cclass: string;
                  start: number;
                  end: number;
                }) =>
                  `${d.file_label}\ntoken ${d.token_id} (${d.cclass})\n${d.start.toLocaleString()}–${d.end.toLocaleString()}`,
              }),
            ]
          : [];

    const plot = Plot.plot({
      width: el.clientWidth || 900,
      height: plotHeight,
      marginLeft: 160,
      marginRight: 30,
      marginTop: 30,
      marginBottom: 40,
      // Shrinks default axis tick / label font from 10 → 9 across all
      // three views (continuous's custom axisFy/axisX marks pick this
      // up too via inheritance).
      style: { fontSize: '10px' },
      x: xScale,
      ...ySpec,
      color: colorSpec,
      marks: [...guideMarks, ...universeMarks, ...fileMarks],
    });

    el.appendChild(plot);

    // Wire click handlers on universe rects + token-activation bars so
    // selecting in Section 1 mirrors RegionUMAP's onPickedChange. We
    // walk the rendered SVG by mark order: universe rect is the first
    // <g aria-label="rect">, token activations are the first
    // <g aria-label="bar"> (in tokens mode). Plot preserves data order,
    // so universeRows[i] / tokenActivations[i] map to the i-th rect.
    const cleanups: Array<() => void> = [];
    if (onPick) {
      const svg = (plot.tagName === 'svg'
        ? (plot as unknown as SVGSVGElement)
        : (plot.querySelector('svg') as SVGSVGElement | null));
      const emit = (r: {
        token_id: number;
        region: string;
        cclass: string;
        start: number;
        end: number;
        umap_x: number;
        umap_y: number;
      }) => {
        onPick({
          token_id: r.token_id,
          region: r.region,
          cclass: r.cclass,
          start: r.start,
          end: r.end,
          midpoint: Math.round((r.start + r.end) / 2),
          umap_x: r.umap_x,
          umap_y: r.umap_y,
        });
      };
      if (svg) {
        const universeG = svg.querySelector(
          'g[aria-label="rect"]',
        ) as SVGGElement | null;
        if (universeG) {
          const rects = Array.from(universeG.querySelectorAll('rect'));
          rects.forEach((rect, i) => {
            const row = universeRows[i];
            if (!row) return;
            (rect as SVGRectElement).style.cursor = 'pointer';
            const handler = (e: Event) => {
              e.stopPropagation();
              emit(row);
            };
            rect.addEventListener('click', handler);
            cleanups.push(() => rect.removeEventListener('click', handler));
          });
        }
        if (isTokens && tokenActivations && regions) {
          const regionsByToken = new Map(
            regions.map((r) => [r.token_id, r]),
          );
          const barG = svg.querySelector(
            'g[aria-label="bar"]',
          ) as SVGGElement | null;
          if (barG) {
            const rects = Array.from(barG.querySelectorAll('rect'));
            rects.forEach((rect, i) => {
              const act = tokenActivations[i];
              if (!act) return;
              const region = regionsByToken.get(act.token_id);
              if (!region) return;
              (rect as SVGRectElement).style.cursor = 'pointer';
              const handler = (e: Event) => {
                e.stopPropagation();
                emit(region);
              };
              rect.addEventListener('click', handler);
              cleanups.push(() => rect.removeEventListener('click', handler));
            });
          }
        }
      }
    }

    return () => {
      cleanups.forEach((fn) => fn());
      plot.remove();
    };
  }, [
    interval.chrom,
    interval.start,
    interval.end,
    interval.interval_id,
    mode,
    regions,
    universeRows,
    onPick,
    tokenActivations,
    signalRows,
    peakRows,
    allFileLabels,
  ]);

  return (
    <div className="flex flex-col gap-2">
      {regionsError && (
        <div role="alert" className="alert alert-error text-sm">
          {regionsError}
        </div>
      )}
      {/* Plot wrapper is `relative` so the legend can sit absolutely
          in the SVG's marginTop area (which would otherwise be empty
          space). Saves ~30 px of vertical padding above the bars
          without disturbing Plot's alignment-sensitive margins. */}
      <div
        ref={ref}
        className="w-full relative"
        aria-busy={regionsLoading}
      >
        {/* Header strip sits in the SVG's marginTop=30 band: controls
            on the left, legend on the right. */}
        {controls && (
          <div className="absolute left-[40px] top-0 z-10 pointer-events-auto">
            {controls}
          </div>
        )}
        <div className="absolute right-1 top-0 z-10 pointer-events-auto">
          <SectionLegend mode={mode} />
        </div>
      </div>
    </div>
  );
}

// Sibling HTML legend — kept outside Plot's <figure> so it can't influence
// the figure's width measurement (which feeds back into Plot's `width`
// param via el.clientWidth and otherwise causes peaks/tokens to render at
// slightly different sizes when toggled).
function SectionLegend({ mode }: { mode: Section1Mode }) {
  const items =
    mode === 'tokens'
      ? SCREEN_CLASS_ORDER.filter((c) => c !== 'unclassed').map((c) => ({
          label: c,
          color: classColor(c),
        }))
      : Object.entries(ASSAY_COLORS).map(([label, color]) => ({ label, color }));
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs leading-tight text-base-content/70">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1">
          <span
            className="inline-block w-2 h-2 rounded-sm shrink-0"
            // Color is data-driven — has to be inline.
            style={{ backgroundColor: it.color }}
          />
          {it.label}
        </span>
      ))}
    </span>
  );
}

function fileLabelOf(f: FeaturedFile): string {
  if (f.assay === 'ATAC-seq') return `${f.cell_line} · ATAC-seq`;
  if (f.target) return `${f.cell_line} · ${f.target}`;
  return `${f.cell_line} · ${f.assay}`;
}
