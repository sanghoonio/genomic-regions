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
import type { Section1Mode } from './Section1ModeToggle';
import { UMAPCard, UMAPLegendChip } from './UMAPHeaderChip';

const UNIVERSE_LABEL = 'UNIVERSE';
const PAD_LABEL = ' '; // invisible facet pad row so axis ticks clear the bottom

export type Section1PlotProps = {
  interval: CandidateInterval;
  files: FeaturedFile[] | null;
  mode: Section1Mode;
  /** Right-aligned controls slotted into the card header (e.g., the
   * interval picker + view-mode toggle). */
  headerActions?: ReactNode;
};

export function Section1Plot({
  interval,
  files,
  mode,
  headerActions,
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
    const plotHeight = Math.max(220, 18 * baseRows.length);

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
            dy: 5.5,
            fontSize: 9,
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
      marginLeft: 220,
      marginRight: 30,
      marginTop: 30,
      marginBottom: 40,
      // Shrinks default axis tick / label font from 10 → 9 across all
      // three views (continuous's custom axisFy/axisX marks pick this
      // up too via inheritance).
      style: { fontSize: '9px' },
      x: xScale,
      ...ySpec,
      color: colorSpec,
      marks: [...guideMarks, ...universeMarks, ...fileMarks],
    });

    el.appendChild(plot);
    return () => {
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
    tokenActivations,
    signalRows,
    peakRows,
    allFileLabels,
  ]);

  const captionStat =
    mode === 'tokens' && tokenActivations
      ? `${tokenActivations.length.toLocaleString()} (file × token) activations across ${allFileLabels.length} files`
      : mode === 'peaks' && peakRows
        ? `${peakRows.length.toLocaleString()} peaks across ${
            new Set(peakRows.map((r) => r.file_id)).size
          } files`
        : mode === 'continuous' && signalRows
          ? `bigwig signal sampled across ${allFileLabels.length} files`
          : null;

  const intervalSuffix = `(${interval.chrom}:${interval.start.toLocaleString()}–${interval.end.toLocaleString()}${regions ? ` · ${regions.length} universe tokens` : ''}${captionStat ? ` · ${captionStat}` : ''})`;

  return (
    <UMAPCard
      title="Section 1 · raw signal → peaks → tokens"
      suffix={intervalSuffix}
      actions={headerActions}
    >
      <div className="p-2 flex flex-col gap-2">
        {regionsError && (
          <div role="alert" className="alert alert-error text-sm">
            {regionsError}
          </div>
        )}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-base-content/60 leading-snug min-w-0 flex-1">
            {interval.narrative_caption ?? ' '}
          </p>
          <span className="shrink-0">
            <SectionLegend mode={mode} />
          </span>
        </div>
        <div ref={ref} className="w-full" aria-busy={regionsLoading} />
      </div>
    </UMAPCard>
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
  return <UMAPLegendChip items={items} orientation="horizontal" />;
}

function fileLabelOf(f: FeaturedFile): string {
  if (f.assay === 'ATAC-seq') return `${f.cell_line} · ATAC-seq`;
  if (f.target) return `${f.cell_line} · ${f.target}`;
  return `${f.cell_line} · ${f.assay}`;
}
