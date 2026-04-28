---
title: A Dictionary of Regulatory Genomics
toc: false
---

<style>
  #observablehq-main { max-width: 1280px; }
  #observablehq-main h1,
  #observablehq-main h2,
  #observablehq-main h3,
  #observablehq-main p,
  #observablehq-main ul,
  #observablehq-main ol { max-width: none; }
</style>

# A Dictionary of Regulatory Genomics

Most of the human genome is non-coding. Most disease-associated variants sit in non-coding DNA. To interpret what those variants mean, we need a way to read what regulatory machinery is at any genomic location. This walkthrough treats regulatory elements as **words**, BED-file experiments as **documents**, and uses the distributional structure of co-occurrence to build a dictionary.

Three steps: **(1)** projecting raw experimental peaks onto a shared vocabulary, **(2)** the embedding as an emergent grammar, and **(3)** files share a dictionary — single experiments and groups both surface as intersections in the same canvas.

Focus: **chromosome 16** of the human genome. Four narrative-anchoring loci to swap between.

```js
import * as vg from "npm:@uwdata/vgplot";
import {clausePoint, clausePoints} from "npm:@uwdata/mosaic-core";
import {
  SCREEN_CLASS_COLORS,
  SCREEN_CLASS_COLOR_DOMAIN,
  SCREEN_CLASS_COLOR_RANGE,
  ASSAY_COLOR_DOMAIN,
  ASSAY_COLOR_RANGE,
  classColor,
  arrowToRows,
  fileLabel
} from "./components/dictionary.js";
```

```js
// Mosaic coordinator + DuckDB-WASM connector. Returning the coordinator
// from this cell makes it a tracked dependency — downstream cells that
// reference `coord` will only run after this is resolved, which is what
// guarantees the database connector is attached before any query fires.
const coord = (() => {
  const c = vg.coordinator();
  c.databaseConnector(vg.wasmConnector());
  return c;
})();
```

```js
// Resolve parquet URLs through Framework's FileAttachment.
const parquetUrls = {
  regions: await FileAttachment("data/dictionary/viz_chr16.parquet").href,
  files: await FileAttachment("data/dictionary/viz_files.parquet").href,
  intervals: await FileAttachment("data/dictionary/featured_intervals.parquet").href,
  featuredFiles: await FileAttachment("data/dictionary/featured_files.parquet").href,
  tracks: await FileAttachment("data/dictionary/featured_tracks.parquet").href,
  regionStats: await FileAttachment("data/dictionary/region_stats.parquet").href,
  tokenizedCorpus: await FileAttachment("data/dictionary/tokenized_corpus_chr16.parquet").href,
  featuredSignal: await FileAttachment("data/dictionary/featured_signal.parquet").href
};
```

```js
// Table-name registry; exported so vg.from(...) calls can reference it.
const TABLE = {
  regions: "dict_regions",
  files: "dict_files",
  intervals: "dict_featured_intervals",
  featuredFiles: "dict_featured_files",
  tracks: "dict_featured_tracks",
  regionStats: "dict_region_stats",
  tokenizedCorpus: "dict_tokenized_corpus",
  regionsClassed: "dict_regions_classed",
  featuredSignal: "dict_featured_signal"
};
```

```js
// Register each parquet as a DuckDB table. The `tablesReady` export gates
// every downstream query/plot — anything that wants the data must read
// `tablesReady`. The big tokenized_corpus table is registered here but
// not materialized — it's queried lazily on selection changes.
const tablesReady = await (async () => {
  await Promise.all([
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.regions} AS SELECT * FROM read_parquet('${parquetUrls.regions}')`),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.files} AS SELECT * FROM read_parquet('${parquetUrls.files}')`),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.intervals} AS SELECT * FROM read_parquet('${parquetUrls.intervals}')`),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.featuredFiles} AS SELECT * FROM read_parquet('${parquetUrls.featuredFiles}')`),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.tracks} AS SELECT * FROM read_parquet('${parquetUrls.tracks}')`),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.regionStats} AS SELECT * FROM read_parquet('${parquetUrls.regionStats}')`),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.tokenizedCorpus} AS SELECT * FROM read_parquet('${parquetUrls.tokenizedCorpus}')`),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.featuredSignal} AS SELECT * FROM read_parquet('${parquetUrls.featuredSignal}')`)
  ]);
  // Views go strictly AFTER all tables exist — chaining with `.then`
  // inside Promise.all races against mosaic mark schema queries.
  await coord.exec(`CREATE OR REPLACE VIEW ${TABLE.regionsClassed} AS SELECT * FROM ${TABLE.regions} WHERE cclass IS NOT NULL`);
  return true;
})();
```

