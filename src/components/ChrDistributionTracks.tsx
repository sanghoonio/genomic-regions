// Three stacked chr16 distribution tracks rendered in a single SVG with
// pure d3 (d3-scale / d3-axis / d3-scale-chromatic / d3-selection).
//
// Track 1: full chr16, 250 bins (~360 kb each). Always visible.
// Track 2: 2 Mb window centered on picked.midpoint, 250 bins (~8 kb).
// Track 3: 20 kb window centered on picked.midpoint, 250 bins (~80 bp).
//
// Between adjacent tracks we draw a "zoom indicator": a translucent
// highlight rect over the parent track at the child's range, plus two
// diagonal connectors from the highlight's bottom corners down to the
// top corners of the child's plot area — same trick UCSC uses for its
// nested zoom views.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChrPicker } from './ChrPicker';
import { axisBottom, axisLeft } from 'd3-axis';
import { scaleLinear, scaleSequential } from 'd3-scale';
import { interpolateYlOrRd } from 'd3-scale-chromatic';
import { select } from 'd3-selection';
import {
  CHR16_END,
  composeBins,
  useChr16PartnerPositions,
  useChr16UniverseBins,
} from '../hooks/useChrDistribution';
import { useChrDistZoomBins } from '../hooks/useChrDistZoomBins';
// Parked alongside the WindowContext render below; uncomment when ready.
// import {
//   useChrWindowActivations,
//   type FileGroup,
//   type WindowUniverseRow,
// } from '../hooks/useChrWindowActivations';
// import { classColor } from '../lib/colors';
import type { PickedRegion } from './RegionUMAP';
import { UMAPCard } from './UMAPHeaderChip';

const N_BINS = 250;
const TRACK_2_HALF_SPAN = 1_000_000; // 2 Mb total
const TRACK_3_HALF_SPAN = 10_000;    // 20 kb total

const TRACK_HEIGHT = 128;
const GAP_HEIGHT = 38;
// Top margin reserves room for the centered label above the plot.
const MARGIN = { top: 22, right: 16, bottom: 24, left: 50 };

// 9-stop YlOrRd ramp — matches d3's interpolateYlOrRd used by the bars
// so the inline legend gradient mirrors the bar coloring exactly.
const YLORRD_STOPS = [
  '#ffffcc', '#ffeda0', '#fed976', '#feb24c', '#fd8d3c',
  '#fc4e2a', '#e31a1c', '#bd0026', '#800026',
];

// Context section sizes — universe row stays fixed below the histograms;
// file rows live in a scrollable container at FILE_LIST_HEIGHT viewport.
// Parked alongside WindowContext.
// const UNIVERSE_ROW_HEIGHT = 22;
// const FILE_ROW_HEIGHT = 10;
// const FILE_LIST_HEIGHT = 320;

type Bin = {
  binIndex: number;
  start: number;
  end: number;
  universe: number;
  partners: number;
};

type TrackSpec = {
  bins: Bin[] | null;
  range: [number, number];
  label: string;
  xTickFormat: (d: number) => string;
  /** Centered placeholder text drawn in the plot area when `bins` is
   * null. Lets each track explain what selection would fill it. */
  emptyMessage?: string;
};

export type ChrDistributionTracksProps = {
  picked: PickedRegion | null;
  customFileIds?: ReadonlyArray<string> | null;
};

