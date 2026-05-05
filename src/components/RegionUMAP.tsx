// Region UMAP — wraps embedding-atlas's EmbeddingViewMosaic against the
// chr16 region universe, colored by SCREEN class, with click-to-pick that
// drives a Mosaic Selection.
//
// Sizing: EmbeddingViewMosaic doesn't auto-fit its container — we observe
// the wrapper's box with a ResizeObserver and pass explicit width/height
// (bedbase-ui pattern). This keeps the plot pinned to its column without
// needing a hard-coded width.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { EmbeddingViewMosaic } from 'embedding-atlas/react';
type ViewportState = { x: number; y: number; scale: number };
import { useMosaicCoordinator } from '../hooks/useMosaicCoordinator';
import { TABLE } from '../lib/duckdb';
import { SCREEN_CLASS_COLOR_RANGE } from '../lib/colors';

// embedding-atlas customOverlay class — vanilla JS lifecycle that draws
// a marker for the picked region on top of the canvas. The proxy gives
// us a (dataX, dataY) → (screenX, screenY) function that's refreshed
// on every viewport pan/zoom, so the marker tracks the underlying point.
type OverlayProxy = {
  location: (x: number, y: number) => { x: number; y: number };
  width: number;
  height: number;
};
type PickedMarkerProps = {
  proxy: OverlayProxy;
  pickedX: number;
  pickedY: number;
  /** Fill color for the star — typically the picked region's SCREEN
   * class color, so the marker reads as the underlying point itself
   * rather than a separate annotation. */
  color: string;
};
// Rounded-star marker — Lucide's Star icon path (24×24, centered at
// (12, 12)) drawn as a solid filled star so it stands in for the
// canvas point itself rather than annotating around it. Fill color is
// passed in (typically the picked region's SCREEN class color), with a
// thin same-color stroke for clean edges at small sizes.
const STAR_PATH_D =
  'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 ' +
  '1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 ' +
  '2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-' +
  '2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56' +
  'l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 ' +
  '.294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z';
const STAR_BOX = 24;
const STAR_HALF = STAR_BOX / 2;
const STAR_SCALE = 1.15;
class PickedRegionMarker {
  private svg: SVGSVGElement;
  private starGroup: SVGGElement;
  private starPath: SVGPathElement;
  private currentProps: PickedMarkerProps;
  constructor(node: HTMLDivElement, props: PickedMarkerProps) {
    this.currentProps = props;
    const SVG_NS = 'http://www.w3.org/2000/svg';
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.style.position = 'absolute';
    this.svg.style.inset = '0';
    this.svg.style.width = '100%';
    this.svg.style.height = '100%';
    this.svg.style.pointerEvents = 'none';
    // Force above any embedding-atlas-internal layers (the selection
    // halo is drawn on a layer that, by default, sits over the
    // customOverlay node).
    this.svg.style.zIndex = '50';
    // Solid star with a `currentColor` stroke (≈ base-content, dark on
    // light themes / light on dark) so the marker reads as a selected
    // pin regardless of how close it sits to other similarly-colored
    // points. vector-effect keeps the stroke crisp at any scale.
    this.starGroup = document.createElementNS(SVG_NS, 'g');
    this.starPath = document.createElementNS(SVG_NS, 'path');
    this.starPath.setAttribute('d', STAR_PATH_D);
    this.starPath.setAttribute('stroke', 'currentColor');
    this.starPath.setAttribute('stroke-width', '2');
    this.starPath.setAttribute('stroke-linejoin', 'round');
    this.starPath.setAttribute('stroke-linecap', 'round');
    this.starPath.setAttribute('vector-effect', 'non-scaling-stroke');
    this.starGroup.appendChild(this.starPath);
    this.svg.appendChild(this.starGroup);
    node.appendChild(this.svg);
    this.render();
  }
  update(props: PickedMarkerProps) {
    this.currentProps = props;
    this.render();
  }
  destroy() {
    this.svg.remove();
  }
  private render() {
    const { proxy, pickedX, pickedY, color } = this.currentProps;
    const { x, y } = proxy.location(pickedX, pickedY);
    this.starPath.setAttribute('fill', color);
    this.starGroup.setAttribute(
      'transform',
      `translate(${x}, ${y}) scale(${STAR_SCALE}) translate(-${STAR_HALF}, -${STAR_HALF})`,
    );
  }
}
import { DIVERGING_PUOR } from '../lib/palettes';
import { UmapTooltip } from './UmapTooltip';