```js
// Materialize the small / always-needed tables into JS arrays. The
// tokenized_corpus table stays in DuckDB and is queried by file_id when
// the user changes the brush/legend selection in Step 4.
tablesReady;
const intervals = arrowToRows(await coord.query(`SELECT * FROM ${TABLE.intervals}`));
const featuredFiles = arrowToRows(await coord.query(`SELECT * FROM ${TABLE.featuredFiles}`));
const tracks = arrowToRows(await coord.query(`SELECT * FROM ${TABLE.tracks}`));
const filesRows = arrowToRows(await coord.query(`SELECT * FROM ${TABLE.files}`));
const regions = arrowToRows(await coord.query(`SELECT * FROM ${TABLE.regions}`));
const regionStats = arrowToRows(await coord.query(`SELECT * FROM ${TABLE.regionStats}`));
const featuredSignal = arrowToRows(await coord.query(`SELECT * FROM ${TABLE.featuredSignal}`));
```

```js
// Stable, alphabetized list of file labels — shared y-axis domain for
// Steps 1 and 2 so rows align across the two plots.
const allFileLabels = Array.from(new Set(featuredFiles.map(fileLabel))).sort();
```

```js
// Featured interval picker. Drives the x-domain of Steps 1/2 and the
// outlined-tokens overlay in Step 2.
const currentInterval = view(Inputs.select(intervals, {
  label: "Featured interval",
  format: (i) => i.label,
  value: intervals[0]
}));
```

<div style="font-size: 0.9em; color: #555; margin-top: -0.5em; margin-bottom: 1em;">
${currentInterval.chrom}:${currentInterval.start.toLocaleString()}–${currentInterval.end.toLocaleString()} — ${currentInterval.narrative_caption}
</div>

## 1. From raw experiments to a shared vocabulary

The thing a regulatory experiment actually outputs is a **continuous signal track** over the genome — read pileups, fold-change over background, hypersensitivity intensity. Peak callers threshold that signal to produce a **BED file**: a discrete list of intervals. Different callers, different parameters, slightly different boundaries — so two BEDs that agree biologically still don't agree at the bp.