export function ChrDistributionTracks({
  picked,
  customFileIds,
}: ChrDistributionTracksProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Placeholder chromosome selection: only chr16 has data plumbed
  // through right now, so the picker is dummy state for now. Surfacing
  // it in the header signals that multi-chromosome support is planned.
  const [selectedChrom, setSelectedChrom] = useState('chr16');

  // ---- data ------------------------------------------------------------
  const { bins: universe } = useChr16UniverseBins(N_BINS);
  const { positions: partnerPositions } = useChr16PartnerPositions(
    picked?.token_id ?? null,
    'NPMI',
    30,
    customFileIds,
  );
  const fullBins = useMemo(
    () => composeBins(universe, partnerPositions, N_BINS),
    [universe, partnerPositions],
  );

  const window2 = useMemo<[number, number] | null>(() => {
    if (!picked) return null;
    const lo = Math.max(0, picked.midpoint - TRACK_2_HALF_SPAN);
    const hi = Math.min(CHR16_END, picked.midpoint + TRACK_2_HALF_SPAN);
    return [lo, hi];
  }, [picked]);
  const window3 = useMemo<[number, number] | null>(() => {
    if (!picked) return null;
    const lo = Math.max(0, picked.midpoint - TRACK_3_HALF_SPAN);
    const hi = Math.min(CHR16_END, picked.midpoint + TRACK_3_HALF_SPAN);
    return [lo, hi];
  }, [picked]);

  const { bins: bins2 } = useChrDistZoomBins(
    window2,
    picked,
    customFileIds,
    N_BINS,
  );
  const { bins: bins3 } = useChrDistZoomBins(
    window3,
    picked,
    customFileIds,
    N_BINS,
  );

  // Per-file activations + universe regions inside track 3's window —
  // parked along with the WindowContext render. Revive together when
  // ready to bring the file-tracks list back.
  // const {
  //   universe: windowUniverse,
  //   files,
  //   totalFiles,
  //   loading: contextLoading,
  // } = useChrWindowActivations(window3, customFileIds);

  // ---- d3 render -------------------------------------------------------
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const svg = svgRef.current;
    if (!wrapper || !svg) return;

    // All 3 tracks are always rendered — the 2 Mb and 20 kb tracks fall
    // back to a chr16-midpoint placeholder window with `bins: null` when
    // no region is picked, so the layout stays stable and the bottom two
    // show blank-but-scaled axes until the user picks something.
    const range2: [number, number] =
      window2 ?? [
        CHR16_END / 2 - TRACK_2_HALF_SPAN,
        CHR16_END / 2 + TRACK_2_HALF_SPAN,
      ];
    const range3: [number, number] =
      window3 ?? [
        CHR16_END / 2 - TRACK_3_HALF_SPAN,
        CHR16_END / 2 + TRACK_3_HALF_SPAN,
      ];
    const tracks: TrackSpec[] = [
      {
        bins: fullBins,
        range: [0, CHR16_END],
        label: `Full chr16 · ${N_BINS} bins (~${Math.round(CHR16_END / N_BINS / 1000)} kb)`,
        xTickFormat: (d) => `${(d / 1e6).toFixed(0)}M`,
      },
      {
        bins: picked ? bins2 : null,
        range: range2,
        label: `2 Mb window · ${N_BINS} bins (~${Math.round((range2[1] - range2[0]) / N_BINS / 1000)} kb)`,
        xTickFormat: (d) => `${(d / 1e6).toFixed(2)}M`,
        emptyMessage: 'Pick a region on the UMAP to populate the 2 Mb window',
      },
      {
        bins: picked ? bins3 : null,
        range: range3,
        label: `20 kb window · ${N_BINS} bins (~${Math.round((range3[1] - range3[0]) / N_BINS)} bp)`,
        xTickFormat: (d) => `${(d / 1e3).toFixed(2)}k`,
        emptyMessage: 'Pick a region on the UMAP to populate the 20 kb window',
      },
    ];

    const ro = new ResizeObserver(() => render());
    ro.observe(wrapper);
    render();
    return () => ro.disconnect();

    function render() {
      if (!wrapper || !svg) return;
      const width = wrapper.clientWidth || 600;
      const totalHeight =
        tracks.length * TRACK_HEIGHT + (tracks.length - 1) * GAP_HEIGHT;
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(totalHeight));
      svg.setAttribute('viewBox', `0 0 ${width} ${totalHeight}`);

      const sel = select(svg);
      sel.selectAll('*').remove();

      const innerLeft = MARGIN.left;
      const innerRight = width - MARGIN.right;

      // Per-track scales — keyed by index so the connector pass below
      // can recover the parent's x scale to position the highlight rect.
      const xScales = tracks.map((t) =>
        scaleLinear().domain(t.range).range([innerLeft, innerRight]),
      );

      // Tracks.
      tracks.forEach((track, i) => {
        const yOffset = i * (TRACK_HEIGHT + GAP_HEIGHT);
        drawTrack(sel, track, xScales[i], yOffset, width, picked);
      });

      // Zoom-indicator connectors: parent[i] → child[i+1].
      for (let i = 0; i < tracks.length - 1; i++) {
        const parent = tracks[i];
        const child = tracks[i + 1];
        if (!parent.bins || !child.bins) continue;
        const parentY = i * (TRACK_HEIGHT + GAP_HEIGHT);
        const childY = (i + 1) * (TRACK_HEIGHT + GAP_HEIGHT);
        drawConnector(
          sel,
          xScales[i],
          child.range,
          parentY,
          childY,
          innerLeft,
          innerRight,
        );
      }
    }
  }, [fullBins, bins2, bins3, picked, window2, window3]);

  const poolLabel =
    customFileIds && customFileIds.length > 0
      ? `${customFileIds.length.toLocaleString()} files`
      : 'full corpus';

  return (
    <UMAPCard
      title="Chromosome Distributions"
      suffix={`(pool: ${poolLabel})`}
      actions={
        <ChrPicker value={selectedChrom} onChange={setSelectedChrom} />
      }
    >
      <div className="p-2 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 px-1 text-[10px] text-base-content/70">
          <span className="inline-flex items-center gap-1.5">
            <span className="font-medium">NPMI partners</span>
            <span>low</span>
            <span
              className="inline-block h-2 w-20 rounded-sm"
              style={{
                background: `linear-gradient(to right, ${YLORRD_STOPS.map((c, i) => `${c} ${(i / (YLORRD_STOPS.length - 1)) * 100}%`).join(', ')})`,
                backgroundClip: 'padding-box',
                boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.12)',
              }}
            />
            <span>high</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="font-medium">Bar height</span>
            <span>universe regions / bin</span>
          </span>
          {picked && (
            <span className="inline-flex items-center gap-1.5">
              <svg width="14" height="10" viewBox="0 0 14 10">
                <line
                  x1="7"
                  x2="7"
                  y1="0"
                  y2="10"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeDasharray="2,2"
                />
              </svg>
              <span>picked midpoint</span>
            </span>
          )}
        </div>
        <div ref={wrapperRef} className="w-full">
          <svg ref={svgRef} />
        </div>
        {/* Universe row + scrollable file tracks parked while we focus
            on the histograms. Wiring still in place via
            useChrWindowActivations + the WindowContext component below.
        {picked && window3 && windowUniverse && (
          <WindowContext
            range={window3}
            universe={windowUniverse}
            files={files}
            totalFiles={totalFiles}
            loading={contextLoading}
            picked={picked}
          />
        )}
        */}
      </div>
    </UMAPCard>
  );
}

