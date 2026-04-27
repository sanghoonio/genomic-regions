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
  tracks: await FileAttachment("data/dictionary/featured_tracks.parquet").href,
  regionStats: await FileAttachment("data/dictionary/region_stats.parquet").href,
  cooccurrence: await FileAttachment("data/dictionary/region_cooccurrence.parquet").href,
  tokenizedCorpus: await FileAttachment("data/dictionary/tokenized_corpus_chr16.parquet").href
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
  cooccurrence: "dict_cooccurrence",
  tokenizedCorpus: "dict_tokenized_corpus"
};
```

```js
// Register each parquet as a DuckDB table. The `tablesReady` export gates
// every downstream query/plot — anything that wants the data must read
// `tablesReady`. Big tables (cooccurrence, tokenized_corpus) are registered
// here but not materialized — they're queried lazily on user interaction.
const tablesReady = await (async () => {
  await Promise.all([
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.regions} AS SELECT * FROM read_parquet('${parquetUrls.regions}')`),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.files} AS SELECT * FROM read_parquet('${parquetUrls.files}')`),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.intervals} AS SELECT * FROM read_parquet('${parquetUrls.intervals}')`),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.featuredFiles} AS SELECT * FROM read_parquet('${parquetUrls.featuredFiles}')`),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.tracks} AS SELECT * FROM read_parquet('${parquetUrls.tracks}')`),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.regionStats} AS SELECT * FROM read_parquet('${parquetUrls.regionStats}')`),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.cooccurrence} AS SELECT * FROM read_parquet('${parquetUrls.cooccurrence}')`),
    coord.exec(`CREATE OR REPLACE TABLE ${TABLE.tokenizedCorpus} AS SELECT * FROM read_parquet('${parquetUrls.tokenizedCorpus}')`)
  ]);
  return true;
})();
```

```js
// Materialize the small / always-needed tables into JS arrays. The two
// large tables (cooccurrence, tokenized_corpus) stay in DuckDB and are
// queried by file_id / token_id when the user clicks something.
tablesReady;
const intervals = arrowToRows(await coord.query(`SELECT * FROM ${TABLE.intervals}`));
const featuredFiles = arrowToRows(await coord.query(`SELECT * FROM ${TABLE.featuredFiles}`));
const tracks = arrowToRows(await coord.query(`SELECT * FROM ${TABLE.tracks}`));
const filesRows = arrowToRows(await coord.query(`SELECT * FROM ${TABLE.files}`));
const regions = arrowToRows(await coord.query(`SELECT * FROM ${TABLE.regions}`));
const regionStats = arrowToRows(await coord.query(`SELECT * FROM ${TABLE.regionStats}`));
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

The neighborhoods you see here are **embedding-space** neighborhoods — regions whose 100-dim R2V vectors are close. That's a stronger statement than "regions that happen to co-occur in BED files," which is what Step 5's cooccurrence panel will show. The two views agree most of the time but disagree in interesting places.

```js
// Region UMAP. Chr16 tokens colored by SCREEN class. Tokens overlapping
// the currently picked featured interval are outlined to tie back to Step 2.
// Click any dot to pick a focal region — the cooccurrence panel in Step 5
// reads from the same `pickedTokenId` Mutable.
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
const classedChr16 = regions.filter((r) => r.cclass !== null);

