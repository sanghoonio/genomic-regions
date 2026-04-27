---
title: A Dictionary of Regulatory Genomics
toc: false
---

<style>
  #observablehq-main { max-width: 1280px; }
</style>

# A Dictionary of Regulatory Genomics

Most of the human genome is non-coding. Most disease-associated variants sit in non-coding DNA. To interpret what those variants mean, we need a way to read what regulatory machinery is at any genomic location. This walkthrough treats regulatory elements as **words**, BED-file experiments as **documents**, and uses the distributional structure of co-occurrence to build a dictionary.

Five steps: **(1)** what's in a BED file, **(2)** tokenizing files against a universe, **(3)** the embedding as an emergent grammar, **(4)** each experiment as a partial vocabulary, and **(5)** hypothesizing about what we don't know.

Focus: **chromosome 16** of the human genome. Four narrative-anchoring loci to swap between.

```js
import * as vg from "npm:@uwdata/vgplot";
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
  tracks: await FileAttachment("data/dictionary/featured_tracks.parquet").href
};
```

```js
// Table-name registry; exported so vg.from(...) calls can reference it.
const TABLE = {
  regions: "dict_regions",
  files: "dict_files",
  intervals: "dict_featured_intervals",
  featuredFiles: "dict_featured_files",
  tracks: "dict_featured_tracks"
};
```

