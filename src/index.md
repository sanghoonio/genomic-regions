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

Four steps: **(1)** projecting raw experimental peaks onto a shared vocabulary, **(2)** the embedding as an emergent grammar, **(3)** each experiment as a partial vocabulary, and **(4)** hypothesizing about what we don't know.

Focus: **chromosome 16** of the human genome. Four narrative-anchoring loci to swap between.

```js
import * as vg from "npm:@uwdata/vgplot";
import {clausePoints} from "npm:@uwdata/mosaic-core";
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
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.regions} AS SELECT * FROM read_parquet('${parquetUrls.regions}')`)
      .then(() => coord.exec(`CREATE OR REPLACE VIEW ${TABLE.regionsClassed} AS SELECT * FROM ${TABLE.regions} WHERE cclass IS NOT NULL`)),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.files} AS SELECT * FROM read_parquet('${parquetUrls.files}')`),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.intervals} AS SELECT * FROM read_parquet('${parquetUrls.intervals}')`),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.featuredFiles} AS SELECT * FROM read_parquet('${parquetUrls.featuredFiles}')`),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.tracks} AS SELECT * FROM read_parquet('${parquetUrls.tracks}')`),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.regionStats} AS SELECT * FROM read_parquet('${parquetUrls.regionStats}')`),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.tokenizedCorpus} AS SELECT * FROM read_parquet('${parquetUrls.tokenizedCorpus}')`),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.featuredSignal} AS SELECT * FROM read_parquet('${parquetUrls.featuredSignal}')`)
  ]);
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

To get a fixed dictionary we **project peaks onto a universe** of regulatory regions (the [SCREEN](https://screen.encodeproject.org/) candidate cis-regulatory elements, which integrate evidence across many ENCODE experiments). Every peak collapses to whichever universe regions it overlaps, and each file becomes a binary presence vector — that's tokenization.

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

With every BED file as a binary "sentence" of universe tokens, a word2vec-style model ([Region2Vec](https://academic.oup.com/bioinformatics/article/40/2/btae073/7613064)) learns a 100-dimensional embedding per region. Regions that show up in similar files together end up close in embedding space. Project to 2D, color by SCREEN regulatory class, and the embedding has learned the dictionary on its own — promoters cluster with promoters, enhancers with enhancers.

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

const regionUmap = (() => {
  const inInterval = classedChr16.filter((r) => inIntervalSet.has(r.token_id));
  const picked = pickedTokenId != null ? classedChr16.filter((r) => r.token_id === pickedTokenId) : [];
  const colorChannel =
    regionColorBy === "class" ? "cclass"
    : regionColorBy === "midpoint" ? "midpoint"
    : "n_files_total";
  const colorConfig =
    regionColorBy === "class"
      ? {domain: SCREEN_CLASS_COLOR_DOMAIN, range: SCREEN_CLASS_COLOR_RANGE, legend: true}
      : regionColorBy === "midpoint"
        ? {scheme: "turbo", legend: true, label: "midpoint (Mb)", tickFormat: (d) => (d / 1e6).toFixed(1)}
        : {scheme: "viridis", type: "sqrt", legend: true, label: "n files (sqrt)"};
  const plot = Plot.plot({
    width: 900,
    height: 600,
    color: colorConfig,
    marks: [
      Plot.dot(classedChr16, {x: "umap_x", y: "umap_y", fill: colorChannel, r: 1.4, fillOpacity: 0.55}),
      Plot.dot(inInterval, {x: "umap_x", y: "umap_y", fill: colorChannel, stroke: "black", strokeWidth: 0.7, r: 2.4}),
      Plot.dot(picked, {x: "umap_x", y: "umap_y", stroke: "magenta", strokeWidth: 2.5, fill: "none", r: 10}),
      Plot.dot(
        classedChr16,
        Plot.pointer({
          x: "umap_x",
          y: "umap_y",
          stroke: "black",
          strokeWidth: 1.2,
          r: 5,
          fill: "white",
          fillOpacity: 0.8,
          channels: {token_id: "token_id", region: "region", cclass: "cclass", midpoint: "midpoint", n_files_total: "n_files_total"}
        })
      ),
      Plot.tip(
        classedChr16,
        Plot.pointer({
          x: "umap_x",
          y: "umap_y",
          channels: {region: "region", cclass: "cclass", token_id: "token_id", midpoint: "midpoint", n_files_total: "n_files_total"},
          format: {x: false, y: false, region: true, cclass: true, token_id: true, midpoint: (d) => Math.round(d).toLocaleString(), n_files_total: true}
        })
      )
    ]
  });
  plot.style.cursor = "crosshair";
  plot.addEventListener("click", () => {
    const v = plot.value;
    if (v && v.token_id != null) setPickedTokenId(v.token_id === pickedTokenId ? null : v.token_id);
  });
  return plot;
})();
```

