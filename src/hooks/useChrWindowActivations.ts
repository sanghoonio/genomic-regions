// Per-file token activations within a chr16 window — universe regions
// in the range plus, for every file in the pool that has at least one
// activation in the window, the (file_id, token_id, start, end, cclass)
// rows. Used by the chr16 distribution tracks' window-context view.

import { useMemo } from 'react';
import { useSqlQuery } from './useSqlQuery';
import { TABLE } from '../lib/duckdb';

function escapeId(id: string): string {
  return `'${id.replace(/'/g, "''")}'`;
}

export type WindowUniverseRow = {
  token_id: number;
  region: string;
  start: number;
  end: number;
  cclass: string | null;
};

export type WindowActivationRow = {
  file_id: string;
  cell_line: string;
  assay: string;
  target: string;
  token_id: number;
  region: string;
  start: number;
  end: number;
  cclass: string | null;
  n_in_window: number;
};

export type FileGroup = {
  file_id: string;
  label: string;
  cell_line: string;
  assay: string;
  target: string;
  n_in_window: number;
  activations: WindowActivationRow[];
};

export function useChrWindowActivations(
  range: [number, number] | null,
  customFileIds?: ReadonlyArray<string> | null,
): {
  universe: WindowUniverseRow[] | null;
  files: FileGroup[] | null;
  totalFiles: number;
  loading: boolean;
  error: string | null;
} {
  // Universe regions in the window. Always queried when range is set.
  const universeSql = useMemo(() => {
    if (!range) return null;
    const [lo, hi] = range;
    return `SELECT token_id, region, start, "end" AS end,
                   COALESCE(cclass, 'unclassed') AS cclass
            FROM ${TABLE.regions}
            WHERE chrom = 'chr16' AND start <= ${hi} AND "end" >= ${lo}
            ORDER BY start`;
  }, [range]);

  const { rows: universeRows, loading: universeLoading, error: universeError } =
    useSqlQuery<WindowUniverseRow>(universeSql, [range]);

  // Per-file activations in the window — flattened from
  // dict_tokenized_corpus then JOIN'd with the universe-token slice.
  // Pool is either the full corpus (no WHERE) or a custom id list.
  const activationsSql = useMemo(() => {
    if (!range) return null;
    const [lo, hi] = range;
    const filter =
      customFileIds && customFileIds.length > 0
        ? `WHERE t.id IN (${customFileIds.map(escapeId).join(',')})`
        : '';
    return `WITH window_tokens AS (
              SELECT token_id, region, start, "end" AS end,
                     COALESCE(cclass, 'unclassed') AS cclass
              FROM ${TABLE.regions}
              WHERE chrom = 'chr16'
                AND start <= ${hi} AND "end" >= ${lo}
            ),
            sub AS (
              SELECT t.id AS file_id, UNNEST(t.chr16_active_token_ids) AS token_id
              FROM ${TABLE.tokenizedCorpus} t ${filter}
            ),
            activations AS (
              SELECT s.file_id, w.token_id, w.region, w.start, w.end, w.cclass
              FROM sub s
              INNER JOIN window_tokens w USING (token_id)
            )
            SELECT a.file_id,
                   COALESCE(f.cell_line, '?') AS cell_line,
                   COALESCE(f.assay, '?') AS assay,
                   COALESCE(m.target, '') AS target,
                   a.token_id, a.region, a.start, a.end, a.cclass,
                   COUNT(*) OVER (PARTITION BY a.file_id) AS n_in_window
            FROM activations a
            LEFT JOIN ${TABLE.files} f ON f.id = a.file_id
            LEFT JOIN ${TABLE.manifest} m ON m.id = a.file_id
            ORDER BY n_in_window DESC, a.file_id, a.start`;
  }, [range, customFileIds]);

  const { rows: rawRows, loading: rowsLoading, error: rowsError } =
    useSqlQuery<WindowActivationRow>(activationsSql, [range, customFileIds]);

  // Group rows by file_id (rows are pre-sorted by n_in_window desc, so
  // the resulting array is already in that order).
  const files = useMemo<FileGroup[] | null>(() => {
    if (!rawRows) return null;
    const groups = new Map<string, FileGroup>();
    for (const r of rawRows) {
      let g = groups.get(r.file_id);
      if (!g) {
        const labelSuffix = r.target ? `${r.target}` : r.assay;
        g = {
          file_id: r.file_id,
          label: `${r.cell_line} · ${labelSuffix}`,
          cell_line: r.cell_line,
          assay: r.assay,
          target: r.target,
          n_in_window: Number(r.n_in_window),
          activations: [],
        };
        groups.set(r.file_id, g);
      }
      g.activations.push({
        ...r,
        token_id: Number(r.token_id),
        start: Number(r.start),
        end: Number(r.end),
        n_in_window: Number(r.n_in_window),
      });
    }
    return Array.from(groups.values());
  }, [rawRows]);

  const universe = useMemo(() => {
    if (!universeRows) return null;
    return universeRows.map((r) => ({
      ...r,
      token_id: Number(r.token_id),
      start: Number(r.start),
      end: Number(r.end),
    }));
  }, [universeRows]);

  return {
    universe,
    files,
    totalFiles: files?.length ?? 0,
    loading: universeLoading || rowsLoading,
    error: universeError || rowsError,
  };
}