```js
// Register each parquet as a DuckDB table. The `tablesReady` export gates
// every downstream query/plot — anything that wants the data must read
// `tablesReady`.
const tablesReady = await (async () => {
  await Promise.all([
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.regions} AS SELECT * FROM read_parquet('${parquetUrls.regions}')`),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.files} AS SELECT * FROM read_parquet('${parquetUrls.files}')`),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.intervals} AS SELECT * FROM read_parquet('${parquetUrls.intervals}')`),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.featuredFiles} AS SELECT * FROM read_parquet('${parquetUrls.featuredFiles}')`),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.tracks} AS SELECT * FROM read_parquet('${parquetUrls.tracks}')`)
  ]);
  return true;
})();
```

```js
// Materialize tables into JS arrays. tablesReady is referenced so this
// cell waits for table registration to finish before querying.
tablesReady;
const intervals = arrowToRows(await coord.query(`SELECT * FROM ${TABLE.intervals}`));
const featuredFiles = arrowToRows(await coord.query(`SELECT * FROM ${TABLE.featuredFiles}`));
const tracks = arrowToRows(await coord.query(`SELECT * FROM ${TABLE.tracks}`));
const filesRows = arrowToRows(await coord.query(`SELECT * FROM ${TABLE.files}`));
const regions = arrowToRows(await coord.query(`SELECT * FROM ${TABLE.regions}`));
```

```js
// Stable, alphabetized list of file labels — shared y-axis domain for
// Steps 1 and 2 so rows align across the two plots.
const allFileLabels = Array.from(new Set(featuredFiles.map(fileLabel))).sort();
```

```js
// Featured interval picker. Drives the x-domain of Steps 1/2 and the
// outlined-tokens overlay in Step 3.
const currentInterval = view(Inputs.select(intervals, {
  label: "Featured interval",
  format: (i) => i.label,
  value: intervals[0]
}));
```

<div style="font-size: 0.9em; color: #555; margin-top: -0.5em; margin-bottom: 1em;">
${currentInterval.chrom}:${currentInterval.start.toLocaleString()}–${currentInterval.end.toLocaleString()} — ${currentInterval.narrative_caption}
</div>

## 1. Reading the raw experimental data

A BED file is the standard format for genomic experimental results: a list of intervals where some kind of activity was detected. ATAC-seq contains intervals where chromatin is accessible. ChIP-seq contains intervals where a specific protein binds. DNase-seq contains intervals of nuclease hypersensitivity. Each experiment emphasizes different aspects of regulatory biology.

```js
// Per-file peak rows for the currently selected interval. Mirrors mattress's
// Step1Peaks reshape. Filter to peaks ≥ 200 bp — sub-200 bp peaks are
// sub-pixel at chr16-window scales and look inconsistent.
const step1PeakRows = (() => {
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
```

```js
Plot.plot({
  width: 900,
  height: Math.max(220, 22 * allFileLabels.length),
  marginLeft: 220,
  marginRight: 30,
  marginTop: 30,
  marginBottom: 40,
  x: {
    domain: [currentInterval.start, currentInterval.end],
    label: currentInterval.chrom,
    grid: true,
    tickFormat: (d) => (d / 1e6).toFixed(2) + "M"
  },
  y: { label: "experiment", domain: allFileLabels, padding: 0.2 },
  color: {
    domain: ASSAY_COLOR_DOMAIN,
    range: ASSAY_COLOR_RANGE,
    legend: true
  },
  marks: [
    Plot.ruleY(allFileLabels, { stroke: "#eee", strokeWidth: 1 }),
    Plot.barX(step1PeakRows, {
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
  ]
})
```

<div style="font-size: 0.85em; color: #666;">
${new Set(step1PeakRows.map((r) => r.file_id)).size} experiments, ${step1PeakRows.length} peak intervals (≥200 bp) shown.
</div>

## 2. Tokenizing against a universe

Continuous coordinates don't make a dictionary — different experiments have slightly different peak boundaries even where they agree. We project each file onto a fixed *universe* of regulatory regions (the [SCREEN](https://screen.encodeproject.org/) candidate cis-regulatory elements, which integrate evidence across many ENCODE experiments). Each file becomes a binary presence vector.

```js
// Universe regions overlapping the current interval (top y-band).
const universeRows = regions
  .filter((r) =>
    r.chrom === currentInterval.chrom &&
    r.end > currentInterval.start &&
    r.start < currentInterval.end
  )
  .map((r) => ({
    token_id: r.token_id,
    cclass: r.cclass,
    start: r.start,
    end: r.end
  }));
```

```js
// Per-file token activations within the current interval (file y-bands).
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
  return rows;
})();
```

```js
// Combined plot: universe row at top, file rows below. Same x-domain as
// Step 1 → tokens align with peaks above.
const UNIVERSE_LABEL = "— UNIVERSE —";
const yDomain = [UNIVERSE_LABEL, ...allFileLabels];
const wideUniverse = universeRows.filter((r) => r.end - r.start >= 200);
const wideTokens = tokenRows.filter((d) => d.end - d.start >= 200);

display(Plot.plot({
  width: 900,
  height: Math.max(220, 22 * yDomain.length),
  marginLeft: 220,
  marginRight: 30,
  marginTop: 30,
  marginBottom: 40,
  x: {
    domain: [currentInterval.start, currentInterval.end],
    label: currentInterval.chrom,
    grid: true,
    tickFormat: (d) => (d / 1e6).toFixed(2) + "M"
  },
  y: { label: null, domain: yDomain, padding: 0.2 },
  color: {
    domain: SCREEN_CLASS_COLOR_DOMAIN,
    range: SCREEN_CLASS_COLOR_RANGE,
    legend: true
  },
  marks: [
    Plot.ruleY(allFileLabels, { stroke: "#eee", strokeWidth: 1 }),
    Plot.ruleY([UNIVERSE_LABEL], { stroke: "#888", strokeWidth: 1 }),
    Plot.barX(
      wideUniverse.map((r) => ({ ...r, label: UNIVERSE_LABEL })),
      {
        x1: "start",
        x2: "end",
        y: "label",
        fill: (d) => classColor(d.cclass),
        insetTop: 2,
        insetBottom: 2,
        clip: true,
        title: (d) =>
          `${d.cclass ?? "(no class)"}: ${d.start.toLocaleString()}–${d.end.toLocaleString()} (${d.end - d.start} bp)`
      }
    ),
    Plot.barX(wideTokens, {
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
}));
```

<div style="font-size: 0.85em; color: #666;">
${universeRows.length} universe tokens in this interval; ${tokenRows.length} (file × token) activations across ${allFileLabels.length} files.
</div>

## 3. A learned grammar

With every BED file as a binary "sentence" of universe tokens, a word2vec-style model ([Region2Vec](https://academic.oup.com/bioinformatics/article/40/2/btae073/7613064)) learns a 100-dimensional embedding per region. Regions that show up in similar files together end up close in embedding space. Project to 2D, color by SCREEN regulatory class, and the embedding has learned the dictionary on its own — promoters cluster with promoters, enhancers with enhancers.

```js
// Shared selection: brushing on the region UMAP populates this and
// downstream cells (Step 4 right pane, future Step 2 dimming) react.
const regionSelection = vg.Selection.crossfilter();
```

```js
tablesReady;
display(vg.plot(
  vg.dot(vg.from(TABLE.regions, {filterBy: regionSelection}), {
    x: "umap_x",
    y: "umap_y",
    fill: "cclass",
    r: 1.4,
    fillOpacity: 0.55
  }),
  vg.intervalXY({as: regionSelection}),
  vg.colorDomain(SCREEN_CLASS_COLOR_DOMAIN),
  vg.colorRange(SCREEN_CLASS_COLOR_RANGE),
  vg.width(900),
  vg.height(600),
  vg.colorLegend(true)
));
```

```js
// Outline overlay: tokens within the current interval, drawn over the main
// scatter via a second Plot layer (vgplot doesn't yet expose easy multi-mark
// composition tied to JS-side state).
const inIntervalRegions = regions.filter(
  (r) =>
    r.cclass !== null &&
    r.chrom === currentInterval.chrom &&
    r.end > currentInterval.start &&
    r.start < currentInterval.end
);
```

<div style="font-size: 0.85em; color: #666; margin-top: -0.5em;">
${regions.filter((r) => r.cclass !== null).length.toLocaleString()} chr16 tokens with SCREEN class. ${inIntervalRegions.length} tokens lie within the current interval.
</div>

## 4. Each experiment is a partial vocabulary

Every BED file activates a subset of the universe — an experiment is a sentence that uses some words from the dictionary and not others. Highlight a featured experiment to see which regions it uses.

```js
const pickedFile = view(Inputs.select(
  [{file_id: null, label: "(none)"}, ...featuredFiles.map((f) => ({
    file_id: f.file_id,
    label: `${f.role === "mystery" ? "[mystery] " : ""}${fileLabel(f)}`,
    n_active: f.n_chr16_active_tokens
  }))],
  {
    label: "Highlight a featured experiment",
    format: (f) => f.label,
    value: {file_id: null, label: "(none)"}
  }
));
```

```js
const activeTokenSet = (() => {
  if (!pickedFile.file_id) return new Set();
  const f = featuredFiles.find((x) => x.file_id === pickedFile.file_id);
  return new Set(f?.chr16_active_token_ids ?? []);
})();
```

```js
// File UMAP — labeled files colored by assay; mystery files as triangles.
const labeledFiles = filesRows.filter((d) => !d.is_unlabeled);
const mysteryFiles = filesRows.filter((d) => d.is_unlabeled);
const pickedRow = pickedFile.file_id
  ? filesRows.filter((d) => d.id === pickedFile.file_id)
  : [];

const fileUmap = Plot.plot({
  width: 600,
  height: 500,
  color: {
    domain: ASSAY_COLOR_DOMAIN,
    range: ASSAY_COLOR_RANGE,
    legend: true
  },
  marks: [
    Plot.dot(labeledFiles, {
      x: "umap_x",
      y: "umap_y",
      fill: "assay",
      r: 1.4,
      opacity: 0.4,
      title: (d) => `${d.assay}\n${d.cell_line}\n${d.name}`
    }),
    Plot.dot(mysteryFiles, {
      x: "umap_x",
      y: "umap_y",
      stroke: "black",
      fill: "white",
      r: 5,
      symbol: "triangle",
      title: (d) => `[mystery] ${d.name}`
    }),
    Plot.dot(pickedRow, {
      x: "umap_x",
      y: "umap_y",
      stroke: "magenta",
      strokeWidth: 2,
      r: 8,
      fill: "none"
    })
  ]
});
```

```js
// Region UMAP with the picked file's active tokens highlighted.
const classedRegions = regions.filter((r) => r.cclass !== null);
const inactive = classedRegions.filter((d) => !activeTokenSet.has(d.token_id));
const active = classedRegions.filter((d) => activeTokenSet.has(d.token_id));

const regionUmapHighlight = Plot.plot({
  width: 600,
  height: 500,
  color: {
    domain: SCREEN_CLASS_COLOR_DOMAIN,
    range: SCREEN_CLASS_COLOR_RANGE,
    legend: true
  },
  marks: [
    Plot.dot(inactive, {
      x: "umap_x",
      y: "umap_y",
      fill: "cclass",
      r: 1,
      opacity: pickedFile.file_id ? 0.1 : 0.55
    }),
    Plot.dot(active, {
      x: "umap_x",
      y: "umap_y",
      fill: "cclass",
      stroke: "black",
      strokeWidth: 0.4,
      r: 2.5,
      opacity: 0.95
    })
  ]
});
```

<div style="display: flex; gap: 16px; flex-wrap: wrap;">
  <div>${fileUmap}</div>
  <div>${regionUmapHighlight}</div>
</div>

<div style="font-size: 0.85em; color: #666;">
${pickedFile.file_id
  ? `${pickedFile.n_active.toLocaleString()} chr16 tokens active in this experiment.`
  : "Pick an experiment to see the regions it activates."}
</div>

## 5. Hypothesizing about what we don't know

The dictionary's class labels (PLS / pELS / dELS / ...) come from SCREEN's integrative ENCODE analysis. They cover a lot but are coarse — and they don't tell us what biological context a region operates in. Embedding-space neighborhoods give us a tool for interpolation: *what is this region like? what is this experiment like?*

<div style="padding: 1em; border: 1px dashed #aaa; border-radius: 4px; color: #555; font-style: italic;">
Step 5 placeholder — kNN class aggregation for a selected region, and file-UMAP-kNN aggregation for a selected mystery file. Tracked in <code>plans/2026-04-26-region-interpretation-step5.md</code>.
</div>