${regionUmap}

<div style="font-size: 0.85em; color: #666; margin-top: -0.5em;">
${classedChr16.length.toLocaleString()} chr16 tokens with SCREEN class. ${inIntervalSet.size} tokens lie within the current interval. ${pickedTokenId != null ? `Picked: ${classedChr16.find((r) => r.token_id === pickedTokenId)?.region ?? `token ${pickedTokenId}`}.` : "Click a token to highlight it as a focal region."}
</div>

## 3. Each experiment is a partial vocabulary

Every BED file activates a subset of the universe — an experiment is a sentence that uses some words from the dictionary and not others. **Click any file** in the left UMAP to highlight the chr16 regions it uses on the right.

```js
// Mutables holding the picked file id (Step 3) and the picked region
// token id (Step 2 → Step 4). Other cells reference these by name to read
// the current value; to write, call the matching setter — its closure
// captures the real Mutable wrapper, not the auto-unwrapped value.
const pickedFileId = Mutable(null);
function setPickedFileId(id) {
  pickedFileId.value = id;
}
// Default the focal token to the first universe token of the first
// featured interval so Step 2's "picked" highlight is non-empty on load.
const pickedTokenId = Mutable(intervals[0]?.universe_token_ids?.[0] ?? null);
function setPickedTokenId(id) {
  pickedTokenId.value = id;
}
```

```js
// Lazy DuckDB query: when pickedFileId changes, fetch that file's chr16
// active tokens from the 62 MB tokenized_corpus parquet. Cold start ~5s,
// warm queries sub-second (DuckDB-WASM caches the file).
const activeTokenIds = await (async () => {
  const id = pickedFileId;
  if (!id) return [];
  const safe = String(id).replace(/'/g, "''");
  const result = await coord.query(
    `SELECT chr16_active_token_ids FROM ${TABLE.tokenizedCorpus} WHERE id = '${safe}'`
  );
  const rows = arrowToRows(result);
  return rows[0]?.chr16_active_token_ids ?? [];
})();
```

```js
// File UMAP — clickable. All 16,794 files; click any dot to pick.
// `Plot.pointer` puts the row under the cursor in plot.value; the click
// handler reads that and writes to pickedFileId.
const fileUmap = (() => {
  const plot = Plot.plot({
    width: 600,
    height: 500,
    color: {domain: ASSAY_COLOR_DOMAIN, range: ASSAY_COLOR_RANGE, legend: true},
    marks: [
      Plot.dot(filesRows, {
        x: "umap_x",
        y: "umap_y",
        fill: "assay",
        r: 1.6,
        fillOpacity: 0.45
      }),
      ...(pickedFileId
        ? [
            Plot.dot(filesRows.filter((d) => d.id === pickedFileId), {
              x: "umap_x",
              y: "umap_y",
              stroke: "magenta",
              strokeWidth: 2,
              r: 8,
              fill: "none"
            })
          ]
        : []),
      Plot.dot(
        filesRows,
        Plot.pointer({
          x: "umap_x",
          y: "umap_y",
          stroke: "black",
          strokeWidth: 1.2,
          r: 5,
          fill: "white",
          fillOpacity: 0.8,
          channels: {id: "id", name: "name", cell_line: "cell_line", assay: "assay"}
        })
      ),
      Plot.tip(
        filesRows,
        Plot.pointer({
          x: "umap_x",
          y: "umap_y",
          channels: {file: "name", cell_line: "cell_line", assay: "assay"},
          format: {file: true, cell_line: true, assay: true, x: false, y: false}
        })
      )
    ]
  });
  plot.style.cursor = "crosshair";
  plot.addEventListener("click", () => {
    const v = plot.value;
    if (v && v.id != null) setPickedFileId(v.id === pickedFileId ? null : v.id);
  });
  return plot;
})();
```

