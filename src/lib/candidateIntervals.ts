// Hand-curated candidate hub intervals from the Observable canvas page.
// These don't live in featured_intervals.parquet — they were defined as JS
// configs in canvas.md. Combined with the parquet-loaded reference intervals
// at the picker level. Adding them to the pipeline is a future cleanup.

import type { FeaturedInterval } from './types';

export type CandidateInterval = FeaturedInterval & {
  source: 'parquet' | 'inline';
  note?: string;
};

export const HUB_CANDIDATES: CandidateInterval[] = [
  {
    interval_id: 'hub_21_4_to_29',
    chrom: 'chr16',
    start: 21_350_000,
    end: 21_370_000,
    label: '21.4 Mb dELS hub → 16p11.2',
    narrative_caption:
      'All-dELS anchor near CRYM. 16p11.2 (≈8 Mb away) is a well-studied long-range regulatory hub.',
    n_universe_tokens: 0, // populated at runtime if used
    source: 'inline',
  },
  {
    interval_id: 'hub_88_2_to_29',
    chrom: 'chr16',
    start: 88_230_000,
    end: 88_250_000,
    label: '88.2 Mb (16q24.3) → 16p11.2 (58.7 Mb cross-arm)',
    narrative_caption:
      'ZNF469 / GALNS area. Same 16p11.2 target as 21.4 Mb hub but 58.7 Mb away.',
    n_universe_tokens: 0,
    source: 'inline',
  },
  {
    interval_id: 'hub_15_1_to_2',
    chrom: 'chr16',
    start: 15_130_000,
    end: 15_150_000,
    label: '15.1 Mb dELS → 16p13.3 hub (12.6 Mb)',
    narrative_caption:
      'Strongest concentration in the scan (45%), but anchor sits in NPIP segdup family — possible mapping confound.',
    n_universe_tokens: 0,
    source: 'inline',
  },
];
