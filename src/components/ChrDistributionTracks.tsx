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

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { ChrPicker } from './ChrPicker';
import { ResetButton } from './ResetButton';
import { axisBottom, axisLeft } from 'd3-axis';
import { scaleLinear, scaleSequential } from 'd3-scale';
import { interpolateYlOrRd } from 'd3-scale-chromatic';
import { select } from 'd3-selection';
import { drag as d3Drag } from 'd3-drag';
import {
  CHR16_END,
  composeBins,
  useChr16PartnerPositions,
  useChr16UniverseBins,
  useChr16WindowTokens,
  type WindowToken,
} from '../hooks/useChrDistribution';
import { useChrDistZoomBins } from '../hooks/useChrDistZoomBins';
import { classColor } from '../lib/colors';
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
  /** When set, the track renders as token rectangles colored by
   * SCREEN class instead of binned histogram bars. Used for the
   * deepest zoom where binning is overkill. */
  tokens?: WindowToken[] | null;
};

export type ChrDistributionTracksProps = {
  picked: PickedRegion | null;
  customFileIds?: ReadonlyArray<string> | null;
  /** Token IDs treated as "hits" in the deepest token track (picked
   * region + its top NPMI partners). Tokens not in this set still
   * render but as a clear outline-only rect for spatial context. */
  highlightTokenIds?: ReadonlyArray<number> | null;
  /** Controlled zoom-window centers — owned by the parent so other
   * components (e.g., DictPanel) can pan the strip programmatically. */
  window2Center: number | null;
  window3Center: number | null;
  setWindow2Center: Dispatch<SetStateAction<number | null>>;
  setWindow3Center: Dispatch<SetStateAction<number | null>>;
};

