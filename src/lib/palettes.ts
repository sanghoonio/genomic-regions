// Color palettes for UMAP categories and continuous scales.
//
// TABLEAU20 — D3's tableau category palette, 20 distinguishable hues. Used
// for high-cardinality categorical fields (cell_line, tissue, cell_type)
// where we color via DENSE_RANK indices.
//
// DIVERGING_PUOR — purple-orange diverging gradient (11 stops). Used for
// enrichment scores where positive = enriched-in-selection (orange) and
// negative = depleted (purple).

export const TABLEAU20: string[] = [
  '#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F',
  '#EDC948', '#B07AA1', '#FF9DA7', '#9C755F', '#BAB0AC',
  '#A0CBE8', '#FFBE7D', '#FF9D9A', '#8CD17D', '#B6992D',
  '#86BCB6', '#F1CE63', '#D4A6C8', '#D7B5A6', '#79706E',
];

// Bin 0 = lowest score (most depleted in selection) → purple.
// Bin 10 = highest score (most enriched in selection) → orange.
export const DIVERGING_PUOR: string[] = [
  '#2D004B', '#542788', '#8073AC', '#B2ABD2', '#D8DAEB',
  '#F7F7F7',
  '#FEE0B6', '#FDB863', '#E08214', '#B35806', '#7F3B08',
];

export const ENRICHMENT_BINS = DIVERGING_PUOR.length; // 11
