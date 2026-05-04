// Phase 5+: interval picker + Section 1 toggle + RegionUMAP + DictCard.
// Custom file pool comes from interactive legend pins (assay / cell_line)
// or brush-selecting points on the FileUMAP — strata system removed.

import { useCallback, useMemo, useState } from 'react';
import { useMosaicCoordinator } from '../hooks/useMosaicCoordinator';
import { FilterButton } from '../components/FilterButton';
import {
  RegionUMAP,
  type PickedRegion,
  type RegionColorBy,
} from '../components/RegionUMAP';
import { FileUMAP, type FileColorBy } from '../components/FileUMAP';
import {
  UMAPCard,
  UMAPLegendChip,
  UMAPGradientChip,
  UMAPTextChip,
} from '../components/UMAPHeaderChip';
import { ColorByPicker } from '../components/ColorByPicker';
import {
  ASSAY_COLORS,
  SCREEN_CLASS_COLORS,
  SCREEN_CLASS_ORDER,
} from '../lib/colors';
import { useEnrichmentTable } from '../hooks/useEnrichmentTable';
import { useCellLineLegend } from '../hooks/useCellLineLegend';
import { useFilteredFileIds } from '../hooks/useFilteredFileIds';
import { DIVERGING_PUOR } from '../lib/palettes';
import { IntervalPicker } from '../components/IntervalPicker';
import { Section1Plot } from '../components/Section1Plot';
import {
  Section1ModeToggle,
  type Section1Mode,
} from '../components/Section1ModeToggle';
import { DictCard } from '../components/DictCard';
import { ChrDistributionStrip } from '../components/ChrDistributionStrip';
import { useFeaturedIntervals } from '../hooks/useFeaturedIntervals';
import { useFeaturedFiles } from '../hooks/useFeaturedFiles';
import { useTokenNpmiPartners } from '../hooks/usePartners';
import type { CandidateInterval } from '../lib/candidateIntervals';

const FILE_COLOR_OPTIONS = [
  { key: 'assay', label: 'Assay' },
  { key: 'cell_line', label: 'Cell line' },
] as const;

export function Home() {
  const { isReady, error } = useMosaicCoordinator();
  const { intervals, loading: intervalsLoading } = useFeaturedIntervals();
  const { files } = useFeaturedFiles();

  const [picked, setPicked] = useState<PickedRegion | null>(null);

  // Two sources for the custom file pool, mutually exclusive — whichever
  // was set last wins:
  //   • brushedFileIds — explicit ids from a brush selection on the FileUMAP
  //   • pinnedAssays / pinnedCellLines — categorical legend pins, AND'd
  //     across fields and resolved to ids via useFilteredFileIds
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
      // Brush wins over pins — clear them so the status chip shows a
      // single source of truth.
      setPinnedAssays(new Set());
      setPinnedCellLines(new Set());
    }
  }, []);

  const togglePinAssay = useCallback((label: string) => {
    setBrushedFileIds([]); // pin wins over brush
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

  // Color-by state for both UMAPs. RegionUMAP's enrichment option is only
  // meaningful when a custom file pool exists; we fall back to cclass
  // automatically otherwise.
  const [fileColorBy, setFileColorBy] = useState<FileColorBy>('assay');
  const { items: cellLineLegendItems } = useCellLineLegend();
  const [regionColorBy, setRegionColorBy] = useState<RegionColorBy>('cclass');
  const enrichmentAvailable = (customFileIds?.length ?? 0) > 0;
  const effectiveRegionColorBy: RegionColorBy = enrichmentAvailable
    ? regionColorBy
    : 'cclass';
  // Build the enrichment table only when needed — useEnrichmentTable
  // short-circuits when the id list is empty.
  const {
    tableName: enrichmentTableName,
    version: enrichmentVersion,
    loading: enrichmentLoading,
  } = useEnrichmentTable(
    effectiveRegionColorBy === 'enrichment' ? customFileIds : null,
  );

  // Status-chip summary of active filter ("K562 + ATAC-seq · 4116 files").
  const filterSummary = useMemo(() => {
    if (brushedFileIds.length > 0) {
      return `Brushed · ${brushedFileIds.length.toLocaleString()} files`;
    }
    const pins = [...pinnedAssays, ...pinnedCellLines];
    if (pins.length === 0) return null;
    const fileCount = pinnedFileIds?.length ?? 0;
    return `${pins.join(' + ')} · ${fileCount.toLocaleString()} files`;
  }, [brushedFileIds, pinnedAssays, pinnedCellLines, pinnedFileIds]);

  // Track only the user's pick; derive the effective interval at render so
  // we don't write state inside an effect for the default case.
  const [pickedIntervalId, setPickedIntervalId] = useState<string | null>(null);
  const interval = useMemo<CandidateInterval | null>(() => {
    if (intervals.length === 0) return null;
    const found = pickedIntervalId
      ? intervals.find((i) => i.interval_id === pickedIntervalId)
      : null;
    return found ?? intervals[0];
  }, [pickedIntervalId, intervals]);

  const [userMode, setUserMode] = useState<Section1Mode>('continuous');
  // Hub candidates lack featured_signal/tracks rows; force tokens mode so
  // the user always sees something rather than an empty plot.
  const isParquetInterval = interval?.source === 'parquet';
  const mode: Section1Mode = isParquetInterval ? userMode : 'tokens';
  const disabledModes: Section1Mode[] = isParquetInterval
    ? []
    : ['continuous', 'peaks'];

  const onPicked = useCallback((p: PickedRegion | null) => {
    setPicked(p);
  }, []);

  // RegionUMAP highlight: when a region is picked, outline it AND its
  // top-30 NPMI partners so the user can see the same partner set that
  // shows up as bars in the chr16 distribution strip — semantic location
  // (UMAP) + spatial location (strip) at once. Nothing highlighted when
  // no region is picked.
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

  return (
    <main className="p-4 md:p-6 w-full flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">A Dictionary of Regulatory Genomics</h1>
        <p className="text-base-content/70 text-sm mt-1">
          chr16 R2V universe — interval-scoped demo. Pick an interval to see its
          universe + per-file activations; click a region on the UMAP to look up
          its dictionary entry.
        </p>
      </div>

      {error && (
        <div role="alert" className="alert alert-error">
          <span className="font-mono text-sm">init error: {error}</span>
        </div>
      )}

      {interval && (
        <Section1Plot
          interval={interval}
          files={files}
          mode={mode}
          headerActions={
            <span className="inline-flex items-center gap-1.5">
              <IntervalPicker
                intervals={intervals}
                value={interval.interval_id}
                onChange={(iv) => setPickedIntervalId(iv.interval_id)}
                loading={intervalsLoading}
              />
              <Section1ModeToggle
                value={mode}
                onChange={setUserMode}
                disabledModes={disabledModes}
              />
            </span>
          }
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <UMAPCard
          title="File embedding · BED corpus"
          suffix={filterSummary ? `(${filterSummary})` : '(brush or pin to filter)'}
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
            height={540}
            colorBy={fileColorBy}
            highlightedFileIds={customFileIds ?? undefined}
            onSelectionChange={onFileSelectionChange}
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
            height={540}
            onPickedChange={onPicked}
            highlightedTokenIds={highlightTokenIds ?? undefined}
            colorBy={effectiveRegionColorBy}
            enrichmentTable={enrichmentTableName}
            enrichmentVersion={enrichmentVersion}
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

      <ChrDistributionStrip picked={picked} customFileIds={customFileIds} />
    </main>
  );
}
