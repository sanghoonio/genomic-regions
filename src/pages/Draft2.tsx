// Draft 2 — clean canvas mirroring the Reference draft's UMAP
// functionality (interactive legends, dictionary tooltip, BED filter
// manager, region color toggle including selection enrichment) but with
// a different layout: BED UMAP top-left, Region UMAP bottom-left, both
// 400px tall and starting at half the auto-fit zoom level.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMosaicCoordinator } from '../hooks/useMosaicCoordinator';
import {
  RegionUMAP,
  type PickedRegion,
  type RegionColorBy,
} from '../components/RegionUMAP';
import { FileUMAP, type FileColorBy } from '../components/FileUMAP';
import { FilterButton } from '../components/FilterButton';
import {
  UMAPCard,
  UMAPLegendChip,
  UMAPGradientChip,
  UMAPTextChip,
} from '../components/UMAPHeaderChip';
import { ColorByPicker } from '../components/ColorByPicker';
import { DictCard } from '../components/DictCard';
import {
  ASSAY_COLORS,
  SCREEN_CLASS_COLORS,
  SCREEN_CLASS_ORDER,
} from '../lib/colors';
import { DIVERGING_PUOR } from '../lib/palettes';
import { TABLE } from '../lib/duckdb';
import { useEnrichmentTable } from '../hooks/useEnrichmentTable';
import { useCellLineLegend } from '../hooks/useCellLineLegend';
import { useFilteredFileIds } from '../hooks/useFilteredFileIds';
import { useTokenNpmiPartners } from '../hooks/usePartners';
import { useUmapBounds } from '../hooks/useUmapBounds';
import { ChrDistributionVgplot } from '../components/ChrDistributionVgplot';
// Token raster — sparse for now, parked while we iterate on chr-dist first.
// import { useTokenRasterTable } from '../hooks/useTokenRasterTable';
// import { TokenRasterPlot } from '../components/TokenRasterPlot';

const FILE_COLOR_OPTIONS = [
  { key: 'assay', label: 'Assay' },
  { key: 'cell_line', label: 'Cell line' },
] as const;

const UMAP_HEIGHT = 400;
// 1.0 = auto-fit; 0.5 zooms out 2× so the whole embedding sits in the
// viewport with breathing room.
const INITIAL_ZOOM = 0.5;

type Viewport = { x: number; y: number; scale: number };

