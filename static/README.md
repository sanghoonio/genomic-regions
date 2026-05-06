# Static visualization

A single-page D3 figure that strips the dashboard down to one anchor
(CDH1 / E-cadherin promoter, chr16:68,737,071–68,737,417, PLS) and
shows its top 30 NPMI co-occurrence partners on two coordinate
systems at once:

- **UMAP panel (top)** — the chr16 region embedding, with the picked
  anchor and its 30 partners highlighted on top of a downsampled
  background cloud.
- **Chromosome panels (bottom)** — chr16 at three zoom levels (full
  chromosome, 2 Mb window, 20 kb window), each rendering the same
  partners as colored lollipops whose height encodes NPMI score.
- **Bezier connectors** between the UMAP and the full-chr16 panel link
  each partner across the two coordinate systems, exposing the
  embedding ↔ genome discordance.
- **Zoom indicators** between the chromosome tracks (UCSC-style
  diagonal connectors) show how each window relates to its parent.

## Layout

```
static/
├── README.md          ← you are here
├── prepare_data.sql   ← duckdb script that bakes static/data/cdh1.{js,json}
├── data/
│   ├── cdh1.js        ← JS shim setting window.STATIC_DATA (file://-friendly)
│   └── cdh1.json      ← parallel JSON dump for inspection
├── index.html         ← deliverable page (open in any browser)
├── static.js          ← d3 render (loads d3 from jsdelivr CDN)
└── style.css
```

## Regenerating the data

The dashboard's parquets live in `genomic-dict/data/precomputed/` in
the sibling `spatial-region-features` repo. To rebuild the JSON, run
from the genomic-regions repo root:

```
duckdb -c ".read static/prepare_data.sql"
```

The script's `PARQUET_DIR` variable is set to the local absolute path;
edit the `SET VARIABLE PARQUET_DIR = ...` line if your checkout lives
elsewhere. The same script can be repointed at a different anchor
token by editing `ANCHOR_TOKEN` (and recapturing with a new output
filename).

## Viewing

Just open `static/index.html` in a browser — no build step. The page
fetches `data/hba1.json` from the same directory, so a simple
`python -m http.server` (or `npx serve static`) is enough if your
browser blocks `file://` fetches.

## Why CDH1?

Among the seven featured intervals CDH1 (`cdh1_promoter`) carries the
richest single-anchor story:

- **20 of 30 partners are pELS** (proximal enhancers) and **9 are
  PLS** (other promoters) — the dictionary surfaces an active
  promoter together with its enhancer landscape, not a single class.
- **Three pELS partners sit within 1 kb of CDH1's TSS** (rank 1, 4,
  9) — the actual cis regulatory module of the gene, recovered from
  co-occurrence with no positional input.
- **Rank 5 is CDH3 / P-cadherin** (chr16:68,645 k, PLS), CDH1's
  paralog 92 kb upstream — the embedding places it at UMAP distance
  0.14 from CDH1.
- **A distal hub at chr16:71.6 Mb** (rank 2/3/6/7/14, ~3 Mb away)
  shows that NPMI captures functional partnership, not linear
  proximity. Rank 8 (a PLS 15 Mb away) is also UMAP-tight (distance
  0.08) — far on the chromosome, neighbors in the dictionary.

The earlier draft anchored on HBA1 (alpha-globin), which produced a
striking but one-note story (27/30 PLS, all distal). Switching to
CDH1 lets the same figure carry three concentric layers of biology
(cis enhancers, paralog, distal hub) without changing any of the
machinery.

See the `narrative_caption` field of `featured_intervals.parquet` for
the curated bio context shipped with each anchor.
