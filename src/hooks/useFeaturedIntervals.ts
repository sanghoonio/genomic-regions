// Combine the 4 reference intervals from featured_intervals.parquet with
// the 3 inline hub candidates into one ordered list for the picker.

import { useMemo } from 'react';
import { useSqlQuery } from './useSqlQuery';
import { TABLE } from '../lib/duckdb';
import { HUB_CANDIDATES, type CandidateInterval } from '../lib/candidateIntervals';

type ParquetRow = {
  interval_id: string;
  chrom: string;
  start: number;
  end: number;
  label: string;
  narrative_caption: string | null;
  n_universe_tokens: number;
};

export function useFeaturedIntervals(): {
  intervals: CandidateInterval[];
  loading: boolean;
  error: string | null;
} {
  const { rows, loading, error } = useSqlQuery<ParquetRow>(
    `SELECT interval_id, chrom, start, "end" AS end, label, narrative_caption,
            n_universe_tokens
     FROM ${TABLE.intervals}
     ORDER BY start`,
  );

  const intervals = useMemo<CandidateInterval[]>(() => {
    const parquet: CandidateInterval[] = (rows ?? []).map((r) => ({
      interval_id: r.interval_id,
      chrom: r.chrom,
      start: Number(r.start),
      end: Number(r.end),
      label: r.label,
      narrative_caption: r.narrative_caption,
      n_universe_tokens: Number(r.n_universe_tokens),
      source: 'parquet',
    }));
    return [...parquet, ...HUB_CANDIDATES];
  }, [rows]);

  return { intervals, loading, error };
}

export type { CandidateInterval as IntervalOption } from '../lib/candidateIntervals';