export function Draft2() {
  const { isReady } = useMosaicCoordinator();
  const [picked, setPicked] = useState<PickedRegion | null>(null);

  // Pin/brush state — mirrors Home.
  const [brushedFileIds, setBrushedFileIds] = useState<string[]>([]);
  const [pinnedAssays, setPinnedAssays] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [pinnedCellLines, setPinnedCellLines] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const { ids: pinnedFileIds } = useFilteredFileIds(
    pinnedAssays,
    pinnedCellLines,
  );
  const customFileIds = useMemo<string[] | null>(() => {
    if (brushedFileIds.length > 0) return brushedFileIds;
    if (pinnedFileIds && pinnedFileIds.length > 0) return pinnedFileIds;
    return null;
  }, [brushedFileIds, pinnedFileIds]);

  const onFileSelectionChange = useCallback((ids: string[]) => {
    setBrushedFileIds(ids);
    if (ids.length > 0) {
      setPinnedAssays(new Set());
      setPinnedCellLines(new Set());
    }
  }, []);
  const togglePinAssay = useCallback((label: string) => {
    setBrushedFileIds([]);
    setPinnedAssays((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);
  const togglePinCellLine = useCallback((label: string) => {
    setBrushedFileIds([]);
    setPinnedCellLines((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);
  const onClearAll = useCallback(() => {
    setBrushedFileIds([]);
    setPinnedAssays(new Set());
    setPinnedCellLines(new Set());
  }, []);

  // Color modes.
  const [fileColorBy, setFileColorBy] = useState<FileColorBy>('assay');
  const { items: cellLineLegendItems } = useCellLineLegend();
  const [regionColorBy, setRegionColorBy] = useState<RegionColorBy>('cclass');
  const enrichmentAvailable = (customFileIds?.length ?? 0) > 0;
  const effectiveRegionColorBy: RegionColorBy = enrichmentAvailable
    ? regionColorBy
    : 'cclass';
  const {
    tableName: enrichmentTableName,
    version: enrichmentVersion,
    loading: enrichmentLoading,
  } = useEnrichmentTable(
    effectiveRegionColorBy === 'enrichment' ? customFileIds : null,
  );

  // Highlight: picked region + its top-30 NPMI partners (same set the
  // Reference draft outlines).
  const { rows: pickedPartnerRows } = useTokenNpmiPartners(
    picked?.token_id ?? null,
    30,
    5,
    customFileIds,
  );
  const highlightTokenIds = useMemo(() => {
    if (!picked) return null;
    const ids = [picked.token_id];
    if (pickedPartnerRows) {
      for (const p of pickedPartnerRows) ids.push(p.partner_token_id);
    }
    return ids;
  }, [picked, pickedPartnerRows]);

  // Viewport state — initialized to half-zoom once bounds load. embedding-
  // atlas auto-fits while the viewport is null, so the first paint shows
  // a centered fit and then snaps to half-zoom on next render. Acceptable.
  const { fitViewport: fileFit } = useUmapBounds(TABLE.filesCategorized);
  const { fitViewport: regionFit } = useUmapBounds(TABLE.regionsClassed);
  const [fileViewport, setFileViewport] = useState<Viewport | null>(null);
  const [regionViewport, setRegionViewport] = useState<Viewport | null>(null);
  // Seed viewport from the bounds query when it lands. Standard
  // sync-state-with-external-resource pattern; the lint rule flags it
  // generically.
  useEffect(() => {
    if (fileFit && fileViewport === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFileViewport({ ...fileFit, scale: fileFit.scale * INITIAL_ZOOM });
    }
  }, [fileFit, fileViewport]);
  useEffect(() => {
    if (regionFit && regionViewport === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRegionViewport({ ...regionFit, scale: regionFit.scale * INITIAL_ZOOM });
    }
  }, [regionFit, regionViewport]);

  const onPicked = useCallback((p: PickedRegion | null) => {
    setPicked(p);
  }, []);

  // Raster parked — see commented-out section in the JSX below.
  // const { tableName: rasterTable, version: rasterVersion,
  //         rowCount: rasterRowCount, loading: rasterLoading } =
  //   useTokenRasterTable(customFileIds, fileColorBy);

  const filterSummary = useMemo(() => {
    if (brushedFileIds.length > 0) {
      return `Brushed · ${brushedFileIds.length.toLocaleString()} files`;
    }
    const pins = [...pinnedAssays, ...pinnedCellLines];
    if (pins.length === 0) return null;
    const fileCount = pinnedFileIds?.length ?? 0;
    return `${pins.join(' + ')} · ${fileCount.toLocaleString()} files`;
  }, [brushedFileIds, pinnedAssays, pinnedCellLines, pinnedFileIds]);

  return (
    <main className="p-4 md:p-6 w-full flex flex-col gap-3">
      <div>
        <h1 className="text-2xl font-semibold">A Dictionary of Regulatory Genomics</h1>
        <p className="text-base-content/70 text-sm mt-1">
          chr16 R2V universe — pin or brush to define a custom file pool;
          click a region for its dictionary entry.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-3 items-start">
        <div className="flex flex-col gap-3">
          <UMAPCard
            title="File embedding · BED corpus"
            suffix={
              filterSummary ? `(${filterSummary})` : '(brush or pin to filter)'
            }
            actions={
              <span className="inline-flex items-center gap-1.5">
                <FilterButton
                  pinnedAssays={pinnedAssays}
                  pinnedCellLines={pinnedCellLines}
                  brushedCount={brushedFileIds.length}
                  onTogglePinAssay={togglePinAssay}
                  onTogglePinCellLine={togglePinCellLine}
                  onClearBrush={() => setBrushedFileIds([])}
                  onClearAll={onClearAll}
                />
                <ColorByPicker
                  value={fileColorBy}
                  onChange={(k) => setFileColorBy(k as FileColorBy)}
                  options={FILE_COLOR_OPTIONS.map((o) => ({
                    key: o.key,
                    label: o.label,
                  }))}
                />
              </span>
            }
          >
            <FileUMAP
              height={UMAP_HEIGHT}
              colorBy={fileColorBy}
              highlightedFileIds={customFileIds ?? undefined}
              onSelectionChange={onFileSelectionChange}
              viewportState={fileViewport}
              onViewportState={setFileViewport}
              headerChip={
                fileColorBy === 'assay' ? (
                  <UMAPLegendChip
                    items={Object.entries(ASSAY_COLORS).map(([label, color]) => ({
                      label,
                      color,
                    }))}
                    pinned={pinnedAssays}
                    onTogglePin={togglePinAssay}
                  />
                ) : cellLineLegendItems ? (
                  <UMAPLegendChip
                    items={cellLineLegendItems}
                    pinned={pinnedCellLines}
                    onTogglePin={togglePinCellLine}
                  />
                ) : (
                  <UMAPTextChip label="Color: Cell line" />
                )
              }
            />
          </UMAPCard>
          <UMAPCard
            title="Region embedding · chr16 universe"
            suffix={
              effectiveRegionColorBy === 'enrichment' && enrichmentLoading
                ? '(computing enrichment…)'
                : picked && highlightTokenIds
                  ? `(picked + ${(highlightTokenIds.length - 1).toLocaleString()} NPMI partners highlighted)`
                  : '(click a region for its dictionary entry)'
            }
            actions={
              <ColorByPicker
                value={effectiveRegionColorBy}
                onChange={(k) => setRegionColorBy(k as RegionColorBy)}
                options={[
                  { key: 'cclass', label: 'SCREEN class' },
                  {
                    key: 'enrichment',
                    label: 'Selection enrichment',
                    available: enrichmentAvailable,
                    hint: enrichmentAvailable ? undefined : 'brush files',
                  },
                ]}
              />
            }
          >
            <RegionUMAP
              height={UMAP_HEIGHT}
              onPickedChange={onPicked}
              highlightedTokenIds={highlightTokenIds ?? undefined}
              colorBy={effectiveRegionColorBy}
              enrichmentTable={enrichmentTableName}
              enrichmentVersion={enrichmentVersion}
              viewportState={regionViewport}
              onViewportState={setRegionViewport}
              headerChip={
                effectiveRegionColorBy === 'enrichment' ? (
                  <UMAPGradientChip
                    palette={DIVERGING_PUOR}
                    leftLabel="depleted"
                    rightLabel="enriched"
                  />
                ) : (
                  <UMAPLegendChip
                    items={SCREEN_CLASS_ORDER.filter((c) => c !== 'unclassed').map(
                      (c) => ({ label: c, color: SCREEN_CLASS_COLORS[c] }),
                    )}
                  />
                )
              }
              cornerOverlay={
                <DictCard
                  picked={picked}
                  isReady={isReady}
                  customFileIds={customFileIds}
                />
              }
            />
          </UMAPCard>
        </div>

        <div className="flex flex-col gap-3">
          <ChrDistributionVgplot
            picked={picked}
            customFileIds={customFileIds}
          />
          {/* Token raster parked — see ChrDistributionVgplot above for the
              new vgplot/brush+zoom pattern. Revive when row aggregation is
              more legible.
            <UMAPCard title="Token raster · chr16" suffix={...}>
              <TokenRasterPlot ... />
            </UMAPCard>
          */}
        </div>
      </div>
    </main>
  );
}