export type RegionColorBy = 'cclass' | 'enrichment';

export type PickedRegion = {
  token_id: number;
  region: string;
  cclass: string;
  start: number;
  end: number;
  midpoint: number;
  umap_x: number;
  umap_y: number;
};

export type RegionUMAPProps = {
  /** Explicit pixel height. When omitted, the wrapper fills its flex
   * parent and the canvas tracks the measured container size. */
  height?: number;
  onPickedChange?: (picked: PickedRegion | null) => void;
  /** Token ids to outline as a visible highlight — used to mark the picked
   * interval's regions on the UMAP. Click semantics unchanged: any region
   * is still pickable regardless of whether it's highlighted. */
  highlightedTokenIds?: ReadonlyArray<number>;
  /** Floating chip overlay at top-left (bedbase-ui sidebar pattern). */
  headerChip?: ReactNode;
  /** Floating panel anchored to the top-right corner — used to show the
   * dictionary entry for the currently picked region. Renders only when
   * the supplied node is non-null/falsy. */
  cornerOverlay?: ReactNode;
  /** Which categorical scale colors the points. cclass = SCREEN class.
   * enrichment = file-selection log-odds (requires `enrichmentTable`). */
  colorBy?: RegionColorBy;
  /** When colorBy=enrichment, the materialized table name to read from
   * (produced by useEnrichmentTable). Falls back to cclass coloring if
   * null while colorBy=enrichment is set, so the plot stays valid. */
  enrichmentTable?: string | null;
  /** Opaque token that flips whenever the enrichment table contents
   * change. Folded into the EmbeddingView `key` so it remounts and
   * re-reads the table when the same name is rebuilt in place. */
  enrichmentVersion?: string | null;
  /** Optional viewport (pan + zoom) state passthrough — caller-managed. */
  viewportState?: ViewportState | null;
  onViewportState?: (v: ViewportState) => void;
  /** UMAP coords + render color for the picked region. When supplied,
   * an SVG star marker is drawn at that position (replacing the
   * underlying canvas point visually) so the pick is distinguishable
   * from its highlighted partners. The color is typically the
   * region's SCREEN class color. */
  pickedUmap?: { x: number; y: number; color: string } | null;
};

