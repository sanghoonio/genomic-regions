// All featured intervals (reference + hub candidates) now live in
// featured_intervals.parquet, produced by stage 08 of the genomic-dict
// pipeline. The picker reads them ordered by start position.

import { useMemo } from 'react';
import { useSqlQuery } from './useSqlQuery';
import { TABLE } from '../lib/duckdb';
import type { CandidateInterval } from '../lib/candidateIntervals';

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
    return (rows ?? []).map((r) => ({
      interval_id: r.interval_id,
      chrom: r.chrom,
      start: Number(r.start),
      end: Number(r.end),
      label: r.label,
      narrative_caption: r.narrative_caption,
      n_universe_tokens: Number(r.n_universe_tokens),
      source: 'parquet',
    }));
  }, [rows]);

  return { intervals, loading, error };
}

export type { CandidateInterval as IntervalOption } from '../lib/candidateIntervals';
