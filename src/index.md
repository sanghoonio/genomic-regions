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
  featuredSignal: await FileAttachment("data/dictionary/featured_signal.parquet").href,
  // New (2026-04-28): dictionary-entry data layer.
  cooc: await FileAttachment("data/dictionary/region_cooccurrence_pmi.parquet").href,
  modules: await FileAttachment("data/dictionary/region_modules.parquet").href,
  moduleSummary: await FileAttachment("data/dictionary/module_summary.parquet").href,
  classProto: await FileAttachment("data/dictionary/region_class_prototypes.parquet").href,
  conceptAxes: await FileAttachment("data/dictionary/region_concept_axes.parquet").href,
  targetEvidence: await FileAttachment("data/dictionary/region_target_evidence.parquet").href,
  targetSummary: await FileAttachment("data/dictionary/region_target_evidence_summary.parquet").href
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
  featuredSignal: "dict_featured_signal",
  cooc: "dict_cooc",
  modules: "dict_modules",
  moduleSummary: "dict_module_summary",
  classProto: "dict_class_proto",
  conceptAxes: "dict_concept_axes",
  targetEvidence: "dict_target_evidence",
  targetSummary: "dict_target_summary"
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
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.featuredSignal} AS SELECT * FROM read_parquet('${parquetUrls.featuredSignal}')`),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.cooc} AS SELECT * FROM read_parquet('${parquetUrls.cooc}')`),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.modules} AS SELECT * FROM read_parquet('${parquetUrls.modules}')`),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.moduleSummary} AS SELECT * FROM read_parquet('${parquetUrls.moduleSummary}')`),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.classProto} AS SELECT * FROM read_parquet('${parquetUrls.classProto}')`),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.conceptAxes} AS SELECT * FROM read_parquet('${parquetUrls.conceptAxes}')`),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.targetEvidence} AS SELECT * FROM read_parquet('${parquetUrls.targetEvidence}')`),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.targetSummary} AS SELECT * FROM read_parquet('${parquetUrls.targetSummary}')`)
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
// Small per-token lookup tables for the dictionary card. The big ones
// (cooc, modules, target_evidence) stay in DuckDB and are queried lazily
// when a token is picked.
const classProtoRows = arrowToRows(await coord.query(`SELECT * FROM ${TABLE.classProto}`));
const conceptAxesRows = arrowToRows(await coord.query(`SELECT * FROM ${TABLE.conceptAxes}`));
const targetSummaryRows = arrowToRows(await coord.query(`SELECT * FROM ${TABLE.targetSummary}`));
```

```js
// Per-token lookup maps for the dictionary card.
const classProtoByToken = new Map(classProtoRows.map((r) => [r.token_id, r]));
const conceptAxesByToken = new Map(conceptAxesRows.map((r) => [r.token_id, r]));
const targetSummaryByToken = new Map(targetSummaryRows.map((r) => [r.token_id, r]));
const regionsByToken = new Map(regions.map((r) => [r.token_id, r]));
```

```js
// Module-id lookup for the "Module ID" color toggle. Pulls only the
// active_vs_repressive_pan_cell stratum at γ=1.0 (validated default —
// AG cluster recovers as a coherent module here per pipeline impl log).
const moduleIdByToken = await (async () => {
  const rows = arrowToRows(await coord.query(`
    SELECT token_id, module_id, is_anchor
    FROM ${TABLE.modules}
    WHERE stratum = 'active_vs_repressive_pan_cell' AND gamma = 1.0
  `));
  const m = new Map();
  for (const r of rows) {
    // Cast to string so vgplot treats it as categorical, not continuous.
    m.set(r.token_id, {module_id: String(r.module_id), is_anchor: r.is_anchor});
  }
  return m;
})();
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
//   "class"     — SCREEN regulatory class (the dictionary itself).
//   "midpoint"  — genomic midpoint. Surfaces whether spatial neighbors on chr16
//                 land near each other in the embedding (mostly: no).
//   "files"     — n_files_total from region_stats. Housekeeping vs. cell-type-specific.
//   "anchor"    — concept-axis projection: promoter-like (+) ↔ distal-enhancer-like (−).
//                 Direct evidence the embedding learned a continuous PLS↔dELS gradient.
//   "activity"  — concept-axis projection: K562-active (+) ↔ K562-repressed (−).
//   "K562_spec" — concept-axis projection: K562-specifically-active vs broad-active.
//   "evidence"  — n_evidence_rows from target_evidence_summary. Highlights
//                 well-studied vs under-studied regions.
const regionColorBy = view(Inputs.radio(
  new Map([
    ["SCREEN class", "class"],
    ["Genomic midpoint", "midpoint"],
    ["File count (log)", "files"],
    ["Anchor score (PLS ↔ dELS)", "anchor"],
    ["Activity score (active ↔ repressed)", "activity"],
    ["K562 specificity", "K562_spec"],
    ["GM12878 specificity", "GM12878_spec"],
    ["HepG2 specificity", "HepG2_spec"],
    ["Target evidence count (log)", "evidence"],
    ["Module ID (active_vs_repressive)", "module"]
  ]),
  {value: "class", label: "Color regions by"}
));
```

```js
// One-line description per color encoding — tells the reader what story
// the current view is meant to surface.
const regionColorByCaption = ({
  class: "Discrete SCREEN labels (PLS / pELS / dELS / CA-CTCF / CA-H3K4me3). Shows the dictionary's prior — promoters cluster with promoters, distal enhancers form the large diffuse mass.",
  midpoint: "Continuous chr16 position (red=start, blue=end). If the embedding had memorized location, you'd see a clean gradient. Instead it looks uniformly mixed — the embedding learned function, not position.",
  files: "How many BED files this region was peak-called in (sqrt scale). Bright = housekeeping / broadly-accessible regions (CpG-island promoters, ubiquitous open chromatin); dark = cell-type-specific or rarely-called.",
  anchor: "Concept-axis projection onto a learned promoter-vs-distal-enhancer direction in R2V space. Blue = promoter-like, red = distal-enhancer-like. Direct visual evidence the embedding has internalized a continuous PLS↔dELS gradient as a single direction.",
  activity: "Concept-axis projection onto a K562-active vs K562-repressed direction. Green = active-like, magenta = repressed-like. Visible as a roughly vertical gradient — repressed regions concentrate in the upper diffuse mass, active regions toward the bottom — orthogonal to the anchor axis's left-right gradient. The two concept axes are picking up genuinely independent dimensions: a region can be promoter-like (anchor +) AND repressed (Polycomb-bivalent), or distal-enhancer-like (anchor −) AND active (typical pELS).",
  K562_spec: "Concept-axis projection onto a K562-specifically-active vs broadly-active direction. Orange = K562-specific, purple = active in non-K562 contexts. The clearest pattern of the three lineage views: sharp, localized orange islands within the otherwise diffuse dELS mass — most prominently a bright cluster lower-left and a smaller cluster on the right edge. Erythroid-specific distal enhancers form a tight, spatially-coherent subpopulation in R2V space even though SCREEN's class label doesn't carry lineage information.",
  GM12878_spec: "Lymphoid (GM12878) version of the same projection. The orange spreads more diffusely across the upper wing of the dELS mass, picking out *different* geographic regions than K562 — the K562-bright cluster (lower-left) is mostly purple here. Confirms that K562 and GM12878 have spatially separable distal-enhancer populations.",
  HepG2_spec: "Hepatic (HepG2) version. Orange spreads broadly across the upper dELS mass, less focally than K562's sharp islands. Three lineages, three visibly different geographic patterns in the same UMAP — the embedding learned cell-type-specific enhancer programs as separable directions without ever seeing a lineage label during training. (K562 has the sharpest pattern partly because it dominates the corpus: ~3,200 K562 files vs ~900 GM12878 / ~1,800 HepG2.)",
  evidence: "How many ENCODE V4 target-evidence rows this region accumulates (3D-chromatin + eQTL, +1 then log). Bright = well-studied / hub-like regions with many measured connections; dark = under-studied or solitary.",
  module: "Leiden community ID from stage 13 in the active_vs_repressive_pan_cell stratum (γ=1.0). Same color = same module. Tokens cluster geographically by module — direct visual evidence the corpus → NPMI graph → community detection chain produces spatially coherent groupings on the embedding (despite Leiden never seeing UMAP coords). The 17 modules at this resolution are coarse: dELS-dominant, pELS-dominant, etc., each spanning thousands of regions. Tokens missing from this stratum (failed statistical floor) show as gray '—'."
})[regionColorBy];
```

<div style="font-size: 0.85em; color: #555; margin: -0.6em 0 1em 0; padding: 0.5em 0.8em; background: #f7f7f5; border-left: 3px solid #888; border-radius: 0 3px 3px 0;">
${regionColorByCaption}
</div>


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
// Augment chr16 tokens with derived encodings so any of the color modes
// can read straight off a dot's row. Adds: midpoint, n_files_total (legacy
// region_stats), anchor_score / activity_score / K562_specificity_score
// (concept axes from R2V embedding), n_evidence_rows (Tier A target evidence
// count).
const regionStatsByToken = new Map(regionStats.map((s) => [s.token_id, s]));
const classedChr16 = regions
  .filter((r) => r.cclass !== null)
  .map((r) => {
    const ax = conceptAxesByToken.get(r.token_id);
    const tg = targetSummaryByToken.get(r.token_id);
    return {
      ...r,
      midpoint: (Number(r.start) + Number(r.end)) / 2,
      n_files_total: Number(regionStatsByToken.get(r.token_id)?.n_files_total ?? 0),
      anchor_score: ax ? Number(ax.anchor_score) : 0,
      activity_score: ax ? Number(ax.activity_score) : 0,
      K562_specificity_score: ax ? Number(ax.K562_specificity_score) : 0,
      GM12878_specificity_score: ax ? Number(ax.GM12878_specificity_score) : 0,
      HepG2_specificity_score: ax ? Number(ax.HepG2_specificity_score) : 0,
      // Add 1 so we can use log scale without log(0). Tokens with no
      // evidence will show as the lowest-color (1 → 0 on log scale).
      n_evidence_rows: tg ? Number(tg.n_evidence_rows) + 1 : 1,
      // Module ID in active_vs_repressive_pan_cell stratum (γ=1.0).
      // String for categorical; "—" for tokens not in this stratum.
      module_id_avr: moduleIdByToken.get(r.token_id)?.module_id ?? "—"
    };
  });

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
    : regionColorBy === "files" ? "n_files_total"
    : regionColorBy === "anchor" ? "anchor_score"
    : regionColorBy === "activity" ? "activity_score"
    : regionColorBy === "K562_spec" ? "K562_specificity_score"
    : regionColorBy === "GM12878_spec" ? "GM12878_specificity_score"
    : regionColorBy === "HepG2_spec" ? "HepG2_specificity_score"
    : regionColorBy === "module" ? "module_id_avr"
    : "n_evidence_rows";
  const colorDirectives =
    regionColorBy === "class"
      ? [vg.colorDomain(SCREEN_CLASS_COLOR_DOMAIN), vg.colorRange(SCREEN_CLASS_COLOR_RANGE)]
      : regionColorBy === "midpoint"
        ? [vg.colorScheme("turbo"), vg.colorLabel("midpoint (Mb)"), vg.colorTickFormat((d) => (d / 1e6).toFixed(1))]
      : regionColorBy === "files"
        ? [vg.colorScheme("viridis"), vg.colorScale("sqrt"), vg.colorLabel("n files (sqrt)")]
      : regionColorBy === "anchor"
        // Divergent: red = distal-enhancer-like (negative); blue = promoter-like (positive).
        // Symmetric around 0 so the gradient axis is interpretable.
        ? [vg.colorScheme("RdBu"), vg.colorDomain([-0.7, 0.7]), vg.colorLabel("anchor score")]
      : regionColorBy === "activity"
        ? [vg.colorScheme("PiYG"), vg.colorDomain([-0.5, 0.5]), vg.colorLabel("activity score")]
      : regionColorBy === "K562_spec"
        ? [vg.colorScheme("PuOr"), vg.colorDomain([-0.3, 0.3]), vg.colorLabel("K562 specificity")]
      : regionColorBy === "GM12878_spec"
        ? [vg.colorScheme("PuOr"), vg.colorDomain([-0.3, 0.3]), vg.colorLabel("GM12878 specificity")]
      : regionColorBy === "HepG2_spec"
        ? [vg.colorScheme("PuOr"), vg.colorDomain([-0.3, 0.3]), vg.colorLabel("HepG2 specificity")]
      : regionColorBy === "module"
        // Tableau 10 cycles for the ~17 modules at γ=1.0; visual clustering
        // works even with some color repetition.
        ? [vg.colorScheme("tableau10"), vg.colorLabel("module_id (active_vs_repressive)")]
        : [vg.colorScheme("viridis"), vg.colorScale("log"), vg.colorLabel("evidence rows (+1, log)")];
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
    // Partner overlays: NPMI partners first (orange ring, slightly larger)
    // then kNN partners (blue ring, smaller) so kNN draws on top — overlapping
    // partners show both rings concentric.
    vg.dot(vg.from(TABLE.regions, {filterBy: npmiPartnersSel}), {
      x: "umap_x", y: "umap_y",
      stroke: "#e07a00", strokeWidth: 1.6, fill: "none", r: 6
    }),
    vg.dot(vg.from(TABLE.regions, {filterBy: knnPartnersSel}), {
      x: "umap_x", y: "umap_y",
      stroke: "#1f78b4", strokeWidth: 1.6, fill: "none", r: 4.5
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
${classedChr16.length.toLocaleString()} chr16 tokens with SCREEN class. ${inIntervalSet.size} tokens lie within the current interval. ${pickedTokenId != null ? `Picked: ${classedChr16.find((r) => r.token_id === pickedTokenId)?.region ?? `token ${pickedTokenId}`}.` : "Click a token to highlight it as a focal region."} <span style="color: #1f78b4;">⬤</span> blue rings = top-30 R2V kNN partners; <span style="color: #e07a00;">⬤</span> orange rings = top-30 NPMI partners (corpus_baseline lens). Where they overlap is robust grammar; where one ring sits without the other is diagnostic.
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
// Partner highlights for the picked token: kNN partners (R2V embedding) and
// NPMI partners (corpus PMI). Each is a separate Selection.intersect so we
// can render them as distinct visual layers on the region UMAP — different
// stroke colors so the user sees where the two surfaces agree vs diverge.
const knnPartnersSel = vg.Selection.intersect({empty: true});
const npmiPartnersSel = vg.Selection.intersect({empty: true});
const knnPartnersBridge = {};
const npmiPartnersBridge = {};
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

// Bridge: pickedTokenSel + currentLens → knnPartnersSel + npmiPartnersSel.
// Cell depends on currentLens so it re-registers (and re-fires) whenever
// the lens picker changes — the orange NPMI ring on the UMAP stays in sync
// with the card's Section 5 partner list.
{
  const lens = currentLens;  // captured in closure; cell re-runs on lens change
  const handler = async () => {
    const tokenId = pickedTokenSel.value ?? null;
    if (tokenId == null) {
      knnPartnersSel.update(clausePoints(["token_id"], [], {source: knnPartnersBridge}));
      npmiPartnersSel.update(clausePoints(["token_id"], [], {source: npmiPartnersBridge}));
      return;
    }
    // Sync: kNN partners from viz_chr16's already-loaded knn_token_ids.
    const region = regionsByToken.get(tokenId);
    const knnIds = (region?.knn_token_ids ?? []).slice(0, 30).map((id) => [Number(id)]);
    knnPartnersSel.update(clausePoints(["token_id"], knnIds, {source: knnPartnersBridge}));
    // Async: NPMI partners from cooc parquet under current lens.
    const result = await coord.query(`
      SELECT partner_token_ids
      FROM ${TABLE.cooc}
      WHERE token_id = ${tokenId} AND stratum = '${lens}'
      LIMIT 1
    `);
    const rows = arrowToRows(result);
    const npmiIds = (rows[0]?.partner_token_ids ?? []).slice(0, 30).map((id) => [Number(id)]);
    npmiPartnersSel.update(clausePoints(["token_id"], npmiIds, {source: npmiPartnersBridge}));
  };
  pickedTokenSel.addEventListener("value", handler);
  invalidation.then(() => pickedTokenSel.removeEventListener("value", handler));
  // Fire once on cell run so lens-change immediately repopulates partner overlays.
  handler();
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

## 4. Looking up an entry

The dictionary's whole point is that every regulatory region has a **substantive entry** you can look up. Below: first a worked example for the **HBA1 promoter** (a canonical case for the dictionary because α-globin biology is well-studied), then a live card that populates with whatever region you click in the embedding above (Section 2).

```js
// HBA1 (token 255786) worked example — pinned static showcase before the
// live card. Uses the same data sources but always renders for HBA1 with
// inline callouts explaining what to read into each section. Re-runs only
// at page load; doesn't react to clicks or lens changes.
const hba1Showcase = await (async () => {
  const HBA1 = 255786;
  const region = regionsByToken.get(HBA1);
  const proto = classProtoByToken.get(HBA1);
  const axes = conceptAxesByToken.get(HBA1);
  const targets = targetSummaryByToken.get(HBA1);

  // Pull HBA1's corpus_baseline NPMI partners + per-stratum marginals.
  const coocResult = arrowToRows(await coord.query(`
    SELECT partner_token_ids, weights_npmi, counts, n_files_active, n_files_in_stratum
    FROM ${TABLE.cooc} WHERE token_id = ${HBA1} AND stratum = 'corpus_baseline' LIMIT 1
  `));
  const coocRow = coocResult[0];
  const marginalsRows = arrowToRows(await coord.query(`
    SELECT stratum, n_files_active, n_files_in_stratum
    FROM ${TABLE.cooc} WHERE token_id = ${HBA1}
  `));
  const margMap = new Map(marginalsRows.map((r) => [r.stratum, r]));

  // AG cluster token IDs for highlighting cluster siblings in partner lists.
  const agSet = new Set(
    regions.filter((r) => r.chrom === "chr16" && r.start >= 218000 && r.end <= 238000)
      .map((r) => r.token_id)
  );

  // ---- Helper: partner chip renderer ----
  const partnerChip = (pid, label) => {
    const p = regionsByToken.get(pid);
    const cc = p?.cclass || "unclassed";
    const color = classColor(cc);
    const isAG = agSet.has(pid);
    const regionStr = p ? p.region : `token ${pid}`;
    const agBadge = isAG ? ' <span style="background: #fef3c7; color: #92400e; padding: 0 4px; border-radius: 2px; font-size: 9px; font-weight: 700;">AG</span>' : "";
    return `<span style="display: inline-block; padding: 2px 8px; margin: 1px 3px 1px 0;
                         border-left: 3px solid ${color}; background: white; border-radius: 3px;
                         font-size: 11px; font-family: ui-monospace, Menlo, monospace;">
      <span style="color: ${color}; font-weight: 600;">${cc}</span>
      ${regionStr}${agBadge}${label ? ` <span style="color: #888;">${label}</span>` : ""}</span>`;
  };

  const callout = (text) => `
    <div style="margin: 6px 0 14px 0; padding: 8px 12px; background: #eef6fb;
                border-left: 3px solid #2b7a9d; border-radius: 0 3px 3px 0;
                font-size: 12px; color: #1e3a52; font-style: italic;">
      ${text}
    </div>`;

  const wrap = document.createElement("div");
  wrap.style.cssText =
    "border: 1px solid #c8d6e0; border-radius: 6px; padding: 18px 22px; " +
    "background: #f5f8fa; max-width: 1200px; font-size: 13px; line-height: 1.45; " +
    "margin-bottom: 22px;";

  // ---- Header with "Worked example" badge ----
  const headerHTML = `
    <div style="display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 8px;">
      <div>
        <span style="background: #2b7a9d; color: white; padding: 3px 10px; border-radius: 3px;
                     font-size: 11px; font-weight: 700; letter-spacing: 0.5px;">WORKED EXAMPLE</span>
        <span style="margin-left: 12px; font-size: 16px; font-weight: 600; color: #222;">HBA1 promoter — ${region.region}</span>
        <span style="background: ${classColor(region.cclass)}; color: white; padding: 2px 9px; border-radius: 3px;
                     margin-left: 8px; font-weight: 600; font-size: 12px;">${region.cclass}</span>
      </div>
      <span style="font-size: 11px; color: #888;">token ${HBA1} · ${region.end - region.start} bp</span>
    </div>
    <div style="font-size: 12px; color: #555; margin-bottom: 12px;">
      One of the major α-globin gene promoters at chr16:226–235k. Erythroid-specific in transcriptional output but its CpG-island promoter is broadly accessible across cell types — a compact case demonstrating that <em>chromatin footprint and gene expression are different signals</em>, both of which the dictionary needs to surface.
    </div>`;

  // ---- Class soft profile ----
  const distEntries = Object.entries(proto)
    .filter(([k]) => k.startsWith("distance_"))
    .map(([k, v]) => [k.replace("distance_", ""), Number(v)])
    .sort((a, b) => a[1] - b[1]);
  const weights = distEntries.map(([, d]) => 1 / (d + 0.01));
  const total = weights.reduce((a, b) => a + b, 0);
  const pcts = weights.map((w) => (w / total) * 100);
  const classBars = distEntries.map(([cc, d], i) => {
    const color = classColor(cc);
    return `
      <div style="display: flex; align-items: center; gap: 8px; margin: 1px 0;">
        <div style="width: 90px; font-size: 11px; color: #555;">${cc}</div>
        <div style="flex: 1; height: 9px; max-width: 240px; background: #e2e8f0; border-radius: 2px; overflow: hidden;">
          <div style="height: 100%; width: ${pcts[i]}%; background: ${color};"></div>
        </div>
        <div style="font-size: 10px; color: #888; font-family: ui-monospace, Menlo, monospace; width: 60px;">
          ${pcts[i].toFixed(0)}% · d=${d.toFixed(2)}
        </div>
      </div>`;
  }).join("");
  const classCallout = callout(
    `→ <strong>PLS at ${pcts[distEntries.findIndex(([cc]) => cc === "PLS")].toFixed(0)}%</strong>, far above the next-closest class. The embedding strongly identifies HBA1 as a promoter — the categorical SCREEN label and the soft profile agree. The mild pELS overlap (~11%) is biologically reasonable given HBA1 sits adjacent to the α-globin enhancer cluster.`
  );

  // ---- Concept axes ----
  const axisEntries = [
    ["anchor", "promoter-like ↔ enhancer-like"],
    ["activity", "active ↔ repressed"],
    ["K562_specificity", "K562-specific"],
    ["GM12878_specificity", "GM12878-specific"],
    ["HepG2_specificity", "HepG2-specific"],
  ];
  const axisBars = axisEntries.map(([key, label]) => {
    const v = Number(axes[`${key}_score`] ?? 0);
    const positive = v >= 0;
    const pct = Math.min(100, Math.abs(v) * 100);
    const color = positive ? "#2ca02c" : "#d62728";
    return `
      <div style="display: flex; align-items: center; gap: 8px; margin: 1px 0;">
        <div style="width: 180px; font-size: 11px; color: #555;">${label}</div>
        <div style="position: relative; flex: 1; height: 9px; max-width: 240px; background: #e2e8f0; border-radius: 2px;">
          <div style="position: absolute; left: 50%; top: 0; height: 100%; width: 1px; background: #94a3b8;"></div>
          <div style="position: absolute; ${positive ? "left" : "right"}: 50%; top: 0; height: 100%;
                      width: ${pct / 2}%; background: ${color};
                      ${positive ? "border-radius: 0 2px 2px 0" : "border-radius: 2px 0 0 2px"};"></div>
        </div>
        <div style="font-size: 10px; color: #888; font-family: ui-monospace, Menlo, monospace; width: 60px;">
          ${v >= 0 ? "+" : ""}${v.toFixed(3)}
        </div>
      </div>`;
  }).join("");
  const axesCallout = callout(
    `→ <strong>anchor = +${axes.anchor_score.toFixed(2)}</strong> sits above the typical PLS median (+0.43) — the embedding sees HBA1 as <em>more</em> promoter-like than the average PLS, plausibly because the CpG-island TSS gives a sharp distinguishing signal in R2V space. <strong>K562 specificity = +${axes.K562_specificity_score.toFixed(2)}</strong> is small but positive — real erythroid bias detected in the embedding, but small in magnitude because HBA1's chromatin is broadly active across cell types. The two readings together: "broadly accessible promoter, slightly more so in K562" — biologically right.`
  );

  // ---- Senses across contexts (compressed, just the most informative strata) ----
  const sensesStrata = [
    {key: "corpus_baseline", display: "corpus_baseline (L1)"},
    {key: "active_promoters_pan_cell", display: "active_promoters (L4)"},
    {key: "erythroid_active", display: "erythroid_active (L5)"},
    {key: "lymphoid_active", display: "lymphoid_active (L5)"},
    {key: "hepatic_active", display: "hepatic_active (L5)"},
    {key: "polycomb_repressed_pan_cell", display: "polycomb_repressed (L4)"},
  ];
  const sensesBars = sensesStrata.map(({key, display}) => {
    const m = margMap.get(key);
    if (!m) {
      return `
        <div style="display: flex; align-items: center; gap: 8px; margin: 1px 0; opacity: 0.45;">
          <div style="width: 220px; font-size: 11px; color: #888;">${display}</div>
          <div style="flex: 1; height: 9px; max-width: 240px; background: #e2e8f0; border-radius: 2px;"></div>
          <div style="font-size: 10px; color: #aaa; font-family: ui-monospace, Menlo, monospace; width: 90px;">below floor</div>
        </div>`;
    }
    const pct = (Number(m.n_files_active) / Number(m.n_files_in_stratum)) * 100;
    return `
      <div style="display: flex; align-items: center; gap: 8px; margin: 1px 0;">
        <div style="width: 220px; font-size: 11px; color: #555;">${display}</div>
        <div style="flex: 1; height: 9px; max-width: 240px; background: #e2e8f0; border-radius: 2px; overflow: hidden;">
          <div style="height: 100%; width: ${pct}%; background: #2b7a9d;"></div>
        </div>
        <div style="font-size: 10px; color: #888; font-family: ui-monospace, Menlo, monospace; width: 90px;">
          ${m.n_files_active}/${m.n_files_in_stratum} = ${pct.toFixed(0)}%
        </div>
      </div>`;
  }).join("");
  const sensesCallout = callout(
    `→ Active in essentially <strong>every</strong> active-promoter file (chromatin accessibility / H3K4me3 mark) and in nearly every active-mark file across all three viz cell lines (K562 96%, lymphoid 80%, hepatic 80%). <strong>The transcriptional output is erythroid-specific; the chromatin footprint isn't.</strong> Below floor in <code>polycomb_repressed_pan_cell</code> — HBA1 is essentially never marked as Polycomb-silenced (CpG-island promoters generally aren't). One of the bars (active_promoters_pan_cell) is at 100% — corpus PMI under <em>that</em> lens would saturate (NPMI ≈ 0 for every partner) — exactly the case the live card's saturation warning catches.`
  );

  // ---- Grammatical relations ----
  const knnIds = (region.knn_token_ids ?? []).slice(0, 5);
  const knnDists = (region.knn_distances ?? []).slice(0, 5);
  const knnRow = knnIds.map((pid, i) => partnerChip(pid, `cos=${Number(knnDists[i]).toFixed(3)}`)).join("");
  const npmiIds = (coocRow?.partner_token_ids ?? []).slice(0, 5);
  const npmiVals = (coocRow?.weights_npmi ?? []).slice(0, 5);
  const npmiCounts = (coocRow?.counts ?? []).slice(0, 5);
  const npmiRow = npmiIds.map((pid, i) =>
    partnerChip(pid, `npmi=${Number(npmiVals[i]).toFixed(3)}, cooc=${Number(npmiCounts[i])}`)
  ).join("");

  // Count AG cluster siblings recovered across both surfaces
  const knn30 = (region.knn_token_ids ?? []).slice(0, 30);
  const npmi30 = (coocRow?.partner_token_ids ?? []).slice(0, 30);
  const agInKnn = knn30.filter((id) => agSet.has(id) && id !== HBA1);
  const agInNpmi = npmi30.filter((id) => agSet.has(id) && id !== HBA1);
  const agUnion = new Set([...agInKnn, ...agInNpmi]);
  const grammarHTML = `
    <div style="margin-top: 4px;">
      <div style="font-size: 11px; color: #666; margin-bottom: 3px;">R2V kNN (top 5):</div>
      <div>${knnRow}</div>
    </div>
    <div style="margin-top: 8px;">
      <div style="font-size: 11px; color: #666; margin-bottom: 3px;">corpus_baseline NPMI (top 5):</div>
      <div>${npmiRow}</div>
    </div>`;
  const grammarCallout = callout(
    `→ Both surfaces surface adjacent α-globin cluster siblings (yellow <strong>AG</strong> badge above). R2V kNN includes <strong>${agInKnn.length}</strong> AG cluster members in its top-30; corpus_baseline NPMI surfaces <strong>${agInNpmi.length}</strong>; together they recover <strong>${agUnion.size} of 13</strong> AG siblings — partners neither surface alone surfaces in full. The two views aren't redundant: kNN found cluster members R2V learned were similar (smoothed), NPMI found cluster members that empirically co-activate (raw evidence). Both are corpus-grounded; their agreement is the dictionary's grammar holding up to triangulation.`
  );

  // ---- Target evidence ----
  const topGenes = (targets?.top_genes ?? []).slice(0, 5);
  const targetChips = topGenes.map((g) => `
    <span style="display: inline-block; padding: 3px 10px; margin: 2px 4px 2px 0;
                 background: white; border: 1px solid #cbd5e0; border-radius: 3px;
                 font-family: ui-monospace, Menlo, monospace; font-size: 11px;
                 font-weight: 600; color: #2d3748;">${g}</span>`).join("");
  const targetCount = `${Number(targets?.n_evidence_rows ?? 0)} rows (${Number(targets?.n_3d_chromatin ?? 0)} 3D, ${Number(targets?.n_eqtl ?? 0)} eQTL) across ${Number(targets?.n_distinct_contexts ?? 0)} contexts`;
  const targetCallout = callout(
    `→ Top "target": <strong>${topGenes[0] ?? "—"}</strong> — but read carefully. Because HBA1 is a <strong>PLS</strong>, the V4 evidence reports <em>genes whose promoters HBA1 contacts in 3D space</em> (TAD-mate genes), not "genes HBA1 regulates." ${topGenes[0]}, NPRL3, SNRNP25 etc. all sit in the same chr16 TAD; the 3D-chromatin data is recovering that TAD without ever computing TADs explicitly. For an <em>enhancer</em> focal region the same target_gene would read as "regulated promoter" instead. The dictionary card needs UI discipline to surface this distinction; in this worked example it's called out explicitly.`
  );

  wrap.innerHTML = `
    ${headerHTML}
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 18px; align-items: start;">
      <div>
        <div style="font-weight: 600; font-size: 12px; color: #444; margin-bottom: 4px;">Class soft profile</div>
        ${classBars}
        ${classCallout}
        <div style="font-weight: 600; font-size: 12px; color: #444; margin-bottom: 4px;">Concept-axis projections</div>
        ${axisBars}
        ${axesCallout}
      </div>
      <div>
        <div style="font-weight: 600; font-size: 12px; color: #444; margin-bottom: 4px;">Senses across contexts (selected strata)</div>
        ${sensesBars}
        ${sensesCallout}
        <div style="font-weight: 600; font-size: 12px; color: #444; margin-bottom: 4px;">Top "target" evidence</div>
        <div style="font-size: 11px; color: #666; margin-bottom: 4px;">${targetCount}</div>
        <div>${targetChips}</div>
        ${targetCallout}
      </div>
    </div>
    <div>
      <div style="font-weight: 600; font-size: 12px; color: #444; margin: 4px 0;">Grammatical relations (R2V kNN + corpus_baseline NPMI, top 5 each)</div>
      ${grammarHTML}
      ${grammarCallout}
    </div>
    <div style="font-size: 11px; color: #666; margin-top: 8px; padding-top: 8px; border-top: 1px dashed #c8d6e0;">
      <strong>What to read out of this:</strong> a single dictionary entry compactly carries class identity (hard label + soft profile + concept axes), multi-stratum activity profile, two complementary partner views (R2V kNN + corpus PMI), and predicted regulatory targets — with methodologically honest framing where it matters (saturation warnings, PLS-vs-enhancer reading distinctions). This is the format every region's entry takes; below, click any region in Section 2's embedding to see its own card under any lens you choose.
    </div>`;
  return wrap;
})();
```

${hba1Showcase}

The card below populates with whatever region you click in the embedding above (Section 2). It surfaces the region's identity (class + soft profile), its concept-axis scores in R2V's learned space, two parallel views of grammatical neighbors (functional similarity from R2V kNN; corpus grammar from PMI cooccurrence — under whichever **lens** you pick below), and predicted regulatory targets from ENCODE V4's direct experimental evidence.

The **stratum lens** controls which biological question the corpus-grammar partners answer. `corpus_baseline` is the broad reference; mark-specific and lineage-specific lenses sharpen the partners to a particular biological context. For hub regions (canonical promoters / CTCF sites), narrow lenses often saturate (token in 100% of stratum files → NPMI ≈ 0); broad lenses give the cleanest partners. The lens also drives the orange (NPMI) partner overlay on the embedding above.

```js
// Stratum lens picker — drives the card's Section 5 (corpus-grammar partners)
// and the orange NPMI partner overlay on the region UMAP. 18 strata across
// 6 levels (L1 corpus → L6 contrast). Default: corpus_baseline (broad,
// Goldilocks for most tokens).
const currentLens = view(Inputs.select(
  [
    "corpus_baseline",
    "featured_lineage_K562",
    "featured_lineage_GM12878",
    "featured_lineage_HepG2",
    "open_chromatin_pan_cell",
    "tf_bound_pan_cell",
    "active_enhancers_pan_cell",
    "active_promoters_pan_cell",
    "polycomb_repressed_pan_cell",
    "heterochromatin_pan_cell",
    "ctcf_boundaries",
    "erythroid_active",
    "lymphoid_active",
    "hepatic_active",
    "active_vs_repressive_pan_cell",
    "erythroid_vs_other_repressive",
    "lymphoid_vs_other_repressive",
    "hepatic_vs_other_repressive"
  ],
  {value: "corpus_baseline", label: "Stratum lens (corpus-grammar partners)"}
));
```

```js
// Dictionary entry card. Re-renders when pickedTokenId or currentLens changes.
// Async because we query the cooc parquet on demand (it's 97 MB; full
// materialization would block load). Other lookups are JS-side maps.
const dictCard = await (async () => {
  const tokenId = pickedTokenId;
  const wrap = document.createElement("div");
  wrap.style.cssText =
    "border: 1px solid #ccc; border-radius: 6px; padding: 18px 22px; " +
    "background: #fafafa; max-width: 1200px; font-size: 14px; line-height: 1.5;";

  if (tokenId == null) {
    wrap.innerHTML =
      `<em style="color: #888;">Click a region on the embedding above to look up its entry.</em>`;
    return wrap;
  }

  const region = regionsByToken.get(tokenId);
  if (!region) {
    wrap.innerHTML = `<em>token ${tokenId} not found in chr16 universe.</em>`;
    return wrap;
  }

  const proto = classProtoByToken.get(tokenId);
  const axes = conceptAxesByToken.get(tokenId);
  const targets = targetSummaryByToken.get(tokenId);

  // Query top NPMI partners in the user-selected lens (defaults to corpus_baseline).
  const lens = currentLens;
  const coocResult = arrowToRows(await coord.query(`
    SELECT partner_token_ids, weights_npmi, counts, n_files_active, n_files_in_stratum
    FROM ${TABLE.cooc}
    WHERE token_id = ${tokenId} AND stratum = '${lens}'
    LIMIT 1
  `));
  const coocRow = coocResult[0];

  // Per-stratum marginals across all 18 strata (Senses across contexts).
  const marginalsRows = arrowToRows(await coord.query(`
    SELECT stratum, n_files_active, n_files_in_stratum
    FROM ${TABLE.cooc}
    WHERE token_id = ${tokenId}
  `));
  const marginalsByStratum = new Map(
    marginalsRows.map((r) => [r.stratum, r])
  );

  const knnIds = (region.knn_token_ids ?? []).slice(0, 10);
  const knnDists = (region.knn_distances ?? []).slice(0, 10);

  // Helper: render a partner as a class-colored chip.
  const partnerChip = (pid, label) => {
    const p = regionsByToken.get(pid);
    const cc = p?.cclass || "unclassed";
    const color = classColor(cc);
    const regionStr = p ? p.region : `token ${pid}`;
    return `<span style="display: inline-block; padding: 2px 8px; margin: 2px 4px 2px 0; ` +
           `border-left: 3px solid ${color}; background: white; border-radius: 3px; ` +
           `font-size: 12px; font-family: ui-monospace, Menlo, monospace;">` +
           `<span style="color: ${color}; font-weight: 600;">${cc}</span> ` +
           `${regionStr}${label ? ` <span style="color: #888;">${label}</span>` : ""}` +
           `</span>`;
  };

  // ---- Section 1: Headword + class ----
  const headerColor = classColor(region.cclass || "unclassed");
  const length = region.end - region.start;
  const headerHTML = `
    <div style="display: flex; align-items: baseline; gap: 14px; margin-bottom: 6px;">
      <span style="font-size: 18px; font-weight: 600; color: #222;">${region.region}</span>
      <span style="background: ${headerColor}; color: white; padding: 2px 10px; border-radius: 3px;
                   font-weight: 600; font-size: 13px;">${region.cclass || "unclassed"}</span>
      <span style="font-size: 12px; color: #888;">token ${tokenId} · ${length.toLocaleString()} bp</span>
    </div>
  `;

  // ---- Section 2: Soft class profile ----
  let softHTML = "";
  if (proto) {
    const distEntries = Object.entries(proto)
      .filter(([k]) => k.startsWith("distance_"))
      .map(([k, v]) => [k.replace("distance_", ""), v])
      .sort((a, b) => a[1] - b[1]);
    // Convert distance to similarity-ish weight (1 / (d + epsilon)), then normalize.
    const weights = distEntries.map(([, d]) => 1 / (Number(d) + 0.01));
    const total = weights.reduce((a, b) => a + b, 0);
    const pcts = weights.map((w) => (w / total) * 100);
    const bars = distEntries.map(([cc, d], i) => {
      const color = classColor(cc);
      return `
        <div style="display: flex; align-items: center; gap: 8px; margin: 2px 0;">
          <div style="width: 90px; font-size: 12px; color: #555;">${cc}</div>
          <div style="flex: 1; height: 10px; background: #eee; border-radius: 2px; overflow: hidden; max-width: 240px;">
            <div style="height: 100%; width: ${pcts[i]}%; background: ${color};"></div>
          </div>
          <div style="font-size: 11px; color: #888; font-family: ui-monospace, Menlo, monospace; width: 56px;">
            ${pcts[i].toFixed(0)}% · d=${d.toFixed(2)}
          </div>
        </div>`;
    }).join("");
    softHTML = `
      <div style="margin-top: 8px;">
        <div style="font-weight: 600; font-size: 13px; color: #444; margin-bottom: 4px;">Class soft profile (R2V cosine to centroids)</div>
        ${bars}
      </div>`;
  }

  // ---- Section 3: Concept-axis scores ----
  let axesHTML = "";
  if (axes) {
    const axisEntries = [
      ["anchor", "promoter-like ↔ enhancer-like"],
      ["activity", "active ↔ repressed"],
      ["K562_specificity", "K562-specific"],
      ["GM12878_specificity", "GM12878-specific"],
      ["HepG2_specificity", "HepG2-specific"],
    ];
    const bars = axisEntries.map(([key, label]) => {
      const v = Number(axes[`${key}_score`] ?? 0);
      const positive = v >= 0;
      const pct = Math.min(100, Math.abs(v) * 100); // axes are roughly [-1, 1]
      const color = positive ? "#2ca02c" : "#d62728";
      return `
        <div style="display: flex; align-items: center; gap: 8px; margin: 2px 0;">
          <div style="width: 180px; font-size: 12px; color: #555;">${label}</div>
          <div style="position: relative; flex: 1; height: 10px; background: #eee; border-radius: 2px; max-width: 240px;">
            <div style="position: absolute; left: 50%; top: 0; height: 100%; width: 1px; background: #999;"></div>
            <div style="position: absolute; ${positive ? "left" : "right"}: 50%; top: 0; height: 100%;
                        width: ${pct / 2}%; background: ${color}; ${positive ? "border-radius: 0 2px 2px 0" : "border-radius: 2px 0 0 2px"};"></div>
          </div>
          <div style="font-size: 11px; color: #888; font-family: ui-monospace, Menlo, monospace; width: 56px;">
            ${v >= 0 ? "+" : ""}${v.toFixed(3)}
          </div>
        </div>`;
    }).join("");
    axesHTML = `
      <div style="margin-top: 14px;">
        <div style="font-weight: 600; font-size: 13px; color: #444; margin-bottom: 4px;">Concept-axis projections</div>
        ${bars}
      </div>`;
  }

  // ---- Section 3.5: Senses across contexts (per-stratum marginal activity) ----
  // 18 strata, grouped by level (L1 corpus → L6 contrast). Bars colored by
  // level. Each row shows n_files_active / n_files_in_stratum as a percentage.
  // Strata where the token failed the floor (min_files_active >= 5) show as
  // grayed "below floor" rows.
  const stratumOrder = [
    {key: "corpus_baseline", level: "L1", display: "corpus_baseline"},
    {key: "featured_lineage_K562", level: "L2", display: "K562 (broad)"},
    {key: "featured_lineage_GM12878", level: "L2", display: "GM12878 (broad)"},
    {key: "featured_lineage_HepG2", level: "L2", display: "HepG2 (broad)"},
    {key: "open_chromatin_pan_cell", level: "L3", display: "open chromatin"},
    {key: "tf_bound_pan_cell", level: "L3", display: "TF-bound"},
    {key: "active_enhancers_pan_cell", level: "L4", display: "active enhancers"},
    {key: "active_promoters_pan_cell", level: "L4", display: "active promoters"},
    {key: "polycomb_repressed_pan_cell", level: "L4", display: "Polycomb-repressed"},
    {key: "heterochromatin_pan_cell", level: "L4", display: "heterochromatin"},
    {key: "ctcf_boundaries", level: "L4", display: "CTCF boundaries"},
    {key: "erythroid_active", level: "L5", display: "erythroid active"},
    {key: "lymphoid_active", level: "L5", display: "lymphoid active"},
    {key: "hepatic_active", level: "L5", display: "hepatic active"},
    {key: "active_vs_repressive_pan_cell", level: "L6", display: "active vs repressive"},
    {key: "erythroid_vs_other_repressive", level: "L6", display: "erythroid vs other-Polycomb"},
    {key: "lymphoid_vs_other_repressive", level: "L6", display: "lymphoid vs other-Polycomb"},
    {key: "hepatic_vs_other_repressive", level: "L6", display: "hepatic vs other-Polycomb"},
  ];
  const levelColors = {
    L1: "#444", L2: "#3b82f6", L3: "#10b981",
    L4: "#f59e0b", L5: "#ef4444", L6: "#8b5cf6"
  };
  const sensesHTML = `
    <div style="margin-top: 14px;">
      <div style="font-weight: 600; font-size: 13px; color: #444; margin-bottom: 4px;">
        Senses across contexts (per-stratum marginal activity)
      </div>
      <div style="font-size: 11px; color: #888; margin-bottom: 6px;">
        Fraction of files in each curated stratum where this region is active.
        High = canonical for that biological question. Low = peripheral.
        Grayed = excluded by min-files-active floor.
      </div>
      ${stratumOrder.map(({key, level, display}) => {
        const m = marginalsByStratum.get(key);
        const color = levelColors[level];
        if (!m) {
          return `
            <div style="display: flex; align-items: center; gap: 8px; margin: 1px 0; opacity: 0.4;">
              <div style="width: 32px; font-size: 10px; color: ${color}; font-weight: 600;">${level}</div>
              <div style="width: 200px; font-size: 11px; color: #888;">${display}</div>
              <div style="flex: 1; height: 9px; max-width: 280px; background: #eee; border-radius: 2px;"></div>
              <div style="width: 88px; font-size: 10px; color: #aaa; font-family: ui-monospace, Menlo, monospace;">below floor</div>
            </div>`;
        }
        const pct = (Number(m.n_files_active) / Number(m.n_files_in_stratum)) * 100;
        return `
          <div style="display: flex; align-items: center; gap: 8px; margin: 1px 0;">
            <div style="width: 32px; font-size: 10px; color: ${color}; font-weight: 600;">${level}</div>
            <div style="width: 200px; font-size: 11px; color: #555;">${display}</div>
            <div style="flex: 1; height: 9px; max-width: 280px; background: #eee; border-radius: 2px; overflow: hidden;">
              <div style="height: 100%; width: ${pct}%; background: ${color};"></div>
            </div>
            <div style="width: 88px; font-size: 10px; color: #888; font-family: ui-monospace, Menlo, monospace;">
              ${Number(m.n_files_active)}/${Number(m.n_files_in_stratum)} = ${pct.toFixed(0)}%
            </div>
          </div>`;
      }).join("")}
    </div>`;

  // ---- Section 4: R2V kNN partners ----
  const knnHTML = knnIds.length === 0 ? "" : `
    <div style="margin-top: 14px;">
      <div style="font-weight: 600; font-size: 13px; color: #444; margin-bottom: 6px;">
        Functional similarity (R2V kNN top-${knnIds.length})
      </div>
      <div>${knnIds.map((pid, i) => partnerChip(pid, `cos=${Number(knnDists[i]).toFixed(3)}`)).join("")}</div>
    </div>`;

  // ---- Section 5: Corpus PMI partners (current lens) ----
  let pmiHTML = "";
  if (coocRow) {
    const pids = (coocRow.partner_token_ids ?? []).slice(0, 10);
    const npmi = (coocRow.weights_npmi ?? []).slice(0, 10);
    const counts = (coocRow.counts ?? []).slice(0, 10);
    const marg_n = Number(coocRow.n_files_active);
    const marg_d = Number(coocRow.n_files_in_stratum);
    const marg_pct = marg_d > 0 ? (marg_n / marg_d) * 100 : 0;
    // Saturation warning when token marginal is very high in this lens —
    // PMI/NPMI lose discriminative power above ~80%.
    const saturationNote = marg_pct >= 80
      ? ` <span style="color: #c43; font-weight: 600;">Saturation warning:</span> token marginal is ${marg_pct.toFixed(0)}% in this lens, so NPMI is near-flat across partners (the partner ordering is mostly arbitrary). Try a broader lens (e.g., <code>corpus_baseline</code>).`
      : "";
    pmiHTML = `
      <div style="margin-top: 14px;">
        <div style="font-weight: 600; font-size: 13px; color: #444; margin-bottom: 6px;">
          Corpus grammar (NPMI top-${pids.length}, lens: <code>${lens}</code>)
        </div>
        <div style="font-size: 11px; color: #888; margin-bottom: 4px;">
          this region active in ${marg_n}/${marg_d} = ${marg_pct.toFixed(0)}% of stratum files${saturationNote}
        </div>
        <div>${pids.map((pid, i) =>
          partnerChip(pid, `npmi=${Number(npmi[i]).toFixed(3)}, cooc=${Number(counts[i]).toFixed(0)}`)
        ).join("")}</div>
      </div>`;
  } else {
    pmiHTML = `
      <div style="margin-top: 14px;">
        <div style="font-weight: 600; font-size: 13px; color: #444; margin-bottom: 4px;">Corpus grammar</div>
        <div style="font-size: 12px; color: #888;">
          No PMI partners in <code>${lens}</code> — this region is below the statistical floor (active in <5 files of this stratum). Try a broader lens.
        </div>
      </div>`;
  }

  // ---- Section 6: Target evidence ----
  let targetHTML = "";
  if (targets) {
    const topGenes = (targets.top_genes ?? []).slice(0, 5);
    const cntStr =
      `${Number(targets.n_evidence_rows).toLocaleString()} evidence rows ` +
      `(${Number(targets.n_3d_chromatin)} 3D-chromatin, ${Number(targets.n_eqtl)} eQTL) ` +
      `across ${Number(targets.n_distinct_contexts)} biosample/tissue contexts; ` +
      `${Number(targets.n_distinct_genes)} distinct target genes`;
    const reading = region.cclass === "PLS"
      ? `<span style="color: #555;">(this is a PLS — listed genes are 3D-contact <em>partners in the same TAD</em>, not regulated targets)</span>`
      : `<span style="color: #555;">(predicted regulated targets via 3D contact + eQTL evidence)</span>`;
    targetHTML = `
      <div style="margin-top: 14px;">
        <div style="font-weight: 600; font-size: 13px; color: #444; margin-bottom: 4px;">
          Tier A target evidence (ENCODE V4 cCRE-Gene Links)
        </div>
        <div style="font-size: 11px; color: #888; margin-bottom: 6px;">${cntStr} ${reading}</div>
        <div>${topGenes.map((g) =>
          `<span style="display: inline-block; padding: 3px 10px; margin: 2px 4px 2px 0;
                        background: white; border: 1px solid #ddd; border-radius: 3px;
                        font-family: ui-monospace, Menlo, monospace; font-size: 12px;
                        font-weight: 600; color: #333;">${g}</span>`
        ).join("")}</div>
      </div>`;
  } else {
    targetHTML = `
      <div style="margin-top: 14px;">
        <div style="font-weight: 600; font-size: 13px; color: #444; margin-bottom: 4px;">Tier A target evidence</div>
        <div style="font-size: 12px; color: #888;">
          No 3D-chromatin or eQTL evidence available for this region.
        </div>
      </div>`;
  }

  wrap.innerHTML = headerHTML + softHTML + axesHTML + sensesHTML + knnHTML + pmiHTML + targetHTML;
  return wrap;
})();
```

${dictCard}

<div style="font-size: 0.85em; color: #666; margin-top: 0.5em;">
The grammatical-relations section shows two **parallel** views: R2V kNN partners (functional similarity in 100-dim embedding space) and corpus PMI partners (regions that actually co-occur in the same BED files, popularity-discounted via NPMI). Where both views surface the same partner, the grammar is robust; where they diverge, it's diagnostic — embedding-smoothed transitive similarity vs. raw cooccurrence evidence.
</div>

## 5. Browse the module catalogue

Each stratum's Leiden community detection produces a set of **modules** — graph communities of regions whose corpus cooccurrence in that stratum binds them together. The catalogue below lists modules in the currently-selected lens, sorted by size (largest first). Each row shows the module's *anchor* (highest within-module eigenvector centrality), its dominant SCREEN class, member count, and the auto-label.

**Click a module row to open its anchor's dictionary entry above.** Modules at γ=1.0 are coarse — typically dELS-dominant or pELS-dominant clusters spanning thousands of regions. Tier 4 work would surface finer-grained modules (γ-sweep) and curated featured-region sentences.

```js
// Module catalogue: load module summaries for the currently-selected lens
// (gamma=1.0). The summary parquet is small (599 rows) so we materialize
// once and filter in-JS.
const moduleSummaryRows = arrowToRows(await coord.query(`
  SELECT stratum, gamma, module_id, n_tokens, anchor_token_id,
         anchor_region, anchor_cclass, dominant_class, class_counts, auto_label
  FROM ${TABLE.moduleSummary}
  WHERE gamma = 1.0
  ORDER BY stratum, n_tokens DESC
`));
```

```js
// Render the module list for the active lens.
const moduleCatalogue = (() => {
  const wrap = document.createElement("div");
  wrap.style.cssText =
    "border: 1px solid #ddd; border-radius: 6px; padding: 14px 18px; " +
    "background: #fafafa; max-width: 1200px; font-size: 13px;";

  const lensModules = moduleSummaryRows
    .filter((m) => m.stratum === currentLens)
    .sort((a, b) => Number(b.n_tokens) - Number(a.n_tokens));

  if (lensModules.length === 0) {
    wrap.innerHTML = `<em style="color: #888;">No modules computed for lens <code>${currentLens}</code>.</em>`;
    return wrap;
  }

  const headerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px;">
      <span style="font-weight: 600; color: #333;">${lensModules.length} modules in <code>${currentLens}</code> at γ=1.0</span>
      <span style="font-size: 11px; color: #888;">click a row to open the anchor's entry above</span>
    </div>`;

  const rowsHTML = lensModules.map((m) => {
    const anchorColor = classColor(m.anchor_cclass || "unclassed");
    const dominantColor = classColor(m.dominant_class || "unclassed");
    const sizeLabel = Number(m.n_tokens).toLocaleString();
    return `
      <div class="module-row"
           data-anchor="${m.anchor_token_id}"
           data-module-id="${m.module_id}"
           data-module-size="${m.n_tokens}"
           style="border-radius: 3px; background: white; border-left: 3px solid ${dominantColor}; margin: 2px 0;">
        <div class="module-header"
             style="display: grid; grid-template-columns: 56px 240px 120px 1fr 18px; gap: 10px;
                    align-items: center; padding: 6px 8px; cursor: pointer;">
          <span style="font-family: ui-monospace, Menlo, monospace; color: #888; font-size: 11px;">m${m.module_id}</span>
          <span style="font-family: ui-monospace, Menlo, monospace; font-size: 11px;">
            <span style="color: ${anchorColor}; font-weight: 600;">${m.anchor_cclass || "—"}</span>
            ${m.anchor_region}
          </span>
          <span style="font-size: 11px; color: #555;">
            <span style="color: ${dominantColor}; font-weight: 600;">${m.dominant_class}</span>-dominant
          </span>
          <span style="font-size: 11px; color: #777;">${sizeLabel} tokens · ${m.class_counts}</span>
          <span class="expand-arrow" style="font-size: 12px; color: #aaa;">▸</span>
        </div>
      </div>`;
  }).join("");

  wrap.innerHTML = headerHTML + rowsHTML;

  // SCREEN class hierarchy used to order chips in the module sentence —
  // PLS first (anchor + co-anchor promoters), then proximal-enhancers,
  // distal enhancers, accessibility/CTCF specials, then unclassed.
  const classOrder = {"PLS": 0, "pELS": 1, "dELS": 2, "CA-H3K4me3": 3, "CA-CTCF": 4, "unclassed": 5};

  // State: which module's sentence is currently expanded (one at a time).
  let expandedRow = null;

  async function renderModuleSentence(row) {
    const moduleId = Number(row.dataset.moduleId);
    const moduleSize = Number(row.dataset.moduleSize);
    const stratum = currentLens;
    // Query top-50 members by within-module centrality, joined with class info.
    const members = arrowToRows(await coord.query(`
      SELECT m.token_id, m.within_module_centrality, m.is_anchor,
             v.region, v.cclass
      FROM ${TABLE.modules} m
      JOIN ${TABLE.regions} v ON m.token_id = v.token_id
      WHERE m.stratum = '${stratum}' AND m.gamma = 1.0 AND m.module_id = ${moduleId}
      ORDER BY m.within_module_centrality DESC
      LIMIT 50
    `));
    // Re-sort: class hierarchy (PLS → pELS → dELS → CA-H3K4me3 → CA-CTCF → unclassed),
    // then within each class by centrality desc. Anchor is always the first PLS by
    // definition (highest centrality of its class group).
    members.sort((a, b) => {
      const ac = classOrder[a.cclass || "unclassed"] ?? 6;
      const bc = classOrder[b.cclass || "unclassed"] ?? 6;
      if (ac !== bc) return ac - bc;
      return Number(b.within_module_centrality) - Number(a.within_module_centrality);
    });

    const chips = members.map((mem) => {
      const cc = mem.cclass || "unclassed";
      const color = classColor(cc);
      const star = mem.is_anchor
        ? '<span style="margin-right: 3px; color: #f59e0b;">★</span>'
        : '';
      return `<span class="member-chip"
                    data-token-id="${mem.token_id}"
                    title="centrality=${Number(mem.within_module_centrality).toFixed(4)}"
                    style="display: inline-block; padding: 2px 8px; margin: 2px 4px 2px 0;
                           border-left: 3px solid ${color}; background: white; border-radius: 3px;
                           font-size: 11px; font-family: ui-monospace, Menlo, monospace;
                           cursor: pointer; user-select: none;">
        ${star}<span style="color: ${color}; font-weight: 600;">${cc}</span>
        ${mem.region}
      </span>`;
    }).join("");

    const stream = document.createElement("div");
    stream.className = "module-stream";
    stream.style.cssText =
      "padding: 10px 14px; background: #f9fafb; border-top: 1px dashed #ccc; " +
      "border-radius: 0 0 3px 3px;";
    stream.innerHTML = `
      <div style="font-size: 11px; color: #666; margin-bottom: 6px; line-height: 1.5;">
        Module sentence — ${members.length} of ${moduleSize.toLocaleString()} members shown,
        ordered by SCREEN class hierarchy (PLS → pELS → dELS → CA-* → unclassed) then by within-module centrality.
        <span style="color: #f59e0b;">★</span> = anchor (highest within-module centrality).
        Click any chip to open its dictionary entry.
      </div>
      <div>${chips}</div>
      <div style="font-size: 10px; color: #888; margin-top: 6px; font-style: italic;">
        These regions form a Leiden community in the corpus PMI graph for the
        <code>${stratum}</code> lens. The "sentence" is the community read out as
        a regulatory unit: anchor + class-grouped co-members. Order is grammatical
        (class hierarchy + centrality), not genomic.
      </div>`;

    // Click handler for member chips: pick that token and scroll to card.
    stream.querySelectorAll(".member-chip").forEach((chip) => {
      chip.addEventListener("mouseenter", () => chip.style.background = "#fef3c7");
      chip.addEventListener("mouseleave", () => chip.style.background = "white");
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        const tokenId = Number(chip.dataset.tokenId);
        pickedTokenSel.update(
          clausePoint("token_id", tokenId, {source: pickTokenBridge})
        );
        document.querySelector("#observablehq-main")
          ?.querySelector("h2#4-looking-up-an-entry")
          ?.scrollIntoView({behavior: "smooth", block: "start"});
      });
    });

    row.appendChild(stream);
  }

  // Hover + click logic. Click row → updates pickedTokenSel to anchor (existing)
  // AND expands the row inline to show the module's sentence (new).
  wrap.querySelectorAll(".module-row").forEach((row) => {
    const header = row.querySelector(".module-header");
    const arrow = row.querySelector(".expand-arrow");
    header.addEventListener("mouseenter", () => header.style.background = "#f0f4f8");
    header.addEventListener("mouseleave", () => header.style.background = "white");
    header.addEventListener("click", async () => {
      // Update the picked token to this module's anchor (existing behavior).
      const anchorId = Number(row.dataset.anchor);
      pickedTokenSel.update(
        clausePoint("token_id", anchorId, {source: pickTokenBridge})
      );
      // Toggle inline expansion (new behavior).
      const isExpanded = row === expandedRow;
      if (expandedRow) {
        expandedRow.querySelector(".module-stream")?.remove();
        const prevArrow = expandedRow.querySelector(".expand-arrow");
        if (prevArrow) prevArrow.textContent = "▸";
        expandedRow = null;
      }
      if (!isExpanded) {
        await renderModuleSentence(row);
        if (arrow) arrow.textContent = "▾";
        expandedRow = row;
      }
    });
  });

  return wrap;
})();
```

${moduleCatalogue}

<div style="font-size: 0.85em; color: #666; margin-top: 0.5em;">
Click a module row to open its anchor's dictionary entry above <em>and</em> expand the row inline to show the module's "sentence" — its top-50 most-central members rendered as a flowing stream of class-colored chips, ordered by SCREEN class hierarchy then centrality. Switching the lens picker re-renders the catalogue. Module count varies dramatically by lens: ~7 modules in lineage-broad lenses (e.g., <code>featured_lineage_HepG2</code>) up to ~266 in <code>tf_bound_pan_cell</code>, where TF-binding patterns naturally form fine-grained communities.
</div>