```js
// Region UMAP — chr16 tokens; tokens active in the picked file are
// highlighted (larger, outlined) over a faded background.
const classedRegions = regions.filter((r) => r.cclass !== null);
const activeTokenSet = new Set(activeTokenIds);
const inactiveDots = classedRegions.filter((d) => !activeTokenSet.has(d.token_id));
const activeDots = classedRegions.filter((d) => activeTokenSet.has(d.token_id));

const regionUmapHighlight = Plot.plot({
  width: 600,
  height: 500,
  color: {domain: SCREEN_CLASS_COLOR_DOMAIN, range: SCREEN_CLASS_COLOR_RANGE, legend: true},
  marks: [
    Plot.dot(inactiveDots, {
      x: "umap_x",
      y: "umap_y",
      fill: "cclass",
      r: 1,
      opacity: pickedFileId ? 0.1 : 0.55
    }),
    Plot.dot(activeDots, {
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

```js
// Caption: file metadata + activation count for the picked file.
const pickedFileMeta = pickedFileId ? filesRows.find((d) => d.id === pickedFileId) : null;
const cleanField = (s) => (s && s !== "UNKNOWN" ? s : "");
const pickedFileCaption = pickedFileMeta
  ? `${pickedFileMeta.assay} · ${cleanField(pickedFileMeta.cell_line) || "—"}${cleanField(pickedFileMeta.cell_type) ? " (" + cleanField(pickedFileMeta.cell_type) + ")" : ""} · ${activeTokenIds.length.toLocaleString()} chr16 tokens active. ${pickedFileMeta.name}`
  : "Click a file in the left UMAP to highlight its chr16 token activations on the right.";
