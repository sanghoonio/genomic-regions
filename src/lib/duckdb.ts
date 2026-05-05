// Table-name registry + parquet URL resolution. Single source of truth so
// SQL strings can reference TABLE.regions without fishing for table names,
// and so adding/renaming a parquet only touches this file.
//
// Post-strip set (2026-04-29): cooc, marginals, modules, prototypes,
// region_stats, target_summary parquets are no longer shipped — replaced by
// on-demand DuckDB-WASM queries against tokenized_corpus + manifest.

export const TABLE = {
  regions: 'dict_regions',
  files: 'dict_files',
  manifest: 'dict_manifest',
  intervals: 'dict_featured_intervals',
  featuredFiles: 'dict_featured_files',
  tracks: 'dict_featured_tracks',
  tokenizedCorpus: 'dict_tokenized_corpus',
  featuredSignal: 'dict_featured_signal',
  regionsClassed: 'dict_regions_classed',
  filesCategorized: 'dict_files_categorized',
} as const;

export type TableName = (typeof TABLE)[keyof typeof TABLE];

// Parquets live in the sanghoonio/genomic-regions HuggingFace dataset.
// Pinned to a specific commit so app code and data versions stay in
// lockstep — bump this SHA when you push new parquets to HF.
//
// HF's resolve endpoint 302-redirects to the xethub CDN, which honors
// HTTP range requests (DuckDB-WASM relies on those for partial parquet
// reads) and serves permissive CORS.
const HF_REPO = 'sanghoonio/genomic-regions';
const HF_REVISION = '589db79cf6911c58a790ad68c38c02478f5bf0c4';
const DATA_PREFIX = `https://huggingface.co/datasets/${HF_REPO}/resolve/${HF_REVISION}`;

export const PARQUET_URLS: Record<keyof typeof TABLE, string | null> = {
  regions: `${DATA_PREFIX}/viz_chr16.parquet`,
  files: `${DATA_PREFIX}/viz_files.parquet`,
  manifest: `${DATA_PREFIX}/manifest.parquet`,
  intervals: `${DATA_PREFIX}/featured_intervals.parquet`,
  featuredFiles: `${DATA_PREFIX}/featured_files.parquet`,
  tracks: `${DATA_PREFIX}/featured_tracks.parquet`,
  tokenizedCorpus: `${DATA_PREFIX}/tokenized_corpus_chr16.parquet`,
  featuredSignal: `${DATA_PREFIX}/featured_signal.parquet`,
  regionsClassed: null, // VIEW only — created from regions, no parquet source
  filesCategorized: null, // VIEW only — created from files, no parquet source
};
