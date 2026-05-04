// File UMAP — wraps embedding-atlas's EmbeddingViewMosaic against the
// per-file embedding (viz_files), colored by assay. Two responsibilities:
//   • Highlight the files in the current stratum (driven externally via
//     `highlightedFileIds`) using the same `selection` prop pattern as
//     RegionUMAP.
//   • Capture brush/click selections and emit the selected file id list
//     so the caller can promote it to a custom stratum.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { EmbeddingViewMosaic } from 'embedding-atlas/react';
// embedding-atlas's ViewportState is exported from the type-only index.
type ViewportState = { x: number; y: number; scale: number };
import { useMosaicCoordinator } from '../hooks/useMosaicCoordinator';
import { TABLE } from '../lib/duckdb';
import { ASSAY_COLOR_RANGE_WITH_UNKNOWN } from '../lib/colors';
import { TABLEAU20 } from '../lib/palettes';

export type FileColorBy = 'assay' | 'cell_line';

const FILE_COLOR_CONFIG: Record<
  FileColorBy,
  { categoryColumn: string; palette: string[] }
> = {
  assay: { categoryColumn: 'assay_category', palette: ASSAY_COLOR_RANGE_WITH_UNKNOWN },
  cell_line: { categoryColumn: 'cell_line_cat', palette: TABLEAU20 },
};

export type FileUMAPProps = {
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
  height = 480,
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
  const [containerWidth, setContainerWidth] = useState<number>(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(Math.max(0, Math.floor(entry.contentRect.width)));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="overflow-hidden bg-base-100 relative w-full"
      style={{ height }}
    >
      {headerChip && (
        <div className="absolute top-2 left-2 z-10">{headerChip}</div>
      )}
      {!isReady ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="loading loading-spinner loading-md text-primary" />
        </div>
      ) : containerWidth === 0 ? null : (
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
          selection={highlightArray}
          width={containerWidth}
          height={height}
          config={{ autoLabelEnabled: false }}
          viewportState={viewportState}
          onViewportState={onViewportState}
          onSelection={(points) => {
            const ids = (points ?? [])
              .map((p) => p.identifier)
              .filter((id): id is string => typeof id === 'string');
            onSelectionChange?.(ids);
          }}
        />
      )}
    </div>
  );
}