export function ChrDistributionTracks({
  picked,
  customFileIds,
  highlightTokenIds,
  window2Center,
  window3Center,
  setWindow2Center,
  setWindow3Center,
}: ChrDistributionTracksProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Placeholder chromosome selection: only chr16 has data plumbed
  // through right now, so the picker is dummy state for now. Surfacing
  // it in the header signals that multi-chromosome support is planned.
  const [selectedChrom, setSelectedChrom] = useState('chr16');

  // ---- data ------------------------------------------------------------
  const { bins: universe } = useChr16UniverseBins(N_BINS);
  const { positions: partnerPositions, loading: partnersLoading } =
    useChr16PartnerPositions(
      picked?.token_id ?? null,
      'NPMI',
      30,
      customFileIds,
    );
  // Blur every track while NPMI co-occurrence is recomputing for the
  // active pick — the YlOrRd partner-count fills + the token track's
  // hit-vs-non-hit styling all read from this same partner set.
  const histsBlurred = !!picked && partnersLoading;
  const fullBins = useMemo(
    () => composeBins(universe, partnerPositions, N_BINS),
    [universe, partnerPositions],
  );

  const window2 = useMemo<[number, number] | null>(() => {
    if (window2Center == null) return null;
    const lo = Math.max(0, window2Center - TRACK_2_HALF_SPAN);
    const hi = Math.min(CHR16_END, window2Center + TRACK_2_HALF_SPAN);
    return [lo, hi];
  }, [window2Center]);
  const window3 = useMemo<[number, number] | null>(() => {
    if (window3Center == null) return null;
    const lo = Math.max(0, window3Center - TRACK_3_HALF_SPAN);
    const hi = Math.min(CHR16_END, window3Center + TRACK_3_HALF_SPAN);
    return [lo, hi];
  }, [window3Center]);

  const { bins: bins2 } = useChrDistZoomBins(
    window2,
    picked,
    customFileIds,
    N_BINS,
  );
  // Track 3 swaps the binned histogram for individual token rectangles
  // — at 20 kb / 250 bins each bin is ~80 bp, so most bins hold one
  // token anyway. Show tokens at their actual coords colored by
  // SCREEN class instead.
  const { tokens: window3Tokens } = useChr16WindowTokens(window3);
  const hitTokenSet = useMemo(
    () => new Set<number>(highlightTokenIds ?? []),
    [highlightTokenIds],
  );

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
        emptyMessage:
          'Click a region on the region UMAP to populate the 2 Mb window',
      },
      {
        // Synthesize a non-null `bins` array so the connector pass
        // still runs (it gates on parent.bins && child.bins). The
        // bars themselves come from `tokens` instead.
        bins: picked ? [] : null,
        tokens: picked ? window3Tokens : null,
        range: range3,
        label: `20 kb window · tokens by SCREEN class`,
        xTickFormat: (d) => `${(d / 1e3).toFixed(2)}k`,
        emptyMessage:
          'Click a region on the region UMAP to populate the 20 kb window',
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

      // Hover tooltip — direct DOM mutation so mousemove doesn't churn
      // React state. Closures over wrapperRef + tooltipRef.
      const showTooltip = (event: MouseEvent, html: string) => {
        const tip = tooltipRef.current;
        const wrap = wrapperRef.current;
        if (!tip || !wrap) return;
        tip.innerHTML = html;
        const wRect = wrap.getBoundingClientRect();
        const cx = event.clientX - wRect.left;
        const cy = event.clientY - wRect.top;
        // Show before measuring so getBoundingClientRect returns real
        // dimensions; then clamp into the wrapper.
        tip.style.visibility = 'visible';
        const tRect = tip.getBoundingClientRect();
        const offset = 12;
        const x = Math.max(
          4,
          Math.min(wRect.width - tRect.width - 4, cx + offset),
        );
        const y = Math.max(
          4,
          Math.min(wRect.height - tRect.height - 4, cy + offset),
        );
        tip.style.left = `${x}px`;
        tip.style.top = `${y}px`;
      };
      const hideTooltip = () => {
        const tip = tooltipRef.current;
        if (tip) tip.style.visibility = 'hidden';
      };

      // Per-track scales — keyed by index so the connector pass below
      // can recover the parent's x scale to position the highlight rect.
      const xScales = tracks.map((t) =>
        scaleLinear().domain(t.range).range([innerLeft, innerRight]),
      );

      // Tracks.
      tracks.forEach((track, i) => {
        const yOffset = i * (TRACK_HEIGHT + GAP_HEIGHT);
        drawTrack(
          sel,
          track,
          xScales[i],
          yOffset,
          width,
          picked,
          hitTokenSet,
          showTooltip,
          hideTooltip,
        );
      });

      // Zoom-indicator connectors: parent[i] → child[i+1]. The drag
      // handler shifts the child's center to an absolute value (start
      // center + cumulative pixel offset / pxPerBp). Track 1's drag
      // also carries the deeper window along by the same delta —
      // strip-chart style.
      for (let i = 0; i < tracks.length - 1; i++) {
        const parent = tracks[i];
        const child = tracks[i + 1];
        if (!parent.bins || !child.bins) continue;
        const parentY = i * (TRACK_HEIGHT + GAP_HEIGHT);
        const childY = (i + 1) * (TRACK_HEIGHT + GAP_HEIGHT);
        // Closure-captured starts populated on dragStart, cleared on
        // dragEnd. Absolute values avoid drift from per-tick deltas.
        const setAbsolute = (newCenter2: number, newCenter3: number) => {
          const c2 = Math.max(0, Math.min(CHR16_END, newCenter2));
          const c3 = Math.max(0, Math.min(CHR16_END, newCenter3));
          if (i === 0) {
            setWindow2Center(c2);
            setWindow3Center(c3);
          } else {
            setWindow3Center(c3);
          }
        };
        // Blur every track *below* the connector's parent — those are
        // the ones whose data is about to change. Direct DOM mutation
        // so we don't churn React state mid-drag (which would remount
        // the SVG and break d3-drag's pointer container).
        const setDragBlur = (active: boolean) => {
          for (let j = 0; j < tracks.length; j++) {
            const tg = sel.select<SVGGElement>(`g.track-${j}`);
            if (active && j > i) {
              tg.style('filter', 'blur(2px)').style('opacity', 0.5);
            } else {
              tg.style('filter', null).style('opacity', null);
            }
          }
        };
        drawConnector(
          sel,
          xScales[i],
          child.range,
          parentY,
          childY,
          innerLeft,
          innerRight,
          {
            // Captured at drag start so absolute math works against the
            // exact center the user grabbed, not a state value mid-flight.
            getStartCenters: () => ({
              c2: window2Center ?? 0,
              c3: window3Center ?? 0,
            }),
            applyAbsolute: setAbsolute,
            isTrackOne: i === 0,
            setDragBlur,
          },
        );
      }
    }
  }, [fullBins, bins2, window3Tokens, picked, window2, window3]);

  const poolLabel =
    customFileIds && customFileIds.length > 0
      ? `${customFileIds.length.toLocaleString()} files`
      : 'full corpus';

  return (
    <UMAPCard
      title="Chromosome Distributions"
      suffix={`(pool: ${poolLabel})`}
      actions={
        <span className="inline-flex items-center gap-1">
          <ChrPicker value={selectedChrom} onChange={setSelectedChrom} />
          <ResetButton
            onClick={() => {
              setSelectedChrom('chr16');
              setWindow2Center(picked?.midpoint ?? null);
              setWindow3Center(picked?.midpoint ?? null);
            }}
            title="Recenter zoom windows on the active pick"
          />
        </span>
      }
    >
      <div className="p-2 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-y-1.5 px-1 text-xs text-base-content/70">
          <span className="inline-flex items-center gap-1.5">
            <span className="font-medium">Co-occurrence partners</span>
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
              <span>picked region</span>
            </span>
          )}
        </div>
        <div
          ref={wrapperRef}
          className={`w-full relative transition-opacity duration-200 ${
            histsBlurred ? 'opacity-50' : ''
          }`}
          aria-busy={histsBlurred}
        >
          <svg ref={svgRef} />
          {/* Custom hover tooltip — populated and positioned via direct
              DOM mutation by the d3 effect below; kept always-mounted
              with visibility:hidden so we don't churn React state on
              every mousemove. */}
          <div
            ref={tooltipRef}
            className="absolute z-20 bg-base-100 border border-base-300 rounded-md shadow-md px-2 py-1.5 text-[11px] leading-snug text-base-content pointer-events-none"
            style={{
              visibility: 'hidden',
              left: 0,
              top: 0,
              maxWidth: '240px',
            }}
          />
        </div>
      </div>
    </UMAPCard>
  );
}


