// Featured-signal (bigwig) and featured-tracks (BED peaks) per interval.
// Both parquets are scoped to the 4 named featured intervals — hub
// candidates have no rows. UNNEST flattens the per-(file, interval) list
// columns into per-(file, position) and per-(file, peak) rows in DuckDB,
// avoiding shipping the whole list shape to JS.

import { useMemo } from 'react';
import { useSqlQuery } from './useSqlQuery';
import { TABLE } from '../lib/duckdb';

export type SignalRow = {
  file_id: string;
  file_label: string;
  assay: string;
  position: number;
  value: number;
};

export type PeakRow = {
  file_id: string;
  file_label: string;
  assay: string;
  peak_start: number;
  peak_end: number;
};

type RawSignal = {
  file_id: string;
  cell_line: string;
  assay: string;
  target: string | null;
  position: number;
  value: number;
};

type RawPeak = {
  file_id: string;
  cell_line: string;
  assay: string;
  target: string | null;
  peak_start: number;
  peak_end: number;
};

function fileLabelFromRow(r: { cell_line: string; assay: string; target: string | null }) {
  if (r.assay === 'ATAC-seq') return `${r.cell_line} · ATAC-seq`;
  if (r.target) return `${r.cell_line} · ${r.target}`;
  return `${r.cell_line} · ${r.assay}`;
}

export function useIntervalSignal(intervalId: string | null): {
  rows: SignalRow[] | null;
  loading: boolean;
  error: string | null;
} {
  const sql = intervalId
    ? `SELECT s.file_id, ff.cell_line, ff.assay, ff.target,
              UNNEST(s.positions) AS position,
              UNNEST(s.values) AS value
       FROM ${TABLE.featuredSignal} s
       JOIN ${TABLE.featuredFiles} ff ON ff.file_id = s.file_id
       WHERE s.interval_id = '${intervalId}'`
    : null;

  const { rows, loading, error } = useSqlQuery<RawSignal>(sql, [intervalId]);

  const out = useMemo<SignalRow[] | null>(() => {
    if (!rows) return null;
    return rows.map((r) => ({
      file_id: r.file_id,
      file_label: fileLabelFromRow(r),
      assay: r.assay,
      position: Number(r.position),
      value: Number.isFinite(Number(r.value)) ? Number(r.value) : 0,
    }));
  }, [rows]);

  return { rows: out, loading, error };
}

export function useIntervalTracks(intervalId: string | null): {
  rows: PeakRow[] | null;
  loading: boolean;
  error: string | null;
} {
  const sql = intervalId
    ? `SELECT t.file_id, ff.cell_line, ff.assay, ff.target,
              UNNEST(t.peak_starts) AS peak_start,
              UNNEST(t.peak_ends) AS peak_end
       FROM ${TABLE.tracks} t
       JOIN ${TABLE.featuredFiles} ff ON ff.file_id = t.file_id
       WHERE t.interval_id = '${intervalId}'`
    : null;

  const { rows, loading, error } = useSqlQuery<RawPeak>(sql, [intervalId]);

  const out = useMemo<PeakRow[] | null>(() => {
    if (!rows) return null;
    return rows.map((r) => ({
      file_id: r.file_id,
      file_label: fileLabelFromRow(r),
      assay: r.assay,
      peak_start: Number(r.peak_start),
      peak_end: Number(r.peak_end),
    }));
  }, [rows]);

  return { rows: out, loading, error };
}
