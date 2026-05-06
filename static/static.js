// Static D3 figure — see ./README.md for the design notes.
//
// Layout (top→bottom):
//   1. UMAP scatter (semantic-space view)
//   2. bezier connector zone (links each partner UMAP point ↔ chr16 position)
//   3. track A · full chr16 (90 Mb)
//   4. zoom indicator A→B (diagonals)
//   5. track B · 2 Mb window centered on anchor
//   6. zoom indicator B→C (diagonals)
//   7. track C · 20 kb window centered on anchor
//
// Stacking: rather than rely on source order across helper functions,
// every visual element is appended into one of the named layer groups
// below. The order of `LAYER_NAMES` is the painter's-order from
// bottom-most to top-most.

const SCREEN_COLORS = {
  PLS: '#ff0000',
  pELS: '#ffa700',
  dELS: '#ffcd00',
  'CA-CTCF': '#00b0f0',
  'CA-H3K4me3': '#ffaaaa',
  unclassed: '#cccccc',
};
const cclassColor = (c) => SCREEN_COLORS[c] ?? SCREEN_COLORS.unclassed;

// Canvas locked to 11x17 portrait aspect (= 0.647). At W=1080 that
// gives H≈1668. The UMAP is the dominant panel (near-square at the
// wider canvas) and the three chr tracks share the lower third.
const W = 1080;
const M = { top: 24, right: 28, bottom: 28, left: 28 };

// Title → question block → figure body → narrative caption. The
// question block frames what the visualization is asking, before
// the figure itself answers it.
const TITLE_H = 100;
const QUESTION_H = 80;
const UMAP_H = 720;
const CONN_H = 104;
const TRACK_H = 132;
const ZOOM_H = 28;
const CAPTION_H = 140;
const PANEL_GAP = 18;

const Y_TITLE_0 = M.top;
const Y_TITLE_1 = Y_TITLE_0 + TITLE_H;
const Y_QUESTION_0 = Y_TITLE_1;
const Y_QUESTION_1 = Y_QUESTION_0 + QUESTION_H;
const Y_UMAP_0 = Y_QUESTION_1;
const Y_UMAP_1 = Y_UMAP_0 + UMAP_H;
const Y_CONN_1 = Y_UMAP_1 + CONN_H;
const Y_A_0 = Y_CONN_1;
const Y_A_1 = Y_A_0 + TRACK_H;
const Y_AB_1 = Y_A_1 + ZOOM_H;
const Y_B_0 = Y_AB_1;
const Y_B_1 = Y_B_0 + TRACK_H;
const Y_BC_1 = Y_B_1 + ZOOM_H;
const Y_C_0 = Y_BC_1;
const Y_C_1 = Y_C_0 + TRACK_H;
const Y_CAPTION_0 = Y_C_1;
const Y_CAPTION_1 = Y_CAPTION_0 + CAPTION_H;
const H = Y_CAPTION_1 + M.bottom + PANEL_GAP;

const railFrac = 0.62;
const railY = (yTop) => yTop + TRACK_H * railFrac;

// Pin top y for any partner in a chr track. Pins are uniform-height
// now, so this no longer depends on NPMI; kept as a function so
// callers don't have to know the constant offset.
function lolliY(yTop /*, npmi, partnersInTrack */) {
  return yTop + 62;
}

// Painter order: bottom layers listed first.
//
// The zoom-indicator splits across two layers because the two halves
// have opposite z needs: the highlight *box* sits on the parent
// track's rail, so it must paint *above* chr_rail (so it visibly
// highlights the parent's chromosome). The descending *trapezoid*
// then drips down toward the destination track's rail, and the
// destination track's rail/context/axis must paint *above* the
// trapezoid so the trapezoid reads as flowing under the target. The
// box's bottom edge and the trapezoid's top edge are colinear at
// `parentRailY + 6`, and there are no chr_* elements at that y, so
// the two halves still appear seamless even though one is below
// chr_* and the other is above.
const LAYER_NAMES = [
  'cloud',          // UMAP background dots
  'zoom_trap',      // zoom-indicator trapezoid (below destination track)
  'chr_rail',       // chromosome bars
  'chr_context',    // per-region rects/ticks (above the rail so the 20 kb
                    //   track's class-colored region boxes aren't hidden
                    //   by the chromosome bar that runs through their middle)
  'chr_axis',       // x-axis ticks/labels
  'zoom_box',       // zoom-indicator highlight box (above origin track)
  'connector',      // bezier curves UMAP↔chr-A
  'lollipop',       // chr partner stems + circles
  'partner_umap',   // UMAP partner circles
  'anchor',         // anchor stars / halos in every panel
  'annotation_line',
  'annotation',     // annotation text + headline plate
  'panel_label',    // panel labels (top-most so they always read)
];

