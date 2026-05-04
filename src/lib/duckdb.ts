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
  conceptAxes: 'dict_concept_axes',
  targetEvidence: 'dict_target_evidence',
  regionsClassed: 'dict_regions_classed',
  filesCategorized: 'dict_files_categorized',
} as const;

export type TableName = (typeof TABLE)[keyof typeof TABLE];

// Parquet files live under /data/dictionary served by Vite's public dir.
// DuckDB-WASM's read_parquet() needs an absolute HTTP URL — root-relative
// paths fail with "No files found that match the pattern" because DuckDB
// interprets them as local-disk paths inside its WASM virtual FS.
const origin = typeof window === 'undefined' ? '' : window.location.origin;
const DATA_PREFIX = `${origin}/data/dictionary`;

export const PARQUET_URLS: Record<keyof typeof TABLE, string | null> = {
  regions: `${DATA_PREFIX}/viz_chr16.parquet`,
  files: `${DATA_PREFIX}/viz_files.parquet`,
  manifest: `${DATA_PREFIX}/manifest.parquet`,
  intervals: `${DATA_PREFIX}/featured_intervals.parquet`,
  featuredFiles: `${DATA_PREFIX}/featured_files.parquet`,
  tracks: `${DATA_PREFIX}/featured_tracks.parquet`,
  tokenizedCorpus: `${DATA_PREFIX}/tokenized_corpus_chr16.parquet`,
  featuredSignal: `${DATA_PREFIX}/featured_signal.parquet`,
  conceptAxes: `${DATA_PREFIX}/region_concept_axes.parquet`,
  targetEvidence: `${DATA_PREFIX}/region_target_evidence.parquet`,
  regionsClassed: null, // VIEW only — created from regions, no parquet source
  filesCategorized: null, // VIEW only — created from files, no parquet source
};