```

<div style="display: flex; gap: 16px; flex-wrap: wrap;">
  <div>${fileUmap}</div>
  <div>${regionUmapHighlight}</div>
</div>

<div style="font-size: 0.85em; color: #666;">${pickedFileCaption}</div>

## 4. What defines a group of experiments?

The dictionary's class labels are coarse and fixed. The corpus contains a different signal: each BED file activates a subset of the universe, so a group of files implies a *voice* — a subset of regions that's over-represented in the group relative to the full corpus.

Drag a rectangle on the file UMAP, or click an assay in the legend, to define a selection. The right-hand UMAP highlights the top-30 chr16 regions ranked by **differential frequency**: `P(active | selection) − P(active | corpus)`. The metric surfaces what makes the selected files *coherent* rather than the housekeeping regions everyone shares.

```js
// File-side selection composes brush + legend toggles.
// Region-side selection is a bridge target: the listener below pushes a
// `token_id IN (...)` clause whenever the differential top-30 changes,
// and the right-hand UMAP filters its highlight layer by it.
const fileSel = vg.Selection.intersect({empty: true});
const top30Sel = vg.Selection.intersect({empty: true});
// Object identity for the bridge clause's source — keeps successive
// updates de-duplicated against earlier ones.
const top30BridgeSource = {};
```

```js
// File UMAP. `vg.intervalXY` adds drag-rectangle selection;
// `vg.toggleColor` turns the embedded color legend into a click-to-filter.
const fileUmapBrush = vg.plot(
  vg.dot(
    vg.from(TABLE.files),
    {x: "umap_x", y: "umap_y", fill: "assay", r: 1.4, fillOpacity: 0.45}
  ),
  vg.dot(
    vg.from(TABLE.files, {filterBy: fileSel}),
    {x: "umap_x", y: "umap_y", fill: "assay", r: 2.5, fillOpacity: 1, stroke: "black", strokeWidth: 0.4}
  ),
  // vg.intervalXY({as: fileSel}),  // drag-select disabled for now — legend only
  vg.colorDomain(ASSAY_COLOR_DOMAIN),
  vg.colorRange(ASSAY_COLOR_RANGE),
  // Pass `as: fileSel` to make the legend itself click-to-filter
  // (toggleColor is for clicks ON DOTS, not on the legend).
  vg.colorLegend({as: fileSel}),
  vg.width(600),
  vg.height(500),
  vg.marginTop(40)
);
// vgplot defaults the plot wrapper to flex-row, putting the legend in
// its own column to the right. Stack the legend on top instead
// (column-reverse: svg renders below legend).
fileUmapBrush.style.flexDirection = "column-reverse";
```

```js
// Region UMAP — same chr16 layout as Step 2. Background layer renders
// every classed token at low opacity; highlight layer is filterBy: top30Sel
// so it reactively re-renders as the bridge updates the clause. Reads
// from the dict_regions_classed view (registered in setup) — passing a
// SQL subquery string to vg.from doesn't work; only table/view names do.
const top30RegionPlot = vg.plot(
  vg.dot(
    vg.from(TABLE.regionsClassed),
    {x: "umap_x", y: "umap_y", fill: "cclass", r: 1, fillOpacity: 0.08}
  ),
  vg.dot(
    vg.from(TABLE.regionsClassed, {filterBy: top30Sel}),
    {x: "umap_x", y: "umap_y", fill: "cclass", r: 4, stroke: "black", strokeWidth: 0.6}
  ),
  vg.colorDomain(SCREEN_CLASS_COLOR_DOMAIN),
  vg.colorRange(SCREEN_CLASS_COLOR_RANGE),
  vg.colorLegend(),
  vg.width(600),
  vg.height(500),
  vg.marginTop(40)
);
top30RegionPlot.style.flexDirection = "column-reverse";
```

```js
// Bridge: listen to fileSel, run the differential top-30 aggregation in
// DuckDB, push the resulting token_ids into top30Sel as a single
// `clausePoints` clause. vg.sql can't reactively interpolate Selection
// predicates inside a CTE, and our query is multi-CTE (UNNEST + GROUP BY
// + JOIN), so the imperative bridge is the cleanest path.
{
  const corpusSize = filesRows.length;
  const stringifyPredicate = (p) => {
    if (!p) return "TRUE";
    const arr = Array.isArray(p) ? p : [p];
    const parts = arr.filter(Boolean).map((x) => `(${String(x)})`);
    return parts.length ? parts.join(" AND ") : "TRUE";
  };
  const handler = async () => {
    const where = stringifyPredicate(fileSel.predicate());
    if (where === "TRUE") {
      top30Sel.update(clausePoints(["token_id"], [], {source: top30BridgeSource}));
      return;
    }
    const sizeRes = await coord.query(
      `SELECT COUNT(*)::INTEGER AS n FROM ${TABLE.files} WHERE ${where}`
    );
    const n = Number(arrowToRows(sizeRes)[0].n);
    if (n === 0) {
      top30Sel.update(clausePoints(["token_id"], [], {source: top30BridgeSource}));
      return;
    }
    const top30Res = await coord.query(`
      WITH sel_files AS (SELECT id FROM ${TABLE.files} WHERE ${where}),
      sel_active AS (
        SELECT UNNEST(chr16_active_token_ids) AS token_id
        FROM ${TABLE.tokenizedCorpus}
        WHERE id IN (SELECT id FROM sel_files)
      ),
      sel_counts AS (
        SELECT token_id, COUNT(*) AS n_in_S
        FROM sel_active
        GROUP BY token_id
      )
      SELECT s.token_id,
             (s.n_in_S * 1.0 / ${n}) - (rs.n_files_total * 1.0 / ${corpusSize}) AS diff
      FROM sel_counts s
      JOIN ${TABLE.regionStats} rs USING (token_id)
      JOIN ${TABLE.regions} viz USING (token_id)
      WHERE viz.cclass IS NOT NULL
      ORDER BY diff DESC LIMIT 30
    `);
    const ids = arrowToRows(top30Res).map((r) => [Number(r.token_id)]);
    top30Sel.update(clausePoints(["token_id"], ids, {source: top30BridgeSource}));
  };
  fileSel.addEventListener("value", handler);
  invalidation.then(() => fileSel.removeEventListener("value", handler));
}
```

<div style="display: flex; gap: 16px; align-items: flex-start;">
  <div style="flex: 0 0 auto;">${fileUmapBrush}</div>
  <div style="flex: 0 0 auto;">${top30RegionPlot}</div>
</div>

<div style="font-size: 0.85em; color: #666;">
Drag on the file UMAP or click an assay in the legend to define a selection. The right plot highlights the top 30 chr16 regions by P(active&nbsp;|&nbsp;selection)&nbsp;−&nbsp;P(active&nbsp;|&nbsp;corpus).
</div>