export function RegionUMAP({
  height,
  onPickedChange,
  highlightedTokenIds,
  headerChip,
  cornerOverlay,
  colorBy = 'cclass',
  enrichmentTable,
  enrichmentVersion,
  viewportState,
  onViewportState,
  pickedUmap,
}: RegionUMAPProps) {
  const { coordinator, isReady } = useMosaicCoordinator();

  const [pickedId, setPickedId] = useState<number | null>(null);

  // Highlighted-as-selected token list for embedding-atlas. We use the
  // `selection` prop as a static "render these as stroked dots" mechanism;
  // clicks are captured separately via onSelection. Passing null when the
  // caller doesn't supply a highlight set keeps the prop quiet.
  const highlightArray = useMemo(() => {
    if (!highlightedTokenIds || highlightedTokenIds.length === 0) return null;
    return highlightedTokenIds.map((id) => Number(id));
  }, [highlightedTokenIds]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState<{
    width: number;
    height: number;
  }>({ width: 0, height: 0 });

  // Track the wrapper's box so we can hand explicit pixel sizes to
  // EmbeddingViewMosaic (it won't auto-fit otherwise).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerSize({
          width: Math.max(0, Math.floor(entry.contentRect.width)),
          height: Math.max(0, Math.floor(entry.contentRect.height)),
        });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const containerWidth = containerSize.width;
  const effectiveHeight = height ?? containerSize.height;

  // Resolve the selected token's full row via DuckDB whenever the picked id
  // changes — embedding-atlas only gives us the identifier on click.
  useEffect(() => {
    if (!isReady || pickedId == null) {
      onPickedChange?.(null);
      return;
    }
    let cancelled = false;
    coordinator
      .query(
        `SELECT token_id, region, COALESCE(cclass, 'unclassed') AS cclass,
                start, "end" AS end, midpoint, umap_x, umap_y
         FROM ${TABLE.regionsClassed}
         WHERE token_id = ${pickedId}
         LIMIT 1`,
        { type: 'json' },
      )
      .then((rows: unknown) => {
        if (cancelled) return;
        const arr = rows as Array<{
          token_id: number;
          region: string;
          cclass: string;
          start: number;
          end: number;
          midpoint: number;
          umap_x: number;
          umap_y: number;
        }>;
        if (arr.length > 0) {
          onPickedChange?.({
            token_id: Number(arr[0].token_id),
            region: arr[0].region,
            cclass: arr[0].cclass,
            start: Number(arr[0].start),
            end: Number(arr[0].end),
            midpoint: Number(arr[0].midpoint),
            umap_x: Number(arr[0].umap_x),
            umap_y: Number(arr[0].umap_y),
          });
        } else {
          onPickedChange?.(null);
        }
      })
      .catch(() => {
        if (!cancelled) onPickedChange?.(null);
      });
    return () => {
      cancelled = true;
    };
  }, [coordinator, isReady, pickedId, onPickedChange]);

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden rounded-b-lg bg-base-100 relative w-full ${height == null ? 'h-full min-h-0' : ''}`}
      style={height != null ? { height } : undefined}
    >
      {headerChip && (
        <div className="absolute top-2 left-2 z-10">{headerChip}</div>
      )}
      {cornerOverlay && (
        <div className="absolute top-2 right-2 z-10 max-h-[calc(100%-1rem)] flex">
          {cornerOverlay}
        </div>
      )}
      {!isReady ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="loading loading-spinner loading-md text-primary" />
        </div>
      ) : containerWidth === 0 || effectiveHeight === 0 ? null : (
        <EmbeddingViewMosaic
          // Remount when the underlying table changes OR when the
          // enrichment table is rebuilt in place under a new selection
          // (same table name, different rows — `key` change forces a
          // fresh mount and re-read).
          key={`region-umap-${
            colorBy === 'enrichment' && enrichmentTable
              ? `${enrichmentTable}:${enrichmentVersion ?? ''}`
              : 'cclass'
          }`}
          coordinator={coordinator}
          table={
            colorBy === 'enrichment' && enrichmentTable
              ? enrichmentTable
              : TABLE.regionsClassed
          }
          x="umap_x"
          y="umap_y"
          category={
            colorBy === 'enrichment' && enrichmentTable
              ? 'enrichment_category'
              : 'cclass_category'
          }
          identifier="token_id"
          text="region"
          additionalFields={{
            class: 'cclass',
            length: { sql: '"end" - start' },
          }}
          categoryColors={
            colorBy === 'enrichment' && enrichmentTable
              ? DIVERGING_PUOR
              : SCREEN_CLASS_COLOR_RANGE
          }
          selection={highlightArray}
          width={containerWidth}
          height={effectiveHeight}
          viewportState={viewportState}
          onViewportState={onViewportState}
          config={{ autoLabelEnabled: false }}
          customTooltip={{
            class: UmapTooltip,
            props: { identifierLabel: 'token' },
          }}
          // Hide embedding-atlas's bottom-right status bar (mode toggles,
          // branding link, point count). The region UMAP is purely a
          // click-to-pick surface — none of those affordances apply, and
          // the bar competes with the chr distribution card visually.
          theme={{ statusBar: false }}
          // Overlay an SVG marker on the picked region's UMAP coords
          // so the pick is distinguishable from its highlighted NPMI
          // partners. Re-keyed on the picked coords so embedding-atlas
          // tears down + remounts the overlay class when the pick
          // changes (cheaper than diffing inside the class).
          customOverlay={
            pickedUmap
              ? {
                  class: PickedRegionMarker,
                  props: {
                    pickedX: pickedUmap.x,
                    pickedY: pickedUmap.y,
                    color: pickedUmap.color,
                  },
                }
              : null
          }
          onSelection={(points) => {
            const id = points && points.length > 0 ? points[0].identifier : null;
            setPickedId(id != null ? Number(id) : null);
          }}
        />
      )}
    </div>
  );
}
