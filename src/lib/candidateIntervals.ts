// Shared shape for picker entries. The actual list of intervals lives
// in featured_intervals.parquet — see useFeaturedIntervals. The hub
// definitions previously hard-coded here have been moved into the
// genomic-dict pipeline (config.yaml → stage 08).

import type { FeaturedInterval } from './types';

export type CandidateInterval = FeaturedInterval & {
  source: 'parquet' | 'inline';
  note?: string;
};