To get a fixed dictionary we **project peaks onto a universe** of regulatory regions — the tokenized region universe from our [r2v-encode-hg38](https://huggingface.co/databio/r2v-encode-hg38) corpus, derived from co-activation across thousands of BED files. Every peak collapses to whichever universe regions it overlaps, and each file becomes a binary presence vector — that's tokenization. The class labels overlaid on the embedding (PLS / pELS / dELS / …) come from [SCREEN](https://screen.encodeproject.org/), a different classification system applied on top of the universe.

Toggle through the three views to watch the abstraction emerge.

```js
const view1Mode = view(Inputs.radio(
  ["continuous", "peaks", "tokens"],
  {value: "continuous", label: "View"}
));
```

```js
// Per-file peak rows + per-file token rows + universe rows for the current
// featured interval. Computed once; the toggle picks which set to render.
const UNIVERSE_LABEL = "UNIVERSE";

const peakRows = (() => {
  const fileById = new Map(featuredFiles.map((f) => [f.file_id, f]));
  const rows = [];
  for (const t of tracks) {
    if (t.interval_id !== currentInterval.interval_id) continue;
    const f = fileById.get(t.file_id);
    if (!f) continue;
    const label = fileLabel(f);
    for (let i = 0; i < t.peak_starts.length; i++) {
      rows.push({
        file_id: t.file_id,
        file_label: label,
        role: f.role,
        assay: f.assay,
        peak_start: t.peak_starts[i],
        peak_end: t.peak_ends[i]
      });
    }
  }
  return rows.filter((d) => d.peak_end - d.peak_start >= 200);
})();

const universeRows = regions
  .filter((r) =>
    r.chrom === currentInterval.chrom &&
    r.end > currentInterval.start &&
    r.start < currentInterval.end &&
    r.end - r.start >= 200
  )
  .map((r) => ({...r, label: UNIVERSE_LABEL}));

const tokenRows = (() => {
  const tokenLookup = new Map(regions.map((r) => [r.token_id, r]));
  const fileById = new Map(featuredFiles.map((f) => [f.file_id, f]));
  const rows = [];
  for (const t of tracks) {
    if (t.interval_id !== currentInterval.interval_id) continue;
    const f = fileById.get(t.file_id);
    if (!f) continue;
    const label = fileLabel(f);
    for (const tid of t.active_token_ids) {
      const r = tokenLookup.get(tid);
      if (!r) continue;
      rows.push({
        file_id: t.file_id,
        file_label: label,
        token_id: tid,
        cclass: r.cclass,
        start: r.start,
        end: r.end
      });
    }
  }
  return rows.filter((d) => d.end - d.start >= 200);
})();
```

```js
// Per-bin signal points for the current interval, flattened from
// featuredSignal's list-columns. One row per (file, bin).
const signalRows = (() => {
  const fileById = new Map(featuredFiles.map((f) => [f.file_id, f]));
  const out = [];
  for (const s of featuredSignal) {
    if (s.interval_id !== currentInterval.interval_id) continue;
    const f = fileById.get(s.file_id);
    if (!f) continue;
    const label = fileLabel(f);
    const positions = s.positions;
    const values = s.values;
    for (let i = 0; i < positions.length; i++) {
      out.push({
        file_label: label,
        assay: f.assay,
        position: positions[i],
        value: Number.isFinite(values[i]) ? values[i] : 0
      });
    }
  }
  return out;
})();
```

```js
// Single combined plot. Universe row stays anchored at the top of the
// y-domain across all three modes so file rows don't reflow on toggle.
//   continuous → bigwig signal trace per file (faceted, per-row y-scale);
//                universe shown in black.
//   peaks      → BED peak rectangles per file colored by assay; universe in black.
//   tokens     → universe + per-file token activations colored by SCREEN class.
const isTokens = view1Mode === "tokens";
const isContinuous = view1Mode === "continuous";
const PAD_LABEL = " ";
const baseRows = [UNIVERSE_LABEL, ...allFileLabels];
const yDomain = isContinuous ? [...baseRows, PAD_LABEL] : baseRows;
// Plot height stays constant across modes — pad row in continuous shares the
// existing total area so toggling doesn't reflow surrounding content.
const plotHeight = Math.max(260, 22 * baseRows.length);

display(Plot.plot({
  width: 900,
  height: plotHeight,
  marginLeft: 220,
  marginRight: 30,
  marginTop: 30,
  marginBottom: 40,
  x: {
    domain: [currentInterval.start, currentInterval.end],
    label: currentInterval.chrom,
    grid: true,
    tickFormat: (d) => (d / 1e6).toFixed(2) + "M",
    // Suppress default x axis in continuous mode — replaced below with a
    // Plot.axisX mark shifted 1px down so ticks/labels clear the bottom rule.
    ...(isContinuous ? {axis: null} : {})
  },
  // Categorical-y modes (peaks, tokens) use a shared y axis;
  // continuous mode facets per file_label so each row has its own y scale.
  ...(isContinuous
    ? {
        y: {axis: null},
        fy: {
          domain: yDomain,
          label: null,
          padding: 0,
          axis: null
        }
      }
    : {
        y: {label: null, domain: yDomain, padding: 0.2}
      }),
  color: isTokens
    ? {domain: SCREEN_CLASS_COLOR_DOMAIN, range: SCREEN_CLASS_COLOR_RANGE, legend: true}
    : {domain: ASSAY_COLOR_DOMAIN, range: ASSAY_COLOR_RANGE, legend: true},
  marks: [
    // Per-row guide rules (only meaningful in non-faceted modes)
    ...(!isContinuous
      ? [
          Plot.ruleY(allFileLabels, {stroke: "#eee", strokeWidth: 1}),
          Plot.ruleY([UNIVERSE_LABEL], {stroke: "#888", strokeWidth: 1})
        ]
      : []),
    // Universe row — same in every mode (color depends on mode)
    Plot.rect(universeRows, {
      x1: "start",
      x2: "end",
      ...(isContinuous ? {fy: () => UNIVERSE_LABEL, y1: 0, y2: 1} : {y: "label"}),
      fill: isTokens ? (d) => classColor(d.cclass) : "black",
      insetTop: 2,
      insetBottom: 2,
      clip: true,
      title: (d) =>
        `${d.cclass ?? "(no class)"}: ${d.start.toLocaleString()}–${d.end.toLocaleString()} (${d.end - d.start} bp)`
    }),
    // Mode-specific file-row marks
    ...(isContinuous
      ? [
          Plot.areaY(signalRows, {
            x: "position",
            y: "value",
            fy: "file_label",
            fill: "assay",
            fillOpacity: 0.85,
            curve: "step",
            clip: true
          }),
          // Invisible anchor so Plot allocates a real band for the pad row.
          Plot.rect([{}], {
            fy: () => PAD_LABEL,
            x1: currentInterval.start,
            x2: currentInterval.end,
            y1: 0,
            y2: 1,
            fillOpacity: 0
          }),
          // With fy padding=0 the facets are flush; this draws a thin line
          // along the bottom of every non-pad facet so the rows are visually
          // delimited (data-driven so the pad row gets no border).
          Plot.ruleY(
            baseRows.map((label) => ({fy: label, y: 0})),
            {fy: "fy", y: "y", stroke: "#ddd", strokeWidth: 0.5}
          ),
          // Custom y-axis: real Plot tick marks + labels positioned near the
          // bottom edge of each non-pad band. Default axis is suppressed
          // (`axis: null`) since it centers in the band; `dy` shifts the
          // axisFy elements from band center to its bottom rule. `ticks`
          // restricts both tick marks and labels to non-pad rows.
          Plot.axisFy({
            anchor: "left",
            dy: 8.5,
            fontSize: 10,
            tickSize: 6,
            ticks: baseRows
          }),
          // Custom x axis shifted 1px down — keeps tickFormat/label from the
          // scale config (which still drives the gridlines). labelOffset
          // bumped 1 above Plot's default so the title lands at +2 total
          // while the ticks stay at +1.
          Plot.axisX({
            anchor: "bottom",
            dy: 1,
            tickFormat: (d) => (d / 1e6).toFixed(2) + "M",
            label: currentInterval.chrom,
            labelOffset: 38
          })
        ]
      : isTokens
        ? [
            Plot.barX(tokenRows, {
              x1: "start",
              x2: "end",
              y: "file_label",
              fill: (d) => classColor(d.cclass),
              stroke: "white",
              strokeWidth: 0.5,
              insetTop: 3,
              insetBottom: 3,
              clip: true,
              title: (d) =>
                `${d.file_label}\ntoken ${d.token_id} (${d.cclass ?? "no class"})\n${d.start.toLocaleString()}–${d.end.toLocaleString()} (${d.end - d.start} bp)`
            })
          ]
        : [
            Plot.barX(peakRows, {
              x1: "peak_start",
              x2: "peak_end",
              y: "file_label",
              fill: "assay",
              stroke: (d) => (d.role === "mystery" ? "black" : "white"),
              strokeWidth: 0.5,
              insetTop: 3,
              insetBottom: 3,
              clip: true,
              title: (d) =>
                `${d.file_label}\npeak: ${d.peak_start.toLocaleString()}–${d.peak_end.toLocaleString()} (${d.peak_end - d.peak_start} bp)`
            })
          ])
  ]
}));
```

<div style="font-size: 0.85em; color: #666;">
${view1Mode === "tokens"
  ? `${universeRows.length} universe tokens in this interval; ${tokenRows.length} (file × token) activations across ${allFileLabels.length} files.`
  : view1Mode === "continuous"
    ? `Bigwig signal (fold-change over control) sampled at ${signalRows.length / Math.max(1, allFileLabels.length) | 0} bins per file across ${allFileLabels.length} files.`
    : `${new Set(peakRows.map((r) => r.file_id)).size} experiments, ${peakRows.length} peak intervals (≥200 bp) shown.`}
</div>

## 2. A learned grammar

With every BED file as a binary "sentence" of universe tokens, a word2vec-style model (Region2Vec, part of [geniml](https://github.com/databio/geniml)) learns a 100-dimensional embedding per region. Regions that show up in similar files together end up close in embedding space. Project to 2D, color by SCREEN regulatory class, and the embedding has learned the dictionary on its own — promoters cluster with promoters, enhancers with enhancers.

The neighborhoods you see here are **embedding-space** neighborhoods — regions whose 100-dim R2V vectors are close. Color by SCREEN class, genomic midpoint, or corpus-wide file count to surface different stories about the embedding.

```js
// Color encoding toggle for the region UMAP.
//   "class"    — SCREEN regulatory class (the dictionary itself).
//   "midpoint" — genomic midpoint (mean of start/end). Surfaces whether
//                spatial neighbors on chr16 land near each other in the
//                embedding.
//   "files"    — n_files_total from region_stats. Surfaces housekeeping
//                vs. cell-type-specific tokens.
const regionColorBy = view(Inputs.radio(
  new Map([
    ["SCREEN class", "class"],
    ["Genomic midpoint", "midpoint"],
    ["File count (log)", "files"]
  ]),
  {value: "class", label: "Color regions by"}
));
```


```js
// Region UMAP. Chr16 tokens colored by `regionColorBy`. Tokens overlapping
// the currently picked featured interval are outlined to tie back to Step 1.
// Click any dot to highlight it as a focal region.
const inIntervalSet = new Set(
  regions
    .filter(
      (r) =>
        r.cclass !== null &&
        r.chrom === currentInterval.chrom &&
        r.end > currentInterval.start &&
        r.start < currentInterval.end
    )
    .map((r) => r.token_id)
);
// Augment chr16 tokens with derived encodings (midpoint, file count) so
// any of the three color modes can read straight off a dot's row.
const regionStatsByToken = new Map(regionStats.map((s) => [s.token_id, s]));
const classedChr16 = regions
  .filter((r) => r.cclass !== null)
  .map((r) => ({
    ...r,
    midpoint: (Number(r.start) + Number(r.end)) / 2,
    n_files_total: Number(regionStatsByToken.get(r.token_id)?.n_files_total ?? 0)
  }));

// Cell deliberately does NOT reference pickedTokenId — the picked-ring
// overlay is rendered via vg.from + filterBy on pickedTokenSel, so clicks
// don't rebuild the whole UMAP. The cell DOES depend on regionColorBy,
// so changing the color encoding rebuilds the plot. (Param-driven fill
// columns don't currently work with mosaic's column-format data: the
// channel becomes a valueEntry holding the column name as a string, and
// Plot tries `data[i].colName` on rows that don't exist.)
const regionUmap = (() => {
  const tokenHover = vg.Selection.single({empty: true});
  const inInterval = classedChr16.filter((r) => inIntervalSet.has(r.token_id));
  const colorChannel =
    regionColorBy === "class" ? "cclass"
    : regionColorBy === "midpoint" ? "midpoint"
    : "n_files_total";
  const colorDirectives =
    regionColorBy === "class"
      ? [vg.colorDomain(SCREEN_CLASS_COLOR_DOMAIN), vg.colorRange(SCREEN_CLASS_COLOR_RANGE)]
      : regionColorBy === "midpoint"
        ? [vg.colorScheme("turbo"), vg.colorLabel("midpoint (Mb)"), vg.colorTickFormat((d) => (d / 1e6).toFixed(1))]
        : [vg.colorScheme("viridis"), vg.colorScale("sqrt"), vg.colorLabel("n files (sqrt)")];
  const plot = vg.plot(
    vg.dot(classedChr16, {
      x: "umap_x", y: "umap_y", fill: colorChannel,
      r: 1.4, fillOpacity: 0.55,
      tip: true
    }),
    // vg.nearest must come right after the dataset it binds to —
    // interactors attach to plot.marks[last] at the time they're added.
    vg.nearest({as: tokenHover}),
    vg.dot(inInterval, {
      x: "umap_x", y: "umap_y", fill: colorChannel,
      stroke: "black", strokeWidth: 0.7, r: 2.4
    }),
    vg.dot(vg.from(TABLE.regions, {filterBy: pickedTokenSel}), {
      x: "umap_x", y: "umap_y",
      stroke: "black", strokeWidth: 2.5, fill: "none", r: 10
    }),
    ...colorDirectives,
    vg.colorLegend(),
    vg.width(900),
    vg.height(600)
  );
  plot.style.flexDirection = "column-reverse";
  plot.style.cursor = "crosshair";
  plot.addEventListener("click", () => {
    const v = tokenHover.value;
    if (!v || !v.length) return;
    const [hx, hy] = v[0];
    const found = classedChr16.find((d) => d.umap_x === hx && d.umap_y === hy);
    if (!found) return;
    const currentlyPicked = pickedTokenSel.value;
    const newId = found.token_id === currentlyPicked ? null : found.token_id;
    pickedTokenSel.update(clausePoint("token_id", newId, {source: pickTokenBridge}));
  });
  return plot;
})();
```

${regionUmap}

<div style="font-size: 0.85em; color: #666; margin-top: -0.5em;">
${classedChr16.length.toLocaleString()} chr16 tokens with SCREEN class. ${inIntervalSet.size} tokens lie within the current interval. ${pickedTokenId != null ? `Picked: ${classedChr16.find((r) => r.token_id === pickedTokenId)?.region ?? `token ${pickedTokenId}`}.` : "Click a token to highlight it as a focal region."}
</div>

## 3. Files share a dictionary

Every BED file activates a subset of the universe — an experiment is a sentence that uses some words from the dictionary and not others. **Click a file** in the left UMAP to see exactly which chr16 regions it touches, or **click an assay or cell-line in the legend** to filter to a group of files at once. The right-hand UMAP highlights the regions shared across whatever you selected.

For a single file the highlight is that experiment's full active vocabulary — the universe regions it overlaps. For a group it's the *shared core*: the regions consistently active across the members of the selection, which is where a group's biological identity lives. The class labels overlaid on the embedding (PLS / pELS / dELS / …) are coarse and fixed; the corpus contains a different signal — co-activation across files — that lets you ask "what does *this slice* of experiments agree on?"

The slider sets how strict "shared" is — 1.0 is true intersection (often empty since one missing peak kills the region), 0.5 majority, 0.1 a tenth. Slide left when you want what *most* of the group agrees on, not every single file.

```js
// Shared selection state. fileSel is driven by both dot clicks (vg.toggle)
// and legend clicks (vg.colorLegend with `as`). intersectSel is a bridge
// target — the listener below pushes a `token_id IN (...)` clause whenever
// the active-region intersection changes, and the right-hand UMAP filters
// its highlight layer by it. pickedTokenSel/pickedTokenId persist for
// Step 2's focal-token highlight.
// Tessera pattern: separate sub-selections per input source, composed
// into one filter via Selection.intersect({include: [...]}).
// vg.colorLegend({as: $legendBrush}) needs the selection to hold array
// values (its update() calls .map on the value), so we keep legend and
// dot-click in different selections and reset them against each other.
const $legendBrush = vg.Selection.crossfilter();
const $fileClickBrush = vg.Selection.single({empty: true});
// fileSel (empty: false default) drives vg.highlight — empty selection
// = "match everything" so no dots get faded.
const fileSel = vg.Selection.intersect({
  include: [$legendBrush, $fileClickBrush]
});
// Two separate empty:true filters drive distinct highlight overlays —
// legendFilter for legend (slightly enlarged dot, thin outline) and
// clickFilter for dot-click (single black ring). Each is empty until its
// respective brush has clauses.
const legendFilter = vg.Selection.intersect({
  empty: true,
  include: [$legendBrush]
});
const clickFilter = vg.Selection.intersect({
  empty: true,
  include: [$fileClickBrush]
});
const intersectSel = vg.Selection.intersect({empty: true});
const intersectBridge = {};
const fileClickSrc = {};
const pickedTokenId = Mutable(intervals[0]?.universe_token_ids?.[0] ?? null);
function setPickedTokenId(id) {
  pickedTokenId.value = id;
}
const pickedTokenSel = vg.Selection.single({empty: true});
const pickTokenBridge = {};
const _initialTokenId = intervals[0]?.universe_token_ids?.[0] ?? null;
if (_initialTokenId != null) {
  pickedTokenSel.update(
    clausePoint("token_id", _initialTokenId, {source: pickTokenBridge})
  );
}
// Stats for the caption — populated by the intersection bridge below.
const sectionStats = Mutable({n_files: 0, n_regions: 0, has_selection: false});
function setSectionStats(s) { sectionStats.value = s; }
```

```js
// Bridge: pickedTokenSel → pickedTokenId Mutable. Step 2 reads the
// Mutable for its caption.
{
  const handler = () => setPickedTokenId(pickedTokenSel.value ?? null);
  pickedTokenSel.addEventListener("value", handler);
  invalidation.then(() => pickedTokenSel.removeEventListener("value", handler));
}

// Mutual-exclusion bridge: when the legend writes a clause, clear the
// dot-click brush. (The dot-click handler resets $legendBrush directly,
// closing the loop in the other direction.)
{
  const handler = () => {
    if (($legendBrush.clauses?.length ?? 0) > 0) $fileClickBrush.reset();
  };
  $legendBrush.addEventListener("value", handler);
  invalidation.then(() => $legendBrush.removeEventListener("value", handler));
}
```

```js
// File UMAP. vg.nearest writes the hovered dot's [umap_x, umap_y] into
// fileHover; the click handler matches that back to a row and pushes a
// clausePoint("id", file_id) onto fileSel. vg.colorLegend({as: fileSel})
// makes the embedded color legend interactive — both click sources
// compose into the same Selection via Selection.intersect.
const fileUmap = (() => {
  const fileHover = vg.Selection.single({empty: true});
  const plot = vg.plot(
    // Base layer reads from the dict_files DuckDB table — vg.highlight
    // requires the previous mark to expose mark.query(), which only works
    // on table-backed marks (array-backed marks return null there).
    vg.dot(vg.from(TABLE.files), {
      x: "umap_x", y: "umap_y", fill: "assay",
      r: 1.6, fillOpacity: 0.45,
      tip: true
    }),
    vg.nearest({as: fileHover}),
    // Fades non-selected dots — vg.highlight modifies DOM directly (instant).
    vg.highlight({by: fileSel, opacity: 0.08}),
    // Legend selection — slightly enlarged filled dots with thin outline.
    vg.dot(vg.from(TABLE.files, {filterBy: legendFilter}), {
      x: "umap_x", y: "umap_y", fill: "assay",
      r: 2.5, fillOpacity: 1, stroke: "black", strokeWidth: 0.4
    }),
    // Single-dot click — Step 2-style black ring around the picked file.
    vg.dot(vg.from(TABLE.files, {filterBy: clickFilter}), {
      x: "umap_x", y: "umap_y",
      stroke: "black", strokeWidth: 2.5, fill: "none", r: 10
    }),
    vg.colorDomain(ASSAY_COLOR_DOMAIN),
    vg.colorRange(ASSAY_COLOR_RANGE),
    vg.colorLegend({as: $legendBrush}),
    vg.width(600),
    vg.height(500)
  );
  plot.style.flexDirection = "column-reverse";
  plot.style.cursor = "crosshair";
  plot.addEventListener("click", (e) => {
    // Skip clicks on the embedded color legend (outside the SVG) so they
    // don't double-write a stale id clause on top of the legend's assay
    // clause.
    const svg = plot.querySelector("svg");
    if (!svg || !svg.contains(e.target)) return;
    const v = fileHover.value;
    if (!v || !v.length) return;
    const [hx, hy] = v[0];
    const found = filesRows.find((d) => d.umap_x === hx && d.umap_y === hy);
    if (!found) return;
    // Clear legend, then write the file-click clause to its own brush.
    $legendBrush.reset();
    $fileClickBrush.update({
      source: fileClickSrc,
      value: found.id,
      predicate: vg.eq(vg.column("id"), vg.literal(found.id))
    });
  });
  return plot;
})();
```

```js
// Region UMAP — chr16 tokens. Background = faded full scatter; highlight
// layer is filterBy: intersectSel which the bridge populates with the
// intersection of active regions across the file selection.
const intersectionRegionPlot = vg.plot(
  vg.dot(classedChr16, {
    x: "umap_x", y: "umap_y", fill: "cclass", r: 1, fillOpacity: 0.1
  }),
  vg.dot(vg.from(TABLE.regions, {filterBy: intersectSel}), {
    x: "umap_x", y: "umap_y", fill: "cclass",
    r: 3, stroke: "black", strokeWidth: 0.5, opacity: 0.95,
    tip: true
  }),
  vg.colorDomain(SCREEN_CLASS_COLOR_DOMAIN),
  vg.colorRange(SCREEN_CLASS_COLOR_RANGE),
  vg.colorLegend(),
  vg.width(600),
  vg.height(500)
);
intersectionRegionPlot.style.flexDirection = "column-reverse";
```

```js
// Threshold slider: regions must be active in ≥ this fraction of the
// selected files. 1.0 = strict intersection (often empty for big groups);
// 0.5 = majority; 0 = anything-goes (top of the activity distribution).
const minFrac = view(Inputs.range([0, 1], {
  step: 0.01,
  value: 0.1,
  label: "Min fraction of selection active"
}));
```

```js
// Bridge: when fileSel or minFrac changes, run the threshold-frequency
// query in DuckDB and push the resulting token_ids onto intersectSel.
// HAVING COUNT(*) >= CEIL(N * minFrac) — at minFrac=1 this collapses to
// strict intersection; lower values yield a majority/plurality core.
// Capped at 5000 to keep clause size sane on permissive thresholds.
{
  const stringifyPredicate = (p) => {
    if (!p) return null;
    const arr = Array.isArray(p) ? p : [p];
    const parts = arr.filter(Boolean).map((x) => `(${String(x)})`);
    return parts.length ? parts.join(" AND ") : null;
  };
  const handler = async () => {
    const hasSelection = (fileSel.clauses?.length ?? 0) > 0;
    if (!hasSelection) {
      intersectSel.update(clausePoints(["token_id"], [], {source: intersectBridge}));
      setSectionStats({n_files: 0, n_regions: 0, has_selection: false});
      return;
    }
    const where = stringifyPredicate(fileSel.predicate());
    if (!where) {
      intersectSel.update(clausePoints(["token_id"], [], {source: intersectBridge}));
      setSectionStats({n_files: 0, n_regions: 0, has_selection: false});
      return;
    }
    const sizeRes = await coord.query(
      `SELECT COUNT(*)::INTEGER AS n FROM ${TABLE.files} WHERE ${where}`
    );
    const n = Number(arrowToRows(sizeRes)[0].n);
    if (n === 0) {
      intersectSel.update(clausePoints(["token_id"], [], {source: intersectBridge}));
      setSectionStats({n_files: 0, n_regions: 0, has_selection: true});
      return;
    }
    const cutoff = Math.max(1, Math.ceil(n * minFrac));
    const result = await coord.query(`
      WITH sel_files AS (SELECT id FROM ${TABLE.files} WHERE ${where}),
      sel_active AS (
        SELECT UNNEST(chr16_active_token_ids) AS token_id
        FROM ${TABLE.tokenizedCorpus}
        WHERE id IN (SELECT id FROM sel_files)
      )
      SELECT token_id
      FROM sel_active
      GROUP BY token_id
      HAVING COUNT(*) >= ${cutoff}
      LIMIT 5000
    `);
    const ids = arrowToRows(result).map((r) => [Number(r.token_id)]);
    intersectSel.update(clausePoints(["token_id"], ids, {source: intersectBridge}));
    setSectionStats({n_files: n, n_regions: ids.length, has_selection: true, min_frac: minFrac});
  };
  fileSel.addEventListener("value", handler);
  invalidation.then(() => fileSel.removeEventListener("value", handler));
  // Fire once on cell run so threshold changes update the plot immediately
  // (without waiting for a fileSel change).
  handler();
}
```

<div style="display: flex; gap: 16px; align-items: flex-start;">
  <div style="flex: 0 0 auto;">${fileUmap}</div>
  <div style="flex: 0 0 auto;">${intersectionRegionPlot}</div>
</div>

<div style="font-size: 0.85em; color: #666;">
${sectionStats.has_selection
  ? `${sectionStats.n_files.toLocaleString()} ${sectionStats.n_files === 1 ? "file" : "files"} selected. ${sectionStats.n_regions.toLocaleString()} chr16 regions active in ≥ ${Math.round((sectionStats.min_frac ?? 1) * 100)}% of them.`
  : "Click a file or an assay in the legend to define a selection."}
</div>