// Universe row + scrollable file-rows block, aligned to track 3's
// 20 kb window. Universe sits in a fixed-position SVG directly below
// the histogram block; file rows live in a scrollable container so
// hundreds of BED files can be inspected without resizing the card.
// Parked alongside the WindowContext render call inside the parent
// component — revive both together.
/*
function WindowContext({
  range,
  universe,
  files,
  totalFiles,
  loading,
  picked,
}: {
  range: [number, number];
  universe: WindowUniverseRow[];
  files: FileGroup[] | null;
  totalFiles: number;
  loading: boolean;
  picked: PickedRegion;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const universeSvgRef = useRef<SVGSVGElement>(null);
  const filesSvgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const ro = new ResizeObserver(() => render());
    ro.observe(wrapper);
    render();
    return () => ro.disconnect();

    function render() {
      const universeSvg = universeSvgRef.current;
      const filesSvg = filesSvgRef.current;
      if (!wrapper || !universeSvg || !filesSvg) return;
      const width = wrapper.clientWidth || 600;

      const innerLeft = MARGIN.left;
      const innerRight = width - MARGIN.right;
      const x = scaleLinear().domain(range).range([innerLeft, innerRight]);

      // ---- universe row ----
      universeSvg.setAttribute('width', String(width));
      universeSvg.setAttribute('height', String(UNIVERSE_ROW_HEIGHT));
      universeSvg.setAttribute(
        'viewBox',
        `0 0 ${width} ${UNIVERSE_ROW_HEIGHT}`,
      );
      const uSel = select(universeSvg);
      uSel.selectAll('*').remove();

      uSel
        .append('text')
        .attr('x', innerLeft - 6)
        .attr('y', UNIVERSE_ROW_HEIGHT / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'end')
        .style('font-size', '9px')
        .style('font-weight', 500)
        .style('fill', 'currentColor')
        .style('opacity', 0.7)
        .text('UNIVERSE');

      uSel
        .selectAll<SVGRectElement, WindowUniverseRow>('rect.universe-token')
        .data(universe)
        .join('rect')
        .attr('class', 'universe-token')
        .attr('x', (d) => x(d.start))
        .attr('y', 4)
        .attr('width', (d) => Math.max(1, x(d.end) - x(d.start)))
        .attr('height', UNIVERSE_ROW_HEIGHT - 8)
        .attr('fill', (d) => classColor(d.cclass ?? 'unclassed'))
        .attr('stroke', '#666')
        .attr('stroke-width', 0.3)
        .append('title')
        .text(
          (d) =>
            `${d.region} · ${d.cclass ?? 'unclassed'} · ${(d.end - d.start).toLocaleString()} bp`,
        );

      // Picked indicator on universe row.
      if (
        picked.midpoint >= range[0] &&
        picked.midpoint <= range[1]
      ) {
        uSel
          .append('line')
          .attr('x1', x(picked.midpoint))
          .attr('x2', x(picked.midpoint))
          .attr('y1', 0)
          .attr('y2', UNIVERSE_ROW_HEIGHT)
          .attr('stroke', 'currentColor')
          .attr('stroke-width', 1.5)
          .attr('stroke-dasharray', '3,2');
      }

      // ---- file rows ----
      const fileList = files ?? [];
      const totalH = fileList.length * FILE_ROW_HEIGHT;
      filesSvg.setAttribute('width', String(width));
      filesSvg.setAttribute('height', String(Math.max(FILE_ROW_HEIGHT, totalH)));
      filesSvg.setAttribute(
        'viewBox',
        `0 0 ${width} ${Math.max(FILE_ROW_HEIGHT, totalH)}`,
      );
      const fSel = select(filesSvg);
      fSel.selectAll('*').remove();

      // Faint zebra rows + activations per file.
      const rowG = fSel.append('g');
      fileList.forEach((file, i) => {
        const yTop = i * FILE_ROW_HEIGHT;
        if (i % 2 === 1) {
          rowG
            .append('rect')
            .attr('x', innerLeft)
            .attr('y', yTop)
            .attr('width', innerRight - innerLeft)
            .attr('height', FILE_ROW_HEIGHT)
            .attr('fill', 'currentColor')
            .attr('fill-opacity', 0.025);
        }
        // Label column: cell_line · assay/target. Heavily truncated for
        // narrow rows; full label is in the <title> tooltip on the row.
        const label = rowG
          .append('text')
          .attr('x', innerLeft - 6)
          .attr('y', yTop + FILE_ROW_HEIGHT / 2)
          .attr('dy', '0.35em')
          .attr('text-anchor', 'end')
          .style('font-size', '8px')
          .style('fill', 'currentColor')
          .style('opacity', 0.7)
          .text(file.label.slice(0, 36));
        label.append('title').text(file.label);

        const tokenG = rowG.append('g');
        tokenG
          .selectAll<SVGRectElement, (typeof file.activations)[number]>(
            'rect.activation',
          )
          .data(file.activations)
          .join('rect')
          .attr('class', 'activation')
          .attr('x', (d) => x(d.start))
          .attr('y', yTop + 1)
          .attr('width', (d) => Math.max(1, x(d.end) - x(d.start)))
          .attr('height', FILE_ROW_HEIGHT - 2)
          .attr('fill', (d) => classColor(d.cclass ?? 'unclassed'))
          .attr('stroke', 'white')
          .attr('stroke-width', 0.25)
          .append('title')
          .text(
            (d) =>
              `${file.label}\ntoken ${d.token_id} (${d.cclass ?? 'unclassed'})\n${d.start.toLocaleString()}–${d.end.toLocaleString()}`,
          );
      });

      // Picked indicator across all file rows.
      if (
        picked.midpoint >= range[0] &&
        picked.midpoint <= range[1] &&
        totalH > 0
      ) {
        fSel
          .append('line')
          .attr('x1', x(picked.midpoint))
          .attr('x2', x(picked.midpoint))
          .attr('y1', 0)
          .attr('y2', totalH)
          .attr('stroke', 'currentColor')
          .attr('stroke-width', 1)
          .attr('stroke-opacity', 0.5)
          .attr('stroke-dasharray', '3,2');
      }
    }
  }, [range, universe, files, picked]);

  return (
    <div ref={wrapperRef} className="w-full flex flex-col">
      <svg ref={universeSvgRef} className="block" />
      <div
        className="w-full overflow-y-auto border-t border-base-300/50"
        style={{ height: FILE_LIST_HEIGHT }}
      >
        <svg ref={filesSvgRef} className="block" />
      </div>
      <div className="text-[10px] text-base-content/50 leading-snug px-1 pt-1">
        {loading
          ? 'computing window activations…'
          : files == null
            ? 'no activation data (query did not return)'
            : files.length === 0
              ? 'no files have token activations in this 20 kb window'
              : `${totalFiles.toLocaleString()} files with hits in this 20 kb window (scroll for more)`}
      </div>
    </div>
  );
}
*/

