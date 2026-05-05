// File UMAP — wraps embedding-atlas's EmbeddingViewMosaic against the
// per-file embedding (viz_files), colored by assay. Two responsibilities:
//   • Highlight the files in the current stratum (driven externally via
//     `highlightedFileIds`) using the same `selection` prop pattern as
//     RegionUMAP.
//   • Capture brush/click selections and emit the selected file id list
//     so the caller can promote it to a custom stratum.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { EmbeddingViewMosaic } from 'embedding-atlas/react';
import * as vg from '@uwdata/vgplot';
// embedding-atlas's ViewportState is exported from the type-only index.
type ViewportState = { x: number; y: number; scale: number };
import { useMosaicCoordinator } from '../hooks/useMosaicCoordinator';
import { TABLE } from '../lib/duckdb';
import { ASSAY_COLOR_RANGE_WITH_UNKNOWN } from '../lib/colors';
import { TABLEAU20 } from '../lib/palettes';
import { pointInPolygonPredicate, boundingRect } from '../lib/umapBrush';
import { UmapTooltip } from './UmapTooltip';

export type FileColorBy = 'assay' | 'cell_line';

const FILE_COLOR_CONFIG: Record<
  FileColorBy,
  { categoryColumn: string; palette: string[] }
> = {
  assay: { categoryColumn: 'assay_category', palette: ASSAY_COLOR_RANGE_WITH_UNKNOWN },
  cell_line: { categoryColumn: 'cell_line_cat', palette: TABLEAU20 },
};

export type FileUMAPProps = {
  /** Explicit pixel height. When omitted, the wrapper fills its flex
   * parent and the canvas tracks the measured container size. */
  height?: number;
  /** File ids to outline as a visible highlight — typically the current
   * stratum's file pool. Click semantics unchanged. */
  highlightedFileIds?: ReadonlyArray<string>;
  /** Fired when the user changes the brush/click selection. Empty array
   * means "no selection". */
  onSelectionChange?: (ids: string[]) => void;
  /** Floating chip overlay rendered at top-left of the plot (bedbase-ui
   * sidebar pattern). Pass a `<UMAPHeaderChip>` for the standard look. */
  headerChip?: ReactNode;
  /** Which categorical column drives the point color. Defaults to assay. */
  colorBy?: FileColorBy;
  /** Optional viewport (pan + zoom) state passthrough — caller-managed. */
  viewportState?: ViewportState | null;
  onViewportState?: (v: ViewportState) => void;
};

export function FileUMAP({
  height,
  highlightedFileIds,
  onSelectionChange,
  headerChip,
  colorBy = 'assay',
  viewportState,
  onViewportState,
}: FileUMAPProps) {
  const { coordinator, isReady } = useMosaicCoordinator();

  // EmbeddingViewMosaic's `selection` prop expects identifiers matching the
  // table's `identifier` column type. File ids are strings; pass them
  // through unchanged. Null when the highlight set is empty so the prop
  // stays quiet.
  const highlightArray = useMemo(() => {
    if (!highlightedFileIds || highlightedFileIds.length === 0) return null;
    return [...highlightedFileIds];
  }, [highlightedFileIds]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState<{
    width: number;
    height: number;
  }>({ width: 0, height: 0 });

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
  // When `height` is supplied we honour it exactly; otherwise the wrapper
  // is `h-full` (flex stretch) and we let ResizeObserver tell us how
  // tall it actually rendered so EmbeddingViewMosaic gets a real pixel.
  const effectiveHeight = height ?? containerSize.height;

  // Brush state — embedding-atlas emits the rect/polygon coords via
  // `onRangeSelection` but doesn't auto-resolve them to point ids or
  // visually highlight them. We mirror bedbase-ui's pattern: keep the
  // rect controlled (so it stays drawn after release), and query
  // DuckDB ourselves for the file ids inside the rect, then forward
  // them through `onSelectionChange` so the parent can promote them
  // to a custom file pool (which loops back as `highlightedFileIds`
  // and renders the points highlighted).
  type Rectangle = {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
  };
  type PolygonPoint = { x: number; y: number };
  type RangeValue = Rectangle | PolygonPoint[] | null;
  const [rangeSelectionValue, setRangeSelectionValue] =
    useState<RangeValue>(null);

  const handleRangeSelection = async (value: RangeValue) => {
    setRangeSelectionValue(value);
    if (!value) {
      onSelectionChange?.([]);
      return;
    }
    // Build a Mosaic predicate matching the brush shape:
    //   - rectangle → simple BETWEEN on x/y
    //   - polygon (≥3 vertices) → bounding-box pre-filter + true
    //     point-in-polygon (ray-cast SQL via the shared helper)
    // vgplot's expression types are loose; `any` matches the helper
    // signatures (same approach as bedbase-ui).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let predicate: any;
    const xCol = vg.column('umap_x');
    const yCol = vg.column('umap_y');
    if (Array.isArray(value)) {
      if (value.length < 3) return;
      const bounds = boundingRect(value);
      predicate = vg.and(
        vg.isBetween(xCol, [bounds.xMin, bounds.xMax]),
        vg.isBetween(yCol, [bounds.yMin, bounds.yMax]),
        pointInPolygonPredicate(xCol, yCol, value),
      );
    } else {
      predicate = vg.and(
        vg.isBetween(xCol, [value.xMin, value.xMax]),
        vg.isBetween(yCol, [value.yMin, value.yMax]),
      );
    }
    try {
      const q = vg.Query.from(TABLE.filesCategorized)
        .select({ id: vg.column('id') })
        .where(predicate);
      const rows = (await coordinator.query(q, { type: 'json' })) as Array<{
        id: string;
      }>;
      onSelectionChange?.(rows.map((r) => String(r.id)));
    } catch {
      // Coordinator can be cleared between queries; treat as empty.
      onSelectionChange?.([]);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden rounded-b-lg bg-base-100 relative w-full ${height == null ? 'h-full min-h-0' : ''}`}
      style={height != null ? { height } : undefined}
    >
      {headerChip && (
        <div className="absolute top-2 left-2 z-10">{headerChip}</div>
      )}
      {!isReady ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="loading loading-spinner loading-md text-primary" />
        </div>
      ) : containerWidth === 0 || effectiveHeight === 0 ? null : (
        <EmbeddingViewMosaic
          coordinator={coordinator}
          table={TABLE.filesCategorized}
          x="umap_x"
          y="umap_y"
          category={FILE_COLOR_CONFIG[colorBy].categoryColumn}
          identifier="id"
          text="name"
          additionalFields={{
            assay: 'assay',
            cell_line: 'cell_line',
            tissue: 'tissue',
          }}
          categoryColors={FILE_COLOR_CONFIG[colorBy].palette}
          customTooltip={{
            class: UmapTooltip,
            props: { identifierLabel: 'file' },
          }}
          selection={highlightArray}
          width={containerWidth}
          height={effectiveHeight}
          config={{ autoLabelEnabled: false }}
          viewportState={viewportState}
          onViewportState={onViewportState}
          onSelection={(points) => {
            const ids = (points ?? [])
              .map((p) => p.identifier)
              .filter((id): id is string => typeof id === 'string');
            onSelectionChange?.(ids);
          }}
          rangeSelectionValue={rangeSelectionValue}
          onRangeSelection={handleRangeSelection}
        />
      )}
    </div>
  );
}