const regionUmap = (() => {
  const inInterval = classedChr16.filter((r) => inIntervalSet.has(r.token_id));
  const picked = pickedTokenId != null ? classedChr16.filter((r) => r.token_id === pickedTokenId) : [];
  const plot = Plot.plot({
    width: 900,
    height: 600,
    color: {domain: SCREEN_CLASS_COLOR_DOMAIN, range: SCREEN_CLASS_COLOR_RANGE, legend: true},
    marks: [
      Plot.dot(classedChr16, {x: "umap_x", y: "umap_y", fill: "cclass", r: 1.4, fillOpacity: 0.55}),
      Plot.dot(inInterval, {x: "umap_x", y: "umap_y", fill: "cclass", stroke: "black", strokeWidth: 0.7, r: 2.4}),
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
          channels: {token_id: "token_id", region: "region", cclass: "cclass"}
        })
      ),
      Plot.tip(
        classedChr16,
        Plot.pointer({
          x: "umap_x",
          y: "umap_y",
          channels: {region: "region", cclass: "cclass", token_id: "token_id"},
          format: {x: false, y: false, region: true, cclass: true, token_id: true}
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
${classedChr16.length.toLocaleString()} chr16 tokens with SCREEN class. ${inIntervalSet.size} tokens lie within the current interval. ${pickedTokenId != null ? `Picked: ${classedChr16.find((r) => r.token_id === pickedTokenId)?.region ?? `token ${pickedTokenId}`}.` : "Click a token to pick a focal region for Step 5."}
</div>

## 4. Each experiment is a partial vocabulary

Every BED file activates a subset of the universe — an experiment is a sentence that uses some words from the dictionary and not others. **Click any file** in the left UMAP to highlight the chr16 regions it uses on the right.

```js
// Mutables holding the picked file id (Step 4) and the picked region
// token id (Step 3 → Step 5). Other cells reference these by name to read
// the current value; to write, call the matching setter — its closure
// captures the real Mutable wrapper, not the auto-unwrapped value.
const pickedFileId = Mutable(null);
function setPickedFileId(id) {
  pickedFileId.value = id;
}
const pickedTokenId = Mutable(null);
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

## 5. Hypothesizing about what we don't know

The dictionary's class labels (PLS / pELS / dELS / ...) come from SCREEN's integrative ENCODE analysis. They cover a lot but are coarse — and they don't say what *context* a region operates in. The corpus itself contains evidence: every BED file activates a subset of the universe, so co-activation across files is a measurable signal of "these regions go together." This is a different question from Step 3's embedding-similarity — and the difference is exactly what makes contextual models like Atacformer interesting.

For a clicked region, this panel pulls its top-30 cooccurrence partners (by Jaccard similarity in the chosen context) from the corpus and lays them on the region UMAP. Edges show which partners are spatially close in the embedding (the Step-3 view) and which aren't.

```js
const cooccurContext = view(Inputs.select(
  ["all", "K562", "GM12878", "HepG2"],
  {label: "Cooccurrence context", value: "all"}
));
```

```js
// Lazy DuckDB query for the top-30 cooccurrence partners of the picked
// token in the chosen context. Runs only when both inputs are set.
const egoPartners = await (async () => {
  if (pickedTokenId == null) return null;
  const safeCtx = String(cooccurContext).replace(/'/g, "''");
  const result = await coord.query(
    `SELECT token_id, n_files_active, partner_token_ids, weights_jaccard, counts
     FROM ${TABLE.cooccurrence}
     WHERE token_id = ${Number(pickedTokenId)} AND context = '${safeCtx}'`
  );
  const rows = arrowToRows(result);
  return rows[0] ?? null;
})();
```

```js
// Ego network rendered ONTO the region UMAP. Background = faded Step-3
// scatter, focal = magenta ring, partners = colored + sized by Jaccard,
// edges = focal→partner with stroke width = Jaccard. Cooccurrence partners
// that cluster spatially with the focal token are also embedding-similar;
// scattered partners are corpus-co-active despite *not* being embedding
// neighbors — those are the interesting cases.
const egoNetwork = (() => {
  if (pickedTokenId == null) {
    return html`<div style="padding: 1em; color: #666; border: 1px dashed #aaa; border-radius: 4px;">
      Click a token in the Step 3 UMAP to see its cooccurrence partners.
    </div>`;
  }
  if (!egoPartners) {
    return html`<div style="padding: 1em; color: #888;">No cooccurrence row for token ${pickedTokenId} in context "${cooccurContext}".</div>`;
  }
  const focal = classedChr16.find((r) => r.token_id === pickedTokenId)
    ?? regions.find((r) => r.token_id === pickedTokenId);
  if (!focal) {
    return html`<div style="padding: 1em; color: #888;">Token ${pickedTokenId} not in chr16 universe.</div>`;
  }
  const tokenLookup = new Map(regions.map((r) => [r.token_id, r]));
  const edges = egoPartners.partner_token_ids.map((pid, i) => {
    const p = tokenLookup.get(pid);
    if (!p) return null;
    return {
      partner_id: pid,
      weight: egoPartners.weights_jaccard[i],
      count: egoPartners.counts[i],
      partner_x: p.umap_x,
      partner_y: p.umap_y,
      cclass: p.cclass,
      region: p.region,
      focal_x: focal.umap_x,
      focal_y: focal.umap_y
    };
  }).filter(Boolean);

  return Plot.plot({
    width: 900,
    height: 600,
    color: {domain: SCREEN_CLASS_COLOR_DOMAIN, range: SCREEN_CLASS_COLOR_RANGE, legend: true},
    marks: [
      Plot.dot(classedChr16, {x: "umap_x", y: "umap_y", fill: "cclass", r: 1, opacity: 0.08}),
      Plot.link(edges, {
        x1: "focal_x", y1: "focal_y",
        x2: "partner_x", y2: "partner_y",
        stroke: "#444",
        strokeOpacity: 0.5,
        strokeWidth: (d) => 0.5 + d.weight * 7
      }),
      Plot.dot(edges, {
        x: "partner_x",
        y: "partner_y",
        fill: "cclass",
        stroke: "black",
        strokeWidth: 0.5,
        r: (d) => 3 + d.weight * 8,
        title: (d) => `${d.region}\n${d.cclass ?? "(no class)"}\nJaccard: ${d.weight.toFixed(3)}\nCo-active in ${d.count} files`
      }),
      Plot.dot([focal], {
        x: "umap_x",
        y: "umap_y",
        stroke: "magenta",
        strokeWidth: 2.5,
        fill: "white",
        r: 11
      }),
      Plot.text([focal], {
        x: "umap_x",
        y: "umap_y",
        text: () => "★",
        fill: "magenta",
        fontSize: 14,
        textAnchor: "middle"
      })
    ]
  });
})();
```

${egoNetwork}

<div style="font-size: 0.85em; color: #666; margin-top: -0.5em;">
${pickedTokenId != null && egoPartners
  ? `Focal token <strong>${classedChr16.find((r) => r.token_id === pickedTokenId)?.region ?? pickedTokenId}</strong> is active in ${Number(egoPartners.n_files_active).toLocaleString()} ${cooccurContext === "all" ? "files" : cooccurContext + " files"}. Showing its top ${egoPartners.partner_token_ids.length} Jaccard partners.`
  : ""}
</div>

<details>
<summary style="cursor: pointer; color: #555;">Why per-context contrast?</summary>
<div style="margin-top: 0.5em; color: #555;">
Switch the context selector across <code>K562</code> / <code>GM12878</code> / <code>HepG2</code>: a region's cooccurrence neighbors usually shift, sometimes dramatically. That shift is exactly what cell-type-specific regulatory models (Atacformer-style) capture and what context-blind models (vanilla R2V) collapse — Jaccard partners that are stable across contexts vs. those that aren't tell you which regions have universal grammar and which have cell-type-specific grammar.
</div>
</details>