function drawTrack(
  sel: ReturnType<typeof select<SVGSVGElement, unknown>>,
  track: TrackSpec,
  x: ReturnType<typeof scaleLinear<number, number>>,
  yOffset: number,
  width: number,
  picked: PickedRegion | null,
) {
  const innerLeft = MARGIN.left;
  const innerRight = width - MARGIN.right;
  const innerTop = yOffset + MARGIN.top;
  const innerBottom = yOffset + TRACK_HEIGHT - MARGIN.bottom;

  const g = sel.append('g').attr('class', 'track');

  // Label — top-center of the track, above the plot area.
  g.append('text')
    .attr('x', (innerLeft + innerRight) / 2)
    .attr('y', yOffset + 14)
    .attr('text-anchor', 'middle')
    .style('font-size', '9px')
    .style('fill', 'currentColor')
    .style('opacity', 0.5)
    .text(track.label);


  const yMax = track.bins
    ? Math.max(1, ...track.bins.map((b) => b.universe))
    : 1;
  const y = scaleLinear().domain([0, yMax]).nice().range([innerBottom, innerTop]);

  // Bars — only when bins are available; without bins we still want the
  // axes + frame to anchor the layout (blank track placeholder), with a
  // centered prompt explaining what would fill it.
  if (track.bins) {
    const maxPartner = Math.max(1, ...track.bins.map((b) => b.partners));
    const color = scaleSequential(interpolateYlOrRd).domain([0, maxPartner]);

    const barG = g.append('g').attr('class', 'bars');
    barG
      .selectAll<SVGRectElement, Bin>('rect')
      .data(track.bins.filter((b) => b.universe > 0))
      .join('rect')
      .attr('x', (d) => x(d.start))
      .attr('y', (d) => y(d.universe))
      .attr('width', (d) => Math.max(0.5, x(d.end) - x(d.start) - 0.2))
      .attr('height', (d) => y(0) - y(d.universe))
      .attr('fill', (d) => (d.partners > 0 ? color(d.partners) : 'none'))
      .attr('stroke', '#888')
      .attr('stroke-width', 0.25);
  } else if (track.emptyMessage) {
    g.append('text')
      .attr('x', (innerLeft + innerRight) / 2)
      .attr('y', (innerTop + innerBottom) / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'middle')
      .style('font-size', '10px')
      .style('font-style', 'italic')
      .style('fill', 'currentColor')
      .style('opacity', 0.45)
      .text(track.emptyMessage);
  }

  // Picked-region indicator.
  if (
    picked &&
    picked.midpoint >= track.range[0] &&
    picked.midpoint <= track.range[1]
  ) {
    g.append('line')
      .attr('x1', x(picked.midpoint))
      .attr('x2', x(picked.midpoint))
      .attr('y1', innerTop)
      .attr('y2', innerBottom)
      .attr('stroke', 'currentColor')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '3,2');
  }

  // X axis.
  g.append('g')
    .attr('transform', `translate(0, ${innerBottom})`)
    .style('font-size', '9px')
    .call(
      axisBottom(x)
        .ticks(Math.max(2, Math.floor(width / 100)))
        .tickFormat((d) => track.xTickFormat(Number(d))),
    );

  // Y axis.
  g.append('g')
    .attr('transform', `translate(${innerLeft}, 0)`)
    .style('font-size', '9px')
    .call(axisLeft(y).ticks(3).tickFormat((d) => `${d}`));

  // Y label.
  g.append('text')
    .attr(
      'transform',
      `translate(${innerLeft - 36}, ${(innerTop + innerBottom) / 2}) rotate(-90)`,
    )
    .attr('text-anchor', 'middle')
    .style('font-size', '9px')
    .style('fill', 'currentColor')
    .style('opacity', 0.7)
    .text('regions / bin');

  // Plot border.
  g.append('rect')
    .attr('x', innerLeft)
    .attr('y', innerTop)
    .attr('width', innerRight - innerLeft)
    .attr('height', innerBottom - innerTop)
    .attr('fill', 'none')
    .attr('stroke', '#ddd')
    .attr('stroke-width', 0.5);
}

