// Computes Section 1 data for the picked interval:
//   - intervalRegions: universe regions overlapping the interval, with class
//   - activations: per-(file × token) rows where the file's chr16_active set
//                  intersects the interval's universe set.
// Both come from a single DuckDB query so we avoid materializing the full
// 36k chr16 universe to JS just to filter ~30 of them.

import { useMemo } from 'react';
import { useSqlQuery } from './useSqlQuery';
import { TABLE } from '../lib/duckdb';
import type { CandidateInterval } from '../lib/candidateIntervals';
import type { FeaturedFile } from '../lib/types';
import { fileLabel } from './useFeaturedFiles';

export type IntervalRegionRow = {
  token_id: number;
  region: string;
  start: number;
  end: number;
  cclass: string;
  umap_x: number;
  umap_y: number;
};

export type IntervalActivationRow = {
  file_id: string;
  file_label: string;
  token_id: number;
  start: number;
  end: number;
  cclass: string;
};

export function useIntervalRegions(interval: CandidateInterval | null): {
  regions: IntervalRegionRow[] | null;
  loading: boolean;
  error: string | null;
} {
  const sql = interval
    ? `SELECT token_id, region, start, "end" AS end,
              COALESCE(cclass, 'unclassed') AS cclass,
              umap_x, umap_y
       FROM ${TABLE.regions}
       WHERE chrom = '${interval.chrom}'
         AND start < ${interval.end}
         AND "end" > ${interval.start}
       ORDER BY start`
    : null;

  const { rows, loading, error } = useSqlQuery<{
    token_id: number;
    region: string;
    start: number;
    end: number;
    cclass: string;
    umap_x: number;
    umap_y: number;
  }>(sql, [interval?.interval_id]);

  const regions = useMemo<IntervalRegionRow[] | null>(() => {
    if (!rows) return null;
    return rows.map((r) => ({
      token_id: Number(r.token_id),
      region: r.region,
      start: Number(r.start),
      end: Number(r.end),
      cclass: r.cclass,
      umap_x: Number(r.umap_x),
      umap_y: Number(r.umap_y),
    }));
  }, [rows]);

  return { regions, loading, error };
}

// Pure JS intersection: each featured file's chr16_active_token_ids ∩ the
// interval's universe set. Cheap because the interval has ~5-30 tokens.
export function intervalActivations(
  intervalRegions: IntervalRegionRow[] | null,
  files: FeaturedFile[] | null,
): IntervalActivationRow[] | null {
  if (!intervalRegions || !files) return null;
  const tokenById = new Map(intervalRegions.map((r) => [r.token_id, r]));
  const activeSet = new Set(intervalRegions.map((r) => r.token_id));
  const out: IntervalActivationRow[] = [];
  for (const f of files) {
    if (!f.chr16_active_token_ids) continue;
    const label = fileLabel(f);
    for (const tid of f.chr16_active_token_ids) {
      if (!activeSet.has(tid)) continue;
      const r = tokenById.get(tid)!;
      out.push({
        file_id: f.file_id,
        file_label: label,
        token_id: tid,
        start: r.start,
        end: r.end,
        cclass: r.cclass,
      });
    }
  }
  return out;
}