function drawTrack(
  sel: ReturnType<typeof select<SVGSVGElement, unknown>>,
  track: TrackSpec,
  x: ReturnType<typeof scaleLinear<number, number>>,
  yOffset: number,
  width: number,
  picked: PickedRegion | null,
  hitTokenSet: ReadonlySet<number>,
  showTooltip: (event: MouseEvent, html: string) => void,
  hideTooltip: () => void,
) {
  const innerLeft = MARGIN.left;
  const innerRight = width - MARGIN.right;
  const innerTop = yOffset + MARGIN.top;
  const innerBottom = yOffset + TRACK_HEIGHT - MARGIN.bottom;

  // Track index encoded as a data attribute so drag callbacks can blur
  // the tracks below the dragged source by selector.
  const trackIndex = Math.round(yOffset / (TRACK_HEIGHT + GAP_HEIGHT));
  const g = sel
    .append('g')
    .attr('class', `track track-${trackIndex}`)
    .attr('data-track-index', trackIndex);

  // Label — top-center of the track, above the plot area.
  g.append('text')
    .attr('x', (innerLeft + innerRight) / 2)
    .attr('y', yOffset + 14)
    .attr('text-anchor', 'middle')
    .style('font-size', '10px')
    .style('fill', 'currentColor')
    .style('opacity', 0.5)
    .text(track.label);


  const isTokensTrack = track.tokens !== undefined;
  const yMax = track.bins
    ? Math.max(1, ...track.bins.map((b) => b.universe))
    : 1;
  const y = scaleLinear().domain([0, yMax]).nice().range([innerBottom, innerTop]);

  if (isTokensTrack) {
    // Token rectangles colored by SCREEN class. At ~80 bp/bin a binned
    // histogram is overkill, so each chr16 universe token in the
    // window gets a real rect at its actual coords.
    const tokens = track.tokens ?? [];
    if (tokens.length > 0) {
      const lanePadding = 4;
      const tokG = g.append('g').attr('class', 'tokens');
      tokG
        .selectAll<SVGRectElement, WindowToken>('rect')
        .data(tokens)
        .join('rect')
        .attr('x', (d) => x(d.start))
        .attr('y', innerTop + lanePadding)
        .attr('width', (d) => Math.max(1, x(d.end) - x(d.start)))
        .attr('height', innerBottom - innerTop - lanePadding * 2)
        // Hits (picked + top NPMI partners) get a saturated SCREEN-class
        // fill; non-hits get the same fill at very low opacity so they
        // still read as "this slot of universe is occupied" but recede
        // visually instead of competing with the hits. Stroke restored
        // to the class color so the rect edge follows the cclass cue.
        .attr('fill', (d) => classColor(d.cclass))
        .attr('fill-opacity', (d) => (hitTokenSet.has(d.token_id) ? 1 : 0.1))
        .attr('stroke', (d) => classColor(d.cclass))
        .attr('stroke-width', (d) => (hitTokenSet.has(d.token_id) ? 0.4 : 0.6))
        .attr('stroke-opacity', (d) =>
          hitTokenSet.has(d.token_id) ? 1 : 0.4,
        )
        .on('mouseenter mousemove', function (event, d) {
          showTooltip(event, formatTokenTooltip(d, picked, hitTokenSet));
        })
        .on('mouseleave', hideTooltip);
    } else if (!picked && track.emptyMessage) {
      // No pick yet — show the prompt centered in the plot area.
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
    // Otherwise (pick set, tokens still loading, or window genuinely
    // empty): render only the axes/frame.
  } else if (track.bins) {
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
      .attr('stroke-width', 0.25)
      .on('mouseenter mousemove', function (event, d) {
        showTooltip(event, formatBinTooltip(d));
      })
      .on('mouseleave', hideTooltip);
  } else if (track.emptyMessage) {
    g.append('text')
      .attr('x', (innerLeft + innerRight) / 2)
      .attr('y', (innerTop + innerBottom) / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'middle')
      .style('font-size', '11px')
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
    .style('font-size', '10px')
    .call(
      axisBottom(x)
        .ticks(Math.max(2, Math.floor(width / 100)))
        .tickFormat((d) => track.xTickFormat(Number(d))),
    );

  // Y axis + label — only meaningful for the binned histogram tracks.
  // The tokens track shows individual rects with no count semantic, so
  // we suppress both to keep the gutter clean.
  if (!isTokensTrack) {
    g.append('g')
      .attr('transform', `translate(${innerLeft}, 0)`)
      .style('font-size', '10px')
      .call(axisLeft(y).ticks(3).tickFormat((d) => `${d}`));

    g.append('text')
      .attr(
        'transform',
        `translate(${innerLeft - 36}, ${(innerTop + innerBottom) / 2}) rotate(-90)`,
      )
      .attr('text-anchor', 'middle')
      .style('font-size', '10px')
      .style('fill', 'currentColor')
      .style('opacity', 0.7)
      .text('regions / bin');
  }

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

type DragWiring = {
  getStartCenters: () => { c2: number; c3: number };
  applyAbsolute: (newCenter2: number, newCenter3: number) => void;
  isTrackOne: boolean;
  /** Toggles a blur+dim on the tracks below the dragged source so the
   * user gets a "this data is about to change" cue. */
  setDragBlur: (active: boolean) => void;
};

function drawConnector(
  sel: ReturnType<typeof select<SVGSVGElement, unknown>>,
  parentX: ReturnType<typeof scaleLinear<number, number>>,
  childRange: [number, number],
  parentYOffset: number,
  childYOffset: number,
  innerLeft: number,
  innerRight: number,
  /** When provided, the highlight rect becomes draggable. Drags compute
   * an absolute center from `(startCenter + cursorOffsetInPx / pxPerBp)`
   * — captured-at-drag-start to avoid per-tick drift. */
  drag?: DragWiring,
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

  // Element handles — kept around so the drag handler can manipulate
  // them directly during a drag (no React state churn = no SVG remount
  // = pointer-coord math stays valid throughout the gesture).
  const polygon = g
    .append('polygon')
    .attr(
      'points',
      buildTrapezoidPoints(
        highlightLeft,
        highlightRight,
        parentInnerBottom,
        innerLeft,
        innerRight,
        childInnerTop,
      ),
    )
    .attr('fill', `url(#${gradientId})`)
    .attr('stroke', 'none')
    .attr('pointer-events', 'none');

  // Highlight rect on top of the parent. When `drag` is supplied this
  // is the drag target — see below.
  const highlightRect = g
    .append('rect')
    .attr('x', highlightLeft)
    .attr('y', parentInnerTop)
    .attr('width', highlightRight - highlightLeft)
    .attr('height', parentInnerBottom - parentInnerTop)
    .attr('fill', '#3b82f6')
    .attr('fill-opacity', 0.12)
    .attr('stroke', 'none');

  // Open dotted border — top + left + right only.
  const dashedPath = g
    .append('path')
    .attr(
      'd',
      buildDashedBorder(
        highlightLeft,
        highlightRight,
        parentInnerTop,
        parentInnerBottom,
      ),
    )
    .attr('fill', 'none')
    .attr('stroke', '#3b82f6')
    .attr('stroke-width', 1)
    .attr('stroke-opacity', 0.6)
    .attr('stroke-dasharray', '2,2')
    .attr('pointer-events', 'none');

  // Diagonal connectors: parent highlight bottom → child plot-area top.
  const lineLeft = g
    .append('line')
    .attr('x1', highlightLeft)
    .attr('y1', parentInnerBottom)
    .attr('x2', innerLeft)
    .attr('y2', childInnerTop)
    .attr('stroke', '#3b82f6')
    .attr('stroke-width', 1)
    .attr('stroke-opacity', 0.5)
    .attr('stroke-dasharray', '2,2')
    .attr('fill', 'none')
    .attr('pointer-events', 'none');
  const lineRight = g
    .append('line')
    .attr('x1', highlightRight)
    .attr('y1', parentInnerBottom)
    .attr('x2', innerRight)
    .attr('y2', childInnerTop)
    .attr('stroke', '#3b82f6')
    .attr('stroke-width', 1)
    .attr('stroke-opacity', 0.5)
    .attr('stroke-dasharray', '2,2')
    .attr('fill', 'none')
    .attr('pointer-events', 'none');

  if (drag) {
    const pxPerBp =
      (parentX.range()[1] - parentX.range()[0]) /
      (parentX.domain()[1] - parentX.domain()[0]);

    let startC2 = 0;
    let startC3 = 0;
    let startPx = 0;

    // Pure-DOM visual update during drag — no React state writes, so the
    // SVG <g> the drag handler bound to never gets removed mid-gesture.
    // The bottom two trapezoid corners + diagonal-line bottom endpoints
    // follow the highlight rect; the top corners stay anchored to the
    // child's plot frame.
    const moveVisualBy = (deltaPx: number) => {
      const newLeft = highlightLeft + deltaPx;
      const newRight = highlightRight + deltaPx;
      highlightRect.attr('x', newLeft);
      polygon.attr(
        'points',
        buildTrapezoidPoints(
          newLeft,
          newRight,
          parentInnerBottom,
          innerLeft,
          innerRight,
          childInnerTop,
        ),
      );
      dashedPath.attr(
        'd',
        buildDashedBorder(newLeft, newRight, parentInnerTop, parentInnerBottom),
      );
      lineLeft.attr('x1', newLeft);
      lineRight.attr('x1', newRight);
    };

    highlightRect
      .style('cursor', 'grab')
      .call(
        d3Drag<SVGRectElement, unknown>()
          .on('start', function (event) {
            select(this).style('cursor', 'grabbing');
            const starts = drag.getStartCenters();
            startC2 = starts.c2;
            startC3 = starts.c3;
            startPx = event.x;
            drag.setDragBlur(true);
          })
          .on('drag', (event) => {
            if (pxPerBp === 0 || !Number.isFinite(pxPerBp)) return;
            const offsetPx = event.x - startPx;
            if (!Number.isFinite(offsetPx)) return;
            moveVisualBy(offsetPx);
          })
          .on('end', function (event) {
            select(this).style('cursor', 'grab');
            // The committed React state below triggers a full re-render
            // of the SVG, which restores the unblurred children. We
            // still flip the flag in case the commit path early-exits.
            drag.setDragBlur(false);
            if (pxPerBp === 0 || !Number.isFinite(pxPerBp)) return;
            const offsetPx = event.x - startPx;
            if (!Number.isFinite(offsetPx)) return;
            const offsetBp = offsetPx / pxPerBp;
            // Now (and only now) commit to React state. The SVG will
            // re-render with the new center; bars + child track update.
            drag.applyAbsolute(
              drag.isTrackOne ? startC2 + offsetBp : startC2,
              startC3 + offsetBp,
            );
          }),
      );
  }
}

// Format a (start, end) bp interval for tooltips. Picks units based on
// the span's magnitude so a 360 kb track-1 bin reads in Mb while an
// 80 bp deep-zoom bin reads in bp.
function formatBinRange(start: number, end: number): string {
  const span = end - start;
  if (span >= 100_000) {
    return `${(start / 1e6).toFixed(2)}–${(end / 1e6).toFixed(2)} Mb`;
  }
  if (span >= 1_000) {
    return `${(start / 1e3).toFixed(1)}–${(end / 1e3).toFixed(1)} kb`;
  }
  return `${Math.round(start)}–${Math.round(end)} bp`;
}

// Signed distance from picked midpoint, scaled like the dict-panel
// chip distances (kb under 1 Mb, Mb otherwise). Unicode minus for
// nicer typography.
function formatSignedDistance(deltaBp: number): string {
  if (deltaBp === 0) return '0 bp';
  const sign = deltaBp > 0 ? '+' : '−';
  const abs = Math.abs(deltaBp);
  if (abs < 1_000) return `${sign}${abs} bp`;
  if (abs < 1_000_000) return `${sign}${(abs / 1_000).toFixed(0)} kb`;
  return `${sign}${(abs / 1_000_000).toFixed(2)} Mb`;
}

// HTML body for a histogram-bar tooltip — coord range on top, then a
// universe-region count, and the partner count when the bin has any.
function formatBinTooltip(d: Bin): string {
  const range = formatBinRange(d.start, d.end);
  const universeLine = `<span class="text-base-content/60">${d.universe.toLocaleString()}</span> region${d.universe === 1 ? '' : 's'} in bin`;
  const partnerLine =
    d.partners > 0
      ? `<div><span class="text-warning font-semibold">${d.partners.toLocaleString()}</span> co-occurrence partner${d.partners === 1 ? '' : 's'}</div>`
      : '';
  return `<div class="font-mono text-base-content">${escapeHtml(range)}</div><div>${universeLine}</div>${partnerLine}`;
}

// HTML body for a track-3 token tooltip — header reflects the token's
// role (picked / partner / regular), then class + coords + (when
// applicable) signed distance from the picked region.
function formatTokenTooltip(
  d: WindowToken,
  picked: PickedRegion | null,
  hitTokenSet: ReadonlySet<number>,
): string {
  const isPick = picked != null && d.token_id === picked.token_id;
  const isHit = hitTokenSet.has(d.token_id);
  const role = isPick
    ? '<span class="text-primary font-semibold">⊙ picked</span>'
    : isHit
      ? '<span class="text-warning font-semibold">★ partner</span>'
      : '<span class="text-base-content/50">universe token</span>';
  const cclassRow = `<div><span class="text-base-content/60">class</span> <span class="font-semibold">${escapeHtml(d.cclass)}</span></div>`;
  const coordsRow = `<div class="font-mono text-base-content">${d.start.toLocaleString()}–${d.end.toLocaleString()} <span class="text-base-content/50">(${(d.end - d.start).toLocaleString()} bp)</span></div>`;
  const distRow =
    picked && !isPick
      ? `<div><span class="text-base-content/60">${formatSignedDistance(Math.round((d.start + d.end) / 2) - picked.midpoint)}</span> from pick</div>`
      : '';
  return `<div>${role}</div>${cclassRow}${coordsRow}${distRow}`;
}

// Minimal HTML escape — the tooltip content comes from numeric fields
// + the cclass enum, so this is mostly defensive.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildTrapezoidPoints(
  hLeft: number,
  hRight: number,
  hBottom: number,
  iLeft: number,
  iRight: number,
  cTop: number,
): string {
  return [
    [hLeft, hBottom],
    [hRight, hBottom],
    [iRight, cTop],
    [iLeft, cTop],
  ]
    .map((p) => p.join(','))
    .join(' ');
}

function buildDashedBorder(
  left: number,
  right: number,
  top: number,
  bottom: number,
): string {
  return (
    `M ${left} ${bottom} ` +
    `L ${left} ${top} ` +
    `L ${right} ${top} ` +
    `L ${right} ${bottom}`
  );
}