function main() {
  const data = window.STATIC_DATA;
  if (!data) throw new Error('window.STATIC_DATA missing — run duckdb prepare_data.sql');
  const { meta, anchor, partners, cloud, local_2mb, local_20kb } = data;

  const anchorMid = (anchor.start + anchor.end) / 2;

  // Stable partner draw order: distal first so cis sits on top in chr panels.
  const ordered = partners.slice().sort((a, b) => {
    const da = Math.abs((a.start + a.end) / 2 - anchorMid);
    const db = Math.abs((b.start + b.end) / 2 - anchorMid);
    return db - da;
  });

  // NPMI → opacity. Two scales: lollipops keep a generous range so
  // the chr-track pins read at full strength, while the UMAP↔chr-A
  // bezier connectors get a much fainter base with a wider gradient
  // so the top NPMI partners visibly stand out and the bottom-rank
  // partners almost disappear.
  const npmiVals = partners.map((p) => p.npmi);
  const npmiOpacity = d3.scaleLinear()
    .domain([Math.min(...npmiVals), Math.max(...npmiVals)])
    .range([0.35, 1.0])
    .clamp(true);
  const connectorOpacity = d3.scaleLinear()
    .domain([Math.min(...npmiVals), Math.max(...npmiVals)])
    .range([0.10, 0.6])
    .clamp(true);

  const svg = d3.select('#static')
    .attr('viewBox', `0 0 ${W} ${H}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .attr('overflow', 'hidden');
  svg.selectAll('*').remove();

  // Soft-edge filter shared by the pin-annotation backdrops. The
  // filter region is expanded so the blur isn't clipped at the
  // rect's nominal bounds.
  const defs = svg.append('defs');
  defs.append('filter')
    .attr('id', 'soft-edge')
    .attr('x', '-40%').attr('y', '-40%')
    .attr('width', '180%').attr('height', '180%')
    .append('feGaussianBlur').attr('stdDeviation', '3.5');

  // Build layer groups in painter order.
  const L = {};
  for (const name of LAYER_NAMES) {
    L[name] = svg.append('g').attr('class', `layer-${name}`);
  }

  // ----------------------------------------------------------------
  // Title block — matches the app's header exactly:
  // <h1 class="text-2xl font-extralight">…</h1> + a right-aligned
  // <span class="text-xs">databio.org · sanghoonio</span>, both
  // baseline-aligned the way `flex items-baseline` arranges them.
  // ----------------------------------------------------------------
  const titleBaseline = Y_TITLE_0 + 50;
  L.panel_label.append('text')
    .attr('class', 'svg-title')
    .attr('x', M.left).attr('y', titleBaseline)
    .text('A Dictionary of Regulatory Genomics');
  L.panel_label.append('text')
    .attr('class', 'svg-subtitle')
    .attr('x', W - M.right).attr('y', titleBaseline)
    .attr('text-anchor', 'end')
    .text('databio.org · sanghoonio');

  // Question block — frames the question this visualization is asking
  // before the figure itself answers it. Tight padding above the
  // questions, generous padding below so the block reads as a header
  // for what comes after, not a tail-piece of the title.
  const questions = [
    "What is the semantic identity of a regulatory region?",
    "Which regions co-occur in experimental data, and how far apart on the genome can they be?",
    "Do the semantic embeddings capture biology that genomic position alone cannot?",
  ];
  questions.forEach((q, i) => {
    L.panel_label.append('text')
      .attr('class', 'svg-question')
      .attr('x', M.left).attr('y', Y_QUESTION_0 + 6 + i * 18)
      .text(q);
  });


  // ----------------------------------------------------------------
  // UMAP (top panel)
  // ----------------------------------------------------------------
  const xExtent = d3.extent(cloud, (d) => d.x);
  const yExtent = d3.extent(cloud, (d) => d.y);
  const padFrac = 0.04;
  const xPad = (xExtent[1] - xExtent[0]) * padFrac;
  const yPad = (yExtent[1] - yExtent[0]) * padFrac;
  const xUmap = d3.scaleLinear()
    .domain([xExtent[0] - xPad, xExtent[1] + xPad])
    .range([M.left, W - M.right]);
  const yUmap = d3.scaleLinear()
    .domain([yExtent[0] - yPad, yExtent[1] + yPad])
    .range([Y_UMAP_1 - 8, Y_UMAP_0 + 22]);

  L.panel_label.append('text')
    .attr('class', 'panel-label')
    .attr('x', M.left).attr('y', Y_UMAP_0 + 4)
    .text('semantic embeddings of chr16 regions');

  // Cloud: every chr16 region as a tiny class-colored point at low
  // opacity. Keeps the SCREEN class structure of the embedding visible
  // in the background instead of flattening it to a single gray.
  L.cloud.selectAll('circle')
    .data(cloud).join('circle')
    .attr('cx', (d) => xUmap(d.x))
    .attr('cy', (d) => yUmap(d.y))
    .attr('r', 1.3)
    .attr('fill', (d) => cclassColor(d.c))
    .attr('fill-opacity', 0.65);

  L.partner_umap.selectAll('circle')
    .data(ordered).join('circle')
    .attr('class', 'partner-mark')
    .attr('cx', (p) => xUmap(p.umap_x))
    .attr('cy', (p) => yUmap(p.umap_y))
    .attr('r', 5)
    .attr('fill', (p) => cclassColor(p.cclass));

  drawAnchorMark(L.anchor, xUmap(anchor.umap_x), yUmap(anchor.umap_y), {
    halo: true, size: 110, label: 'CDH1 (anchor)', labelDx: 14, labelDy: 4,
  });

  // ----------------------------------------------------------------
  // Track A — full chr16
  // ----------------------------------------------------------------
  const xA = d3.scaleLinear().domain([0, meta.chr16_end]).range([M.left, W - M.right]);
  drawChrTrack({
    L, label: 'chr16 (full, 90 Mb)',
    yTop: Y_A_0, x: xA,
    partners: ordered, anchor,
    domain: [0, meta.chr16_end],
    xTickFormat: (d) => `${(d / 1e6).toFixed(0)} Mb`,
    npmiOpacity,
  });

  // ----------------------------------------------------------------
  // Track B — 2 Mb window
  // ----------------------------------------------------------------
  const win2 = [anchorMid - meta.win_2mb_half, anchorMid + meta.win_2mb_half];
  const xB = d3.scaleLinear().domain(win2).range([M.left, W - M.right]);
  const partnersInB = ordered.filter((p) => inWindow((p.start + p.end) / 2, win2));
  drawChrTrack({
    L, label: `2 Mb window (chr16:${(win2[0] / 1e6).toFixed(2)}–${(win2[1] / 1e6).toFixed(2)} Mb)`,
    yTop: Y_B_0, x: xB,
    partners: partnersInB, anchor,
    context: local_2mb,
    domain: win2,
    xTickFormat: (d) => `${(d / 1e6).toFixed(2)}M`,
    npmiOpacity,
  });
  drawZoomIndicator({
    L, parentX: xA, childX: xB,
    parentRailY: railY(Y_A_0), childRailY: railY(Y_B_0),
    range: win2,
  });

  // ----------------------------------------------------------------
  // Track C — 20 kb window
  // ----------------------------------------------------------------
  const win3 = [anchorMid - meta.win_20kb_half, anchorMid + meta.win_20kb_half];
  const xC = d3.scaleLinear().domain(win3).range([M.left, W - M.right]);
  const partnersInC = ordered.filter((p) => inWindow((p.start + p.end) / 2, win3));
  drawChrTrack({
    L, label: `20 kb window (chr16:${win3[0].toLocaleString()}–${win3[1].toLocaleString()})`,
    yTop: Y_C_0, x: xC,
    partners: partnersInC, anchor,
    context: local_20kb,
    contextAsTokens: true,
    domain: win3,
    xTickFormat: (d) => `${(d / 1000).toFixed(1)} kb`,
    npmiOpacity,
  });
  drawZoomIndicator({
    L, parentX: xB, childX: xC,
    parentRailY: railY(Y_B_0), childRailY: railY(Y_C_0),
    range: win3,
  });

  // ----------------------------------------------------------------
  // Connectors UMAP↔chr-A
  // ----------------------------------------------------------------
  const aRailTopY = railY(Y_A_0) - 4;
  L.connector.selectAll('path')
    .data(ordered).join('path')
    .attr('class', 'connector')
    .attr('stroke', (p) => cclassColor(p.cclass))
    .attr('stroke-opacity', (p) => connectorOpacity(p.npmi))
    .attr('d', (p) => {
      const x1 = xUmap(p.umap_x);
      const y1 = yUmap(p.umap_y);
      const x2 = xA((p.start + p.end) / 2);
      const y2 = aRailTopY;
      const cy = y1 + (y2 - y1) * 0.55;
      return `M${x1},${y1} C${x1},${cy} ${x2},${cy} ${x2},${y2}`;
    });

  // (The headline statement that used to live between UMAP and
  // track A is now folded into the bottom caption.)

  // SCREEN class key — bottom-right corner of the UMAP panel (sparse
  // there). Six rows, no header (the rows are self-describing as
  // `<class> · <partner count>`).
  const partnerCounts = d3.rollup(partners, (v) => v.length, (p) => p.cclass);
  const classOrder = ['PLS', 'pELS', 'dELS', 'CA-CTCF', 'CA-H3K4me3', 'unclassed'];
  const ROW_H = 16;
  const legendH = ROW_H * (classOrder.length - 1);
  const legend = L.annotation.append('g')
    .attr('transform', `translate(${W - M.right - 200}, ${Y_UMAP_1 - 50 - legendH})`);
  classOrder.forEach((cclass, i) => {
    const yRow = i * ROW_H;
    legend.append('rect')
      .attr('x', 0).attr('y', yRow - 9)
      .attr('width', 11).attr('height', 11).attr('rx', 2)
      .attr('fill', cclassColor(cclass));
    legend.append('text')
      .attr('class', 'svg-legend-row')
      .attr('x', 17).attr('y', yRow)
      .text(`${cclass} · ${partnerCounts.get(cclass) ?? 0}`);
  });

  // ----------------------------------------------------------------
  // Spot annotations
  // ----------------------------------------------------------------
  // Spot annotations: start the callout at the actual lollipop
  // circle (sx, sy) and land the text in the clear band above the
  // pins (yTop + 24 baseline). Direction (left/right/center) is
  // chosen so each label avoids the nearest neighbouring lollipops.
  const cdh3 = ordered.find((p) => p.rank === 5);
  if (cdh3) {
    const sx = xB((cdh3.start + cdh3.end) / 2);
    const sy = lolliY(Y_B_0, cdh3.npmi, partnersInB);
    annotateChr({
      L,
      x: sx, y: sy,
      dx: -6, dy: (Y_B_0 + 24) - sy,
      title: 'rank 5 · CDH3 paralog',
      sub: 'P-cadherin promoter, 92 kb upstream',
    });
  }

  const hub = ordered.find((p) => p.rank === 2);
  if (hub) {
    const sx = xA((hub.start + hub.end) / 2);
    const sy = lolliY(Y_A_0, hub.npmi, ordered);
    // Grow leftward (text-anchor=end) so the long sub-line doesn't
    // run off the right margin — there's plenty of space to the left
    // of xA=840 and the text glyphs sit well above the lollipop
    // stems they pass over.
    annotateChr({
      L,
      x: sx, y: sy,
      dx: -6, dy: (Y_A_0 + 24) - sy,
      title: 'rank 2 · distal hub at chr16:71.6 Mb',
      sub: 'cluster of ranks 2/3/6/7/14, embedding-adjacent to CDH1',
    });
  }

  const cisEnhancers = partnersInC.filter((p) => p.cclass === 'pELS');
  if (cisEnhancers.length > 0) {
    const rank1 = ordered.find((p) => p.rank === 1);
    const sx = xC((rank1.start + rank1.end) / 2);
    const sy = lolliY(Y_C_0, rank1.npmi, partnersInC);
    // Sit text to the right of the callout line (text-anchor=start)
    // instead of centering it across the cluster.
    annotateChr({
      L,
      x: sx, y: sy,
      dx: 8, dy: (Y_C_0 + 24) - sy,
      title: `cis enhancer module (${cisEnhancers.length} pELS)`,
      sub: 'rank 1, 4, 9 within 1 kb of the CDH1 TSS',
    });
  }

  // Figure caption — native SVG text + tspans (so it survives the
  // SVG download). Wrapping is computed at render time using
  // getComputedTextLength() so each line really runs to the panel's
  // full width instead of stopping at hand-broken character counts.
  // Hand-wrapped caption — each line is a row of (text, weight)
  // segments with absolute x/y on the line-leading tspan. No
  // measurement dependency means the layout is identical in every
  // SVG renderer (browser print, Preview, Inkscape, PDF tools).
  // Lines tuned to ~140-150 characters at 13 px Inter so they fill
  // most of the 1024-unit panel width without risking overflow.
  const captionLines = [
    [
      { weight: 'bold',   text: "Twenty of CDH1's thirty top NPMI partners are pELS enhancers and nine are PLS promoters." },
      { weight: 'normal', text: " The cis enhancer cluster, the CDH3 paralog 92 kb upstream, and a distal hub 3 Mb" },
    ],
    [
      { weight: 'normal', text: "away at chr16:71.6 Mb all surface from co-occurrence alone, without ever using genomic distance as input. Region2Vec learns each chr16 regulatory region's embedding" },
    ],
    [
      { weight: 'normal', text: "from the experiments it co-occurs in across a 17 k-file BED corpus; we anchor on the CDH1 / E-cadherin promoter (chr16:68.74 Mb, PLS), an epithelial gene whose" },
    ],
    [
      { weight: 'normal', text: "loss in carcinomas drives epithelial-to-mesenchymal transition, and read out its top 30 partners on two coordinate systems: the learned UMAP embedding (above)," },
    ],
    [
      { weight: 'normal', text: "and chr16 itself zoomed three times (below)." },
    ],
  ];
  const captionEl = L.panel_label.append('text')
    .attr('class', 'svg-caption')
    .attr('x', M.left).attr('y', Y_CAPTION_0 + 36);
  const lineHeight = 19;
  captionLines.forEach((segments, lineIdx) => {
    segments.forEach((seg, segIdx) => {
      const tspan = captionEl.append('tspan')
        .attr('font-weight', seg.weight === 'bold' ? 600 : 400)
        .text(seg.text);
      if (segIdx === 0) {
        tspan.attr('x', M.left)
             .attr('y', Y_CAPTION_0 + 36 + lineIdx * lineHeight);
      }
    });
  });
}

function inWindow(v, [lo, hi]) { return v >= lo && v <= hi; }

// Word-wrap an array of styled segments into <tspan> children of
// `textEl`. Each segment is `{ text, weight }`; `weight` is 'bold'
// or 'normal'. Each new line gets ABSOLUTE x and y (not dy) so any
// SVG renderer — including offline ones used to print the
// downloaded file — preserves the line breaks. A small safety
// margin is shaved off `maxWidth` so a slightly wider rendering
// font in a non-browser viewer doesn't push lines past the right
// edge.
function wrapStyledTextToWidth(textEl, segments, maxWidth, lineHeight, x) {
  const svg = textEl.node().ownerSVGElement;
  const measure = d3.select(svg).append('text')
    .attr('visibility', 'hidden')
    .attr('class', textEl.attr('class'));
  const baseY = +textEl.attr('y');

  // Tokenize into runs of (whitespace | word) carrying their weight.
  const tokens = [];
  for (const seg of segments) {
    const parts = (seg.text.match(/\S+|\s+/g) || []);
    for (const p of parts) tokens.push({ text: p, weight: seg.weight });
  }

  let lineNum = 0;
  let lineWidth = 0;

  for (const tok of tokens) {
    const isWS = /^\s+$/.test(tok.text);
    measure
      .attr('font-weight', tok.weight === 'bold' ? 600 : 400)
      .text(tok.text);
    const w = measure.node().getComputedTextLength();

    if (!isWS && lineWidth > 0 && lineWidth + w > maxWidth) {
      lineNum++;
      lineWidth = 0;
    }
    if (lineWidth === 0 && isWS) continue;

    const real = textEl.append('tspan')
      .attr('font-weight', tok.weight === 'bold' ? 600 : 400)
      .text(tok.text);
    if (lineWidth === 0) {
      real.attr('x', x);
      // Absolute y (not dy) so renderers without dy support still
      // place each line at the right vertical position.
      real.attr('y', baseY + lineNum * lineHeight);
    }
    lineWidth += w;
  }
  measure.remove();
}

function drawChrTrack({
  L, label, yTop, x, partners, anchor, context, domain,
  xTickFormat, contextAsTokens, npmiOpacity,
}) {
  const ry = railY(yTop);

  // Track label sits at the bottom of the track box, beneath the rail
  // and the axis tick labels.
  L.panel_label.append('text')
    .attr('class', 'panel-label')
    .attr('x', M.left).attr('y', yTop + TRACK_H - 6)
    .text(label);

  if (context && context.length > 0) {
    if (contextAsTokens) {
      // Region rects span the full rail height so each region reads as
      // a colored span of the chromosome bar (rail half-height = 6).
      // Clip the rect group to a rounded rect matching the rail so any
      // region that sits at the track edge picks up the rail's
      // corner radius, instead of poking out as a sharp corner.
      const railLeft = x(domain[0]);
      const railRight = x(domain[1]);
      const clipId = `rail-clip-${Math.round(yTop)}-${Math.round(railLeft)}`;
      let defs = L.chr_rail.select('defs');
      if (defs.empty()) defs = L.chr_rail.append('defs');
      defs.append('clipPath').attr('id', clipId)
        .append('rect')
        .attr('x', railLeft).attr('y', ry - 6)
        .attr('width', railRight - railLeft).attr('height', 12)
        .attr('rx', 6);
      L.chr_context.append('g')
        .attr('clip-path', `url(#${clipId})`)
        .selectAll('rect')
        .data(context).join('rect')
        .attr('x', (d) => x(d.start))
        .attr('y', ry - 6)
        .attr('width', (d) => Math.max(1, x(d.end) - x(d.start)))
        .attr('height', 12)
        .attr('fill', (d) => cclassColor(d.cclass))
        .attr('fill-opacity', 0.16)
        .attr('stroke', (d) => cclassColor(d.cclass))
        .attr('stroke-opacity', 0.45)
        .attr('stroke-width', 0.5);
    } else {
      // Density ticks for the 2 Mb track — sized to the new rail.
      L.chr_context.append('g').selectAll('line')
        .data(context).join('line')
        .attr('x1', (d) => x((d.start + d.end) / 2))
        .attr('x2', (d) => x((d.start + d.end) / 2))
        .attr('y1', ry - 4).attr('y2', ry + 4)
        .attr('stroke', (d) => cclassColor(d.cclass))
        .attr('stroke-opacity', 0.32).attr('stroke-width', 0.5);
    }
  }

  // Rail — tall enough to enclose the per-region rects in the 20 kb
  // track (which span ±5 px around the rail center). Tracks B and A
  // also pick up the same taller rail so all three read at the same
  // weight.
  L.chr_rail.append('rect')
    .attr('x', x(domain[0])).attr('y', ry - 6)
    .attr('width', x(domain[1]) - x(domain[0])).attr('height', 12)
    .attr('rx', 6)
    .attr('fill', '#ececea').attr('stroke', '#d8d6cf');

  // Axis
  L.chr_axis.append('g').attr('class', 'axis')
    .attr('transform', `translate(0, ${ry + 14})`)
    .call(d3.axisBottom(x).ticks(8).tickFormat(xTickFormat));

  // Lollipops — every pin is the same height. NPMI is conveyed
  // through opacity (and through the connector gradient), not pin
  // height; keeps the chr panel from reading as a bar chart of
  // NPMI scores.
  if (partners.length > 0) {
    const pinTop = yTop + 62;
    const stem = L.lollipop.append('g');
    stem.selectAll('line')
      .data(partners).join('line')
      .attr('x1', (p) => x((p.start + p.end) / 2))
      .attr('x2', (p) => x((p.start + p.end) / 2))
      .attr('y1', ry - 4)
      .attr('y2', pinTop)
      .attr('stroke', (p) => cclassColor(p.cclass))
      .attr('stroke-width', 1.2)
      .attr('stroke-opacity', (p) => npmiOpacity(p.npmi));
    stem.selectAll('circle')
      .data(partners).join('circle')
      .attr('class', 'partner-mark')
      .attr('cx', (p) => x((p.start + p.end) / 2))
      .attr('cy', pinTop)
      .attr('r', 3.5)
      .attr('fill', (p) => cclassColor(p.cclass))
      .attr('fill-opacity', (p) => npmiOpacity(p.npmi));
  }

  // Anchor mark below rail
  const ax = x((anchor.start + anchor.end) / 2);
  if (ax >= M.left - 4 && ax <= W - M.right + 4) {
    L.anchor.append('path')
      .attr('class', 'anchor-mark')
      .attr('transform', `translate(${ax}, ${ry + 12})`)
      .attr('d', d3.symbol(d3.symbolStar, 60)());
  }
}

