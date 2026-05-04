// SCREEN class color palette + integer category mapping for embedding-atlas.
// EmbeddingViewMosaic requires `category` to be a 0-indexed integer, so we
// also expose the canonical class→integer encoding used by the view.

export const SCREEN_CLASS_COLORS: Record<string, string> = {
  PLS: '#ff0000',
  pELS: '#ffa700',
  dELS: '#ffcd00',
  'CA-CTCF': '#00b0f0',
  'CA-H3K4me3': '#ffaaaa',
  unclassed: '#cccccc',
};

// Order is the canonical category index used in DuckDB views and passed to
// EmbeddingViewMosaic's categoryColors prop.
export const SCREEN_CLASS_ORDER: string[] = [
  'PLS',
  'pELS',
  'dELS',
  'CA-CTCF',
  'CA-H3K4me3',
  'unclassed',
];

export const SCREEN_CLASS_INDEX: Record<string, number> = Object.fromEntries(
  SCREEN_CLASS_ORDER.map((c, i) => [c, i]),
);

export const SCREEN_CLASS_COLOR_RANGE: string[] = SCREEN_CLASS_ORDER.map(
  (c) => SCREEN_CLASS_COLORS[c],
);

export function classColor(c: string | null | undefined): string {
  return c && SCREEN_CLASS_COLORS[c] ? SCREEN_CLASS_COLORS[c] : SCREEN_CLASS_COLORS.unclassed;
}

// SQL expression mapping cclass → 0-indexed integer for EmbeddingViewMosaic.
// Mirrors SCREEN_CLASS_ORDER.
export const SCREEN_CLASS_CATEGORY_SQL = `CASE
  WHEN cclass = 'PLS' THEN 0
  WHEN cclass = 'pELS' THEN 1
  WHEN cclass = 'dELS' THEN 2
  WHEN cclass = 'CA-CTCF' THEN 3
  WHEN cclass = 'CA-H3K4me3' THEN 4
  ELSE 5
END`;

export const ASSAY_COLORS: Record<string, string> = {
  'ATAC-seq': '#1f77b4',
  'DNase-seq': '#2ca02c',
  'ChIP-seq': '#9467bd',
  'TF ChIP-seq': '#e377c2',
  'Histone ChIP-seq': '#ff7f0e',
};

export const ASSAY_ORDER: string[] = Object.keys(ASSAY_COLORS);
export const ASSAY_COLOR_RANGE: string[] = ASSAY_ORDER.map((a) => ASSAY_COLORS[a]);

// SQL expression mapping assay → 0-indexed integer for EmbeddingViewMosaic.
// Mirrors ASSAY_ORDER. Trailing index = "unknown" bucket.
export const ASSAY_CATEGORY_SQL = `CASE
  WHEN assay = 'ATAC-seq' THEN 0
  WHEN assay = 'DNase-seq' THEN 1
  WHEN assay = 'ChIP-seq' THEN 2
  WHEN assay = 'TF ChIP-seq' THEN 3
  WHEN assay = 'Histone ChIP-seq' THEN 4
  ELSE 5
END`;

export const ASSAY_COLOR_RANGE_WITH_UNKNOWN: string[] = [
  ...ASSAY_COLOR_RANGE,
  '#cccccc',
];

export function assayColor(a: string | null | undefined): string {
  return (a && ASSAY_COLORS[a]) || '#888';
}