function drawConnector(
  sel: ReturnType<typeof select<SVGSVGElement, unknown>>,
  parentX: ReturnType<typeof scaleLinear<number, number>>,
  childRange: [number, number],
  parentYOffset: number,
  childYOffset: number,
  innerLeft: number,
  innerRight: number,
) {
  const parentInnerTop = parentYOffset + MARGIN.top;
  const parentInnerBottom = parentYOffset + TRACK_HEIGHT - MARGIN.bottom;
  const childInnerTop = childYOffset + MARGIN.top;

  // Highlight rect over the parent's plot area at the child's range.
  // Clamped so a wide child range never spills outside the plot frame.
  const hLeft = Math.max(innerLeft, parentX(childRange[0]));
  const hRight = Math.min(innerRight, parentX(childRange[1]));

  // Ensure the highlight is at least 1.5 px wide so it stays visible
  // when the child range is much narrower than a parent pixel.
  const minHighlightWidth = 1.5;
  const highlightLeft =
    hRight - hLeft >= minHighlightWidth
      ? hLeft
      : Math.max(innerLeft, hLeft + (hRight - hLeft) / 2 - minHighlightWidth / 2);
  const highlightRight =
    hRight - hLeft >= minHighlightWidth
      ? hRight
      : Math.min(
          innerRight,
          highlightLeft + minHighlightWidth,
        );

  const g = sel.append('g').attr('class', 'connector');

  // Trapezoid fill — blue at the top (matching the highlight rect),
  // fading to transparent by the time it reaches the child plot's top.
  // Each connector gets its own gradient since the vertical extent
  // differs per pair of tracks.
  const gradientId = `chr-zoom-grad-${parentYOffset}`;
  const defs = g.append('defs');
  const gradient = defs
    .append('linearGradient')
    .attr('id', gradientId)
    .attr('gradientUnits', 'userSpaceOnUse')
    .attr('x1', 0)
    .attr('y1', parentInnerBottom)
    .attr('x2', 0)
    .attr('y2', childInnerTop);
  gradient
    .append('stop')
    .attr('offset', '0%')
    .attr('stop-color', '#3b82f6')
    .attr('stop-opacity', 0.12);
  gradient
    .append('stop')
    .attr('offset', '100%')
    .attr('stop-color', '#3b82f6')
    .attr('stop-opacity', 0);

  g.append('polygon')
    .attr(
      'points',
      [
        [highlightLeft, parentInnerBottom],
        [highlightRight, parentInnerBottom],
        [innerRight, childInnerTop],
        [innerLeft, childInnerTop],
      ]
        .map((p) => p.join(','))
        .join(' '),
    )
    .attr('fill', `url(#${gradientId})`)
    .attr('stroke', 'none');

  // Highlight rect on top of the parent — fill only.
  g.append('rect')
    .attr('x', highlightLeft)
    .attr('y', parentInnerTop)
    .attr('width', highlightRight - highlightLeft)
    .attr('height', parentInnerBottom - parentInnerTop)
    .attr('fill', '#3b82f6')
    .attr('fill-opacity', 0.12)
    .attr('stroke', 'none');

  // Open dotted border — top + left + right only. Bottom stays open
  // because the trapezoid below picks up from there.
  g.append('path')
    .attr(
      'd',
      `M ${highlightLeft} ${parentInnerBottom} ` +
        `L ${highlightLeft} ${parentInnerTop} ` +
        `L ${highlightRight} ${parentInnerTop} ` +
        `L ${highlightRight} ${parentInnerBottom}`,
    )
    .attr('fill', 'none')
    .attr('stroke', '#3b82f6')
    .attr('stroke-width', 1)
    .attr('stroke-opacity', 0.6)
    .attr('stroke-dasharray', '2,2');

  // Diagonal connectors: parent highlight bottom → child plot-area top.
  const linePoints: Array<[number, number, number, number]> = [
    [highlightLeft, parentInnerBottom, innerLeft, childInnerTop],
    [highlightRight, parentInnerBottom, innerRight, childInnerTop],
  ];
  for (const [x1, y1, x2, y2] of linePoints) {
    g.append('line')
      .attr('x1', x1)
      .attr('y1', y1)
      .attr('x2', x2)
      .attr('y2', y2)
      .attr('stroke', '#3b82f6')
      .attr('stroke-width', 1)
      .attr('stroke-opacity', 0.5)
      .attr('stroke-dasharray', '2,2')
      .attr('fill', 'none');
  }
}
