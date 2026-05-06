// Home — the dictionary's main page: top intro row (Section 1: signal /
// peaks / tokens for a featured interval), then BED + region UMAPs
// stacked on the left and chromosome distribution + dictionary entry on
// the right.

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
import { ResetButton } from '../components/ResetButton';
import { DictPanel } from '../components/DictPanel';
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
import { ChrDistributionTracks } from '../components/ChrDistributionTracks';
import { Section1Plot } from '../components/Section1Plot';
import type { Section1Mode } from '../components/Section1Plot';
import { useFeaturedIntervals } from '../hooks/useFeaturedIntervals';
import { useFeaturedFiles } from '../hooks/useFeaturedFiles';
import type { CandidateInterval } from '../lib/candidateIntervals';

const FILE_COLOR_OPTIONS = [
  { key: 'assay', label: 'Assay' },
  { key: 'cell_line', label: 'Cell line' },
] as const;

// 1.0 = auto-fit; 0.67 zooms out slightly so the whole embedding sits
// in the viewport with breathing room.
const INITIAL_ZOOM = 0.67;

type Viewport = { x: number; y: number; scale: number };

export function Home() {
  const { isReady, loadProgress, error: coordError } = useMosaicCoordinator();
  const [picked, setPicked] = useState<PickedRegion | null>(null);

  // Zoom-window centers for the chr distribution strip. Lifted here so
  // the dict panel can pan to a partner's position and the chr-dist
  // card stays a controlled component. Reset to picked.midpoint on a
  // fresh pick so a new region recenters its own neighborhood.
  const [window2Center, setWindow2Center] = useState<number | null>(null);
  const [window3Center, setWindow3Center] = useState<number | null>(null);
  const pickedMidpoint = picked?.midpoint ?? null;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWindow2Center(pickedMidpoint);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWindow3Center(pickedMidpoint);
  }, [pickedMidpoint]);
  // Shared "ping" — when the user clicks a region in any of the three
  // surfaces (region UMAP, chr-dist track 3, or a dict-panel chip),
  // the same token gets a temporary glow/ring in every other surface
  // so the cross-view connection reads. The umap_x/umap_y travel with
  // the ping so the region UMAP can place its ring at the clicked
  // partner's coords (which may not equal the picked anchor's).
  type Ping = { tokenId: number; umap_x: number; umap_y: number; t: number };
  const [ping, setPing] = useState<Ping | null>(null);
  const PING_MS = 1200;
  const triggerPing = useCallback(
    (tokenId: number, umap_x: number, umap_y: number) => {
      const t = Date.now();
      setPing({ tokenId, umap_x, umap_y, t });
      setTimeout(() => {
        setPing((cur) => (cur && cur.t === t ? null : cur));
      }, PING_MS);
    },
    [],
  );

  const onDictNavigate = useCallback(
    (target: { tokenId: number; position: number; umap_x: number; umap_y: number }) => {
      // Pan the chr-distribution zoom windows to the partner's midpoint…
      setWindow2Center(target.position);
      setWindow3Center(target.position);
      // …and recenter the region UMAP on the partner's UMAP coords at
      // a tighter zoom than the default so the click reads as "zoom in
      // on this point" (bedbase-ui centerOnPoint pattern).
      setRegionViewport({ x: target.umap_x, y: target.umap_y, scale: 0.7 });
      triggerPing(target.tokenId, target.umap_x, target.umap_y);
    },
    [triggerPing],
  );

  const onChrTokenClick = useCallback(
    (token: { token_id: number; umap_x: number; umap_y: number }) => {
      // Mirror the dict-card click: ping the cross-views and also
      // recenter the region UMAP on the clicked token (centerOnPoint).
      triggerPing(token.token_id, token.umap_x, token.umap_y);
      setRegionViewport({ x: token.umap_x, y: token.umap_y, scale: 0.7 });
    },
    [triggerPing],
  );

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
    // No ping on UMAP click — picking a region already moves the
    // picked star to the new point, which is signal enough.
    setPicked(p);
  }, []);

  const filterSummary = useMemo(() => {
    if (brushedFileIds.length > 0) {
      return `${brushedFileIds.length.toLocaleString()} selected`;
    }
    const pins = [...pinnedAssays, ...pinnedCellLines];
    if (pins.length === 0) return null;
    const fileCount = pinnedFileIds?.length ?? 0;
    // Header space is tight; the FilterButton dropdown shows the actual
    // pin labels, so the suffix only needs the resulting file count.
    return `${fileCount.toLocaleString()} selected`;
  }, [brushedFileIds, pinnedAssays, pinnedCellLines, pinnedFileIds]);

  // Section 1 (raw signal → peaks → tokens) state — same data + picker
  // pattern as the Reference draft. Lives above the UMAP/histogram grid
  // and isn't part of the 100vh height calculation.
  const { intervals, loading: intervalsLoading } = useFeaturedIntervals();
  const { files: section1Files } = useFeaturedFiles();
  const [pickedIntervalId, setPickedIntervalId] = useState<string | null>(null);
  const interval = useMemo<CandidateInterval | null>(() => {
    if (intervals.length === 0) return null;
    const found = pickedIntervalId
      ? intervals.find((i) => i.interval_id === pickedIntervalId)
      : null;
    return found ?? intervals[0];
  }, [pickedIntervalId, intervals]);
  const [userMode, setUserMode] = useState<Section1Mode>('continuous');
  const isParquetInterval = interval?.source === 'parquet';
  const section1Mode: Section1Mode = isParquetInterval ? userMode : 'tokens';
  const section1DisabledModes: Section1Mode[] = isParquetInterval
    ? []
    : ['continuous', 'peaks'];

  return (
    <>
      {!isReady && (
        <LoadingSplash progress={loadProgress} error={coordError} />
      )}
    <main className="py-4 px-6 w-full flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-extralight">A Dictionary of Regulatory Genomics</h1>
          <span className="ml-auto text-xs text-base-content/60">
            <a
              href="https://databio.org/"
              target="_blank"
              rel="noreferrer"
              className="link link-hover"
            >
              databio.org
            </a>{' '}
            ·{' '}
            <a
              href="https://github.com/sanghoonio"
              target="_blank"
              rel="noreferrer"
              className="link link-hover"
            >
              sanghoonio
            </a>
          </span>
        </div>
        <p className="text-sm leading-normal text-base-content/80 mt-2">
          What are genomic regions? Epigenomic experiments
          measure something biochemical along the genome (protein binding,
          open chromatin, histone marks) by capturing the DNA fragments at
          sites where that activity happens and sequencing them. Aligning
          those reads
          back to the reference gives a{' '}
          <span className="font-semibold">continuous signal</span>: a
          per-base count of how many fragments cover each position. To
          summarize a file, researchers call{' '}
          <span className="font-semibold">peaks</span>: discrete BED
          regions where signal is high enough to count as an event, with
          each lab reporting its own peak set per file. Different files
          pick slightly different boundaries, so to compare regions across
          the corpus we snap each peak to a shared universe of{' '}
          <span className="font-semibold">tokens</span>. That shared
          dictionary is what makes co-occurrence queries tractable, and
          what each entry indexes.
        </p>
        <p className="text-sm leading-normal text-base-content/80 mt-2">
          A Word2Vec-style model called{' '}
          <span className="font-semibold">Region2Vec</span> learns each
          region's embedding from the tokens it co-occurs with across the
          BED corpus, and a single experiment is then represented as the
          mean of its tokens' embeddings. Below, four panels make up the
          dictionary: a <span className="font-semibold">file UMAP</span>{' '}
          (each file's mean-pooled token embedding), a{' '}
          <span className="font-semibold">region UMAP</span> (each region's
          Region2Vec embedding), <span className="font-semibold">chromosome
          distribution histograms</span> showing where regions co-occur
          spatially along the chromosome, and a{' '}
          <span className="font-semibold">dictionary entry</span> listing a
          region's top co-occurrence partners, ranked by{' '}
          <span className="font-semibold">NPMI</span>, a score for how
          often two regions fire together across the corpus relative to
          what you'd expect by chance. With these you can do two main things: pick a region, optionally narrowing the corpus by
          brushing or pinning files, to see where its top co-occurring
          partners sit semantically and spatially; or color the region
          UMAP by per-region enrichment in a chosen file selection (the
          log-odds of a region firing inside the selection versus
          outside), aggregated by a biological attribute like assay or
          cell line, to see which regions tend to fire in which kinds of
          files, and where the model has learned coherent semantic
          patterns.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-3 items-start">
        <div className="flex flex-col gap-3 pt-1 text-sm leading-normal text-base-content/80">
          {/* Example-Intervals subsection — header scopes the whole
              left column (biology blurb + controls), then the prose,
              then the picker + view toggle, then a closing line that
              points the reader at the plot on the right. */}
          <h2 className="text-xs font-semibold uppercase tracking-wide text-base-content/60">
            Example Intervals
          </h2>
          {interval && (
            <p className="text-sm leading-normal text-base-content/80">
              Showing this for{' '}
              <span className="font-semibold">{interval.label}</span>
              {interval.narrative_caption
                ? `: ${interval.narrative_caption}`
                : '.'}
            </p>
          )}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-base-content/70 whitespace-nowrap min-w-[5rem]">
                Interval
              </span>
              <select
                className="select select-bordered select-xs flex-1 min-w-0"
                value={interval?.interval_id ?? ''}
                onChange={(e) => setPickedIntervalId(e.target.value)}
                disabled={intervalsLoading || intervals.length === 0}
              >
                {intervals.map((iv) => (
                  <option key={iv.interval_id} value={iv.interval_id}>
                    {iv.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-base-content/70 whitespace-nowrap min-w-[5rem]">
                View
              </span>
              <select
                className="select select-bordered select-xs flex-1 min-w-0"
                value={section1Mode}
                onChange={(e) => setUserMode(e.target.value as Section1Mode)}
              >
                <option
                  value="continuous"
                  disabled={section1DisabledModes.includes('continuous')}
                >
                  Continuous (raw signal)
                </option>
                <option
                  value="peaks"
                  disabled={section1DisabledModes.includes('peaks')}
                >
                  Peaks (BED calls)
                </option>
                <option
                  value="tokens"
                  disabled={section1DisabledModes.includes('tokens')}
                >
                  Tokens (R2V universe)
                </option>
              </select>
            </div>
          </div>
          <p className="text-sm leading-normal text-base-content/80">
            The full visual lives below. In token view, click a token on
            the right to make it the active pick; or select one in the
            region UMAP below. Everything else on the page updates to
            match.
          </p>
        </div>
        {interval && (
          <Section1Plot
            interval={interval}
            files={section1Files}
            mode={section1Mode}
            onPick={onPicked}
          />
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-2.5 items-start">
        {/* Left column: BED + region UMAPs stacked. Column height is
            max(600 px, 100vh) so on tall enough viewports the two cards
            split a viewport-tall slot — the rest of the page (title,
            right column overflow) scrolls normally around it. */}
        <div className="flex flex-col gap-2.5 pt-4 pb-2 h-[max(600px,calc(100vh-24px))]">
          <UMAPCard
            className="flex-1 min-h-0"
            title="BED File Embeddings"
            suffix={filterSummary ? `(${filterSummary})` : undefined}
            actions={
              <span className="inline-flex items-center gap-1">
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
                <ResetButton
                  onClick={() => {
                    onClearAll();
                    setFileColorBy('assay');
                    setFileViewport(
                      fileFit
                        ? { ...fileFit, scale: fileFit.scale * INITIAL_ZOOM }
                        : null,
                    );
                  }}
                  title="Reset filters, color mode, and zoom"
                />
              </span>
            }
          >
            <FileUMAP
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
            className="flex-1 min-h-0"
            title="Region Embeddings"
            suffix={
              effectiveRegionColorBy === 'enrichment' && enrichmentLoading
                ? '(computing…)'
                : picked && highlightTokenIds
                  ? `(picked + ${(highlightTokenIds.length - 1).toLocaleString()} partners)`
                  : undefined
            }
            actions={
              <span className="inline-flex items-center gap-1">
                <ColorByPicker
                  value={effectiveRegionColorBy}
                  onChange={(k) => setRegionColorBy(k as RegionColorBy)}
                  options={[
                    { key: 'cclass', label: 'SCREEN class' },
                    {
                      key: 'enrichment',
                      label: 'Selection enrichment',
                      available: enrichmentAvailable,
                      hint: enrichmentAvailable
                        ? undefined
                        : 'brush BED embedding first',
                    },
                  ]}
                />
                <ResetButton
                  onClick={() => {
                    setPicked(null);
                    setRegionColorBy('cclass');
                    setRegionViewport(
                      regionFit
                        ? { ...regionFit, scale: regionFit.scale * INITIAL_ZOOM }
                        : null,
                    );
                  }}
                  title="Clear pick, color mode, and zoom"
                />
              </span>
            }
          >
            <RegionUMAP
              onPickedChange={onPicked}
              highlightedTokenIds={highlightTokenIds ?? undefined}
              colorBy={effectiveRegionColorBy}
              enrichmentTable={enrichmentTableName}
              enrichmentVersion={enrichmentVersion}
              viewportState={regionViewport}
              onViewportState={setRegionViewport}
              pickedUmap={
                picked
                  ? {
                      x: picked.umap_x,
                      y: picked.umap_y,
                      color:
                        SCREEN_CLASS_COLORS[picked.cclass] ??
                        SCREEN_CLASS_COLORS.unclassed,
                    }
                  : null
              }
              pingKey={ping?.t}
              pingX={ping?.umap_x}
              pingY={ping?.umap_y}
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
            />
          </UMAPCard>
        </div>

        <div className="flex flex-col gap-2.5 pt-4 pb-2 h-[max(600px,calc(100vh-24px))] overflow-y-auto">
          <ChrDistributionTracks
            picked={picked}
            customFileIds={customFileIds}
            highlightTokenIds={highlightTokenIds}
            window2Center={window2Center}
            window3Center={window3Center}
            setWindow2Center={setWindow2Center}
            setWindow3Center={setWindow3Center}
            ping={ping}
            onTokenClick={onChrTokenClick}
          />
          <DictPanel
            picked={picked}
            isReady={isReady}
            customFileIds={customFileIds}
            ping={ping}
            onNavigate={onDictNavigate}
          />
        </div>
      </div>
    </main>
    </>
  );
}

function LoadingSplash({
  progress,
  error,
}: {
  progress: { done: number; total: number; label: string } | null;
  error: string | null;
}) {
  const pct = progress
    ? Math.round((progress.done / progress.total) * 100)
    : 0;
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-base-100/95 backdrop-blur-sm">
      {error ? (
        <>
          <span className="text-error text-sm font-semibold">
            Failed to load dictionary
          </span>
          <span className="text-xs text-base-content/60 max-w-md text-center font-mono">
            {error}
          </span>
        </>
      ) : (
        <>
          <span className="text-sm font-medium text-base-content/80">
            Loading dictionary…
          </span>
          <div className="flex flex-col items-center gap-1 w-72">
            <div className="h-1 w-full bg-base-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-[width]"
                // Width is data-driven.
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs text-base-content/50 tabular-nums">
              {progress
                ? `${progress.done} / ${progress.total} · ${progress.label}`
                : 'connecting to data…'}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
