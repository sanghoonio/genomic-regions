# A Dictionary of Regulatory Genomics

An interactive web interface for exploring relationships between
regulatory regions of the human genome through Region2Vec embeddings
and BED-file co-occurrence statistics. Built with React + Vite +
DuckDB-WASM, all queries run client-side against parquet files served
from a HuggingFace dataset.

## What it does

A Word2Vec-style model called **Region2Vec** learns each chr16 region's
embedding from the tokens it co-occurs with across an ENCODE BED corpus.
A single experiment (one BED file) is then represented as the mean of
its tokens' embeddings. The app surfaces this in four linked panels:

- **File UMAP** — each BED file as the mean-pooled embedding of its
  active tokens, colored by assay or cell line.
- **Region UMAP** — each region's Region2Vec embedding, colored by
  SCREEN class or by enrichment in a chosen file selection.
- **Chromosome distribution** — three stacked histograms (full chr16,
  2 Mb, 20 kb) showing where regions and their NPMI co-occurrence
  partners sit along the chromosome. The deepest zoom renders
  individual tokens at their actual coords. The 2 Mb and 20 kb windows
  are draggable.
- **Dictionary entry** — the picked region's top NPMI partners shown as
  a fudoki-inspired chip strip, ordered by genomic position with the
  picked region as the natural midpoint. Width encodes NPMI rank;
  click any chip to pan the chromosome distribution + region UMAP to
  that region.

The two main user flows:

1. Pick a region (UMAP click, dictionary chip click, or section 1
   token click) to inspect its co-occurrence neighborhood, both
   semantically (region UMAP highlights) and spatially (chromosome
   distribution histograms).
2. Brush or pin files in the file UMAP to define a custom corpus pool,
   then color the region UMAP by enrichment in that pool to see which
   regulatory regions are characteristic of which kinds of experiments.

## Data

Parquet files live in the
[`sanghoonio/genomic-regions`](https://huggingface.co/datasets/sanghoonio/genomic-regions)
HuggingFace dataset. The app pins to a specific commit SHA in
`src/lib/duckdb.ts` so the data and code stay in lockstep — bump that
SHA when new parquets are pushed to HF. All fetches happen
client-side via DuckDB-WASM with HTTP range requests; nothing is
proxied through a backend.

The pipeline that produces the parquets lives in the sibling
[`spatial-region-features`](https://github.com/sanghoonio/spatial-region-features)
repo (`genomic-dict/`) and runs on UVA's Rivanna HPC cluster.

## Running locally

Requires Node 20+ and npm.

```
git clone https://github.com/sanghoonio/genomic-regions.git
cd genomic-regions
npm install
npm run dev
```

The dev server starts on `http://localhost:5173/`. First load fetches
~70 MB of parquets from HuggingFace (cached by the browser thereafter)
and registers them as DuckDB-WASM tables; the app shows a progress
bar during this.

### Other scripts

- `npm run build` — produces a production bundle in `dist/`
- `npm run preview` — serves the production build locally
- `npm run lint` — runs ESLint over the source

## Stack

- React 19 + Vite 7 + TypeScript
- DuckDB-WASM via `@uwdata/vgplot` / `@uwdata/mosaic-core` for client-side SQL
- `embedding-atlas` for the UMAP scatter renderers
- `@observablehq/plot` for Section 1's faceted activity tracks
- pure d3 (`d3-axis` / `d3-scale` / `d3-drag` / `d3-selection`) for the chromosome distribution
- Tailwind v4 + DaisyUI v5 for styling
- Lucide for icons

Author: [sanghoonio](https://github.com/sanghoonio) · advised by
[databio.org](https://databio.org).
