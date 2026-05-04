// Shared row types for parquet-backed data.

export type FeaturedInterval = {
  interval_id: string;
  chrom: string;
  start: number;
  end: number;
  label: string;
  narrative_caption: string | null;
  n_universe_tokens: number;
  // List columns from parquet — present in DuckDB rows but we don't always
  // materialize them in the picker.
  universe_token_ids?: number[] | null;
};

export type FeaturedFile = {
  file_id: string;
  name: string;
  assay: string;
  cell_line: string;
  target: string | null;
  role: string;
  n_chr16_active_tokens: number;
  // List of token_ids active in this file across the chr16 universe.
  // Materialized lazily — most queries scope to the interval first.
  chr16_active_token_ids?: number[] | null;
};

export type RegionRow = {
  token_id: number;
  region: string;
  chrom: string;
  start: number;
  end: number;
  cclass: string | null;
  umap_x: number;
  umap_y: number;
};

export type IntervalRegionRow = {
  token_id: number;
  region: string;
  start: number;
  end: number;
  cclass: string;
};

export type IntervalActivationRow = {
  file_id: string;
  file_label: string;
  token_id: number;
  start: number;
  end: number;
  cclass: string;
};