function drawZoomIndicator({ L, parentX, childX, parentRailY, childRailY, range }) {
  // Two halves with opposite z-needs (see LAYER_NAMES note):
  //   - box (parent rail highlight) → above origin track
  //   - trapezoid (drips down to child rail) → below destination track
  // Box bottom and trapezoid top share `parentRailY + 6` so the two
  // halves still read as one continuous band.
  const lo = parentX(range[0]);
  const hi = parentX(range[1]);
  const cLo = childX(range[0]);
  const cHi = childX(range[1]);
  const boxTop = parentRailY - 8;   // 2 px taller than rail (rail half = 6)
  const boxBot = parentRailY + 8;   // == trap top
  const trapBot = childRailY;       // rail midline of destination track

  // ---- trapezoid (under the destination track) ----
  L.zoom_trap.append('path')
    .attr('d',
      `M${lo},${boxBot} L${hi},${boxBot}` +
      ` L${cHi},${trapBot} L${cLo},${trapBot} Z`)
    .attr('fill', 'rgba(91,103,112,0.05)');
  L.zoom_trap.append('path').attr('class', 'annotation-line')
    .attr('d', `M${lo},${boxBot} L${cLo},${trapBot}`);
  L.zoom_trap.append('path').attr('class', 'annotation-line')
    .attr('d', `M${hi},${boxBot} L${cHi},${trapBot}`);

  // ---- box (over the origin track) ----
  L.zoom_box.append('rect')
    .attr('x', lo).attr('y', boxTop)
    .attr('width', Math.max(2, hi - lo)).attr('height', boxBot - boxTop)
    .attr('fill', 'rgba(91,103,112,0.05)');
  // Top + sides only — no bottom border, so the fill flows visually
  // into the trapezoid below.
  L.zoom_box.append('path')
    .attr('d',
      `M${lo},${boxBot} L${lo},${boxTop} L${hi},${boxTop} L${hi},${boxBot}`)
    .attr('fill', 'none')
    .attr('stroke', 'rgba(91,103,112,0.65)').attr('stroke-width', 0.75);
}

