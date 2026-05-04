// Resolve the active legend pins (per field) into a list of file ids.
// Pins are AND'd across fields: pinning K562 (cell_line) + ATAC-seq (assay)
// returns files matching both. The "Other" cell-line pin maps to
// cell_line NOT IN (top 6).
//
// Returns null when no pins are set, signalling to callers that the full
// corpus should be used.

import { useMemo } from 'react';
import { useSqlQuery } from './useSqlQuery';
import { TABLE } from '../lib/duckdb';

function escape(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export function useFilteredFileIds(
  pinnedAssays: ReadonlySet<string>,
  pinnedCellLines: ReadonlySet<string>,
): { ids: string[] | null; loading: boolean; error: string | null } {
  // Hash-able cache key for memo / SQL stability.
  const assayKey = useMemo(
    () => [...pinnedAssays].sort().join(','),
    [pinnedAssays],
  );
  const cellLineKey = useMemo(
    () => [...pinnedCellLines].sort().join(','),
    [pinnedCellLines],
  );

  const sql = useMemo(() => {
    const filters: string[] = [];
    if (pinnedAssays.size > 0) {
      filters.push(
        `assay IN (${[...pinnedAssays].map(escape).join(',')})`,
      );
    }
    if (pinnedCellLines.size > 0) {
      const otherPinned = pinnedCellLines.has('Other');
      const named = [...pinnedCellLines].filter((c) => c !== 'Other');
      const namedClause =
        named.length > 0
          ? `cell_line IN (${named.map(escape).join(',')})`
          : null;
      // "Other" = cell_line_cat = 6 (the bucket index assigned in
      // MosaicCoordinatorProvider for everything outside the top 6).
      const otherClause = otherPinned ? 'cell_line_cat = 6' : null;
      const parts = [namedClause, otherClause].filter(Boolean) as string[];
      if (parts.length > 0) {
        filters.push(parts.length === 1 ? parts[0] : `(${parts.join(' OR ')})`);
      }
    }
    if (filters.length === 0) return null;
    return `SELECT id FROM ${TABLE.filesCategorized} WHERE ${filters.join(' AND ')}`;
  }, [pinnedAssays, pinnedCellLines]);

  const { rows, loading, error } = useSqlQuery<{ id: string }>(sql, [
    assayKey,
    cellLineKey,
  ]);

  const ids = useMemo(() => {
    if (sql == null) return null;
    if (!rows) return null;
    return rows.map((r) => r.id);
  }, [rows, sql]);

  return { ids, loading, error };
}