function drawAnchorMark(layer, x, y, { halo = true, size = 90, label, labelDx = 12, labelDy = 4 }) {
  const g = layer.append('g').attr('transform', `translate(${x}, ${y})`);
  if (halo) {
    g.append('circle')
      .attr('r', 11).attr('fill', 'none')
      .attr('stroke', 'black').attr('stroke-width', 0.6)
      .attr('stroke-dasharray', '2 2');
  }
  g.append('path')
    .attr('class', 'anchor-mark')
    .attr('d', d3.symbol(d3.symbolStar, size)());
  if (label) {
    g.append('text')
      .attr('class', 'annotation annotation--strong')
      .attr('x', labelDx).attr('y', labelDy)
      .text(label);
  }
}

function annotateChr({ L, x, y, dx, dy, title, sub }) {
  const tx = x + dx;
  const ty = y + dy;
  L.annotation_line.append('path')
    .attr('class', 'annotation-line')
    .attr('d', `M${x},${y} L${tx + (dx > 0 ? -4 : (dx < 0 ? 4 : 0))},${ty + 6}`);
  const align = dx > 0 ? 'start' : (dx < 0 ? 'end' : 'middle');

  // Group the text marks so we can size a soft backdrop rect to the
  // combined bbox. The backdrop washes out whatever lollipop or
  // bezier sits behind it without a border, so the label reads.
  const g = L.annotation.append('g');
  const titleEl = g.append('text')
    .attr('class', 'annotation annotation--strong')
    .attr('x', tx).attr('y', ty)
    .attr('text-anchor', align)
    .text(title);
  g.append('text')
    .attr('class', 'annotation')
    .attr('x', tx).attr('y', ty + 12)
    .attr('text-anchor', align)
    .text(sub);

  // Backdrop sized to the title only (the sub-text doesn't get a
  // backdrop so it reads as continuation prose).
  const tBBox = titleEl.node().getBBox();
  const pad = 4;
  const backdrop = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  backdrop.setAttribute('x', String(tBBox.x - pad));
  backdrop.setAttribute('y', String(tBBox.y - pad));
  backdrop.setAttribute('width', String(tBBox.width + 2 * pad));
  backdrop.setAttribute('height', String(tBBox.height + 2 * pad));
  backdrop.setAttribute('fill', 'white');
  backdrop.setAttribute('fill-opacity', '0.95');
  // Gaussian blur pushes the edges out into a soft halo so there is
  // no visible rect outline.
  backdrop.setAttribute('filter', 'url(#soft-edge)');
  g.node().insertBefore(backdrop, g.node().firstChild);
}

// CSS rules that need to travel with the downloaded SVG so that
// titles, labels, tooltips, etc. read correctly when the file is
// opened outside this page (e.g. dropped into Inkscape or a print
// pipeline). Mirrors the SVG-targeted classes in style.css.
const EMBEDDED_SVG_CSS = `
  text { font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif; }
  .svg-title { font-size: 2rem; font-weight: 200; fill: #1c1c1c; }
  .svg-subtitle { font-size: 0.75rem; font-weight: 400; fill: #8a8a8a; }
  .svg-legend-row { font-size: 11px; fill: #4a4a4a; }
  .svg-caption { font-size: 13px; font-weight: 400; fill: #4a4a4a; }
  .svg-question { font-size: 15px; font-weight: 300; font-style: italic; fill: #4a4a4a; }
  .panel-label { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; fill: #1c1c1c; }
  .axis path, .axis line { stroke: #d8d6cf; }
  .axis text { fill: #8a8a8a; font-size: 10px; }
  .annotation { font-size: 11px; fill: #4a4a4a; }
  .annotation--strong { font-weight: 600; fill: #1c1c1c; }
  .annotation-line { stroke: #8a8a8a; stroke-width: 0.75; fill: none; }
  .connector { fill: none; stroke-width: 1; }
  .partner-mark { stroke: white; stroke-width: 0.75; }
  .anchor-mark { fill: black; }
  .cloud-point { fill: #8a8a8a; fill-opacity: 0.18; }
`;

function downloadSvg() {
  const orig = document.getElementById('static');
  if (!orig) return;
  const clone = orig.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  // Inline the relevant CSS so the SVG is self-contained.
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = EMBEDDED_SVG_CSS;
  clone.insertBefore(style, clone.firstChild);
  const xml = new XMLSerializer().serializeToString(clone);
  const blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n', xml],
    { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'genomic-dictionary-cdh1.svg';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function bindToolbar() {
  const dl = document.getElementById('download-svg');
  const pr = document.getElementById('print-figure');
  if (dl) dl.addEventListener('click', downloadSvg);
  if (pr) pr.addEventListener('click', () => window.print());
}

// Wait for fonts to load before rendering so the wrap function's
// getComputedTextLength() measurements use the real font metrics
// (not fallback). Without this, the caption can sometimes render as
// a single long line that overflows the SVG when printed.
function bootstrap() {
  const start = () => {
    try { main(); bindToolbar(); } catch (e) { reportError(e); }
  };
  const ready = (document.fonts && document.fonts.ready)
    ? document.fonts.ready
    : Promise.resolve();
  ready.then(start, start);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}

function reportError(e) {
  console.error(e);
  d3.select('#figure').append('p').text(`Failed to render: ${e.message}`);
}
