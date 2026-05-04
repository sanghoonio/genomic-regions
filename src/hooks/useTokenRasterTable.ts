// Materializes a flat (row_idx, pos, cclass) view that vgplot's raster
// mark can pixel-bin. row_idx ranks files by the supplied sort field
// (matches whichever the FileUMAP legend is colored by) so ordered file
// "tracks" appear in the y direction. Recreated whenever the file pool
// or sort field changes.
//
// row_idx is a continuous numeric so vgplot's raster auto-bins multiple
// files into one pixel row (with ~16k files and ~400 px height, that's
// ~40 files per row). Detail re-emerges as the user zooms.

import { useEffect, useRef, useState } from 'react';
import { useMosaicCoordinator } from './useMosaicCoordinator';
import { TABLE } from '../lib/duckdb';

const RASTER_TABLE_BASE = 'dict_token_raster';

function escapeId(id: string): string {
  return `'${id.replace(/'/g, "''")}'`;
}

export type RasterSortBy = 'assay' | 'cell_line';

export function useTokenRasterTable(
  customFileIds: ReadonlyArray<string> | null | undefined,
  sortBy: RasterSortBy,
): {
  tableName: string | null;
  version: string | null;
  rowCount: number | null;
  loading: boolean;
  error: string | null;
} {
  const { coordinator, isReady } = useMosaicCoordinator();
  // Versioned table-name strategy: each rebuild materialises a new
  // table (suffixed with a counter) and drops the previous one. This
  // sidesteps the Mosaic Coordinator's query-result cache without ever
  // calling `coordinator.clear()` — that would unconditionally abort
  // every other in-flight query (UMAP point loads etc.) on the same
  // coordinator with a "Cleared" rejection.
  const counterRef = useRef(0);
  const previousTableRef = useRef<string | null>(null);
  const [state, setState] = useState<{
    tableName: string | null;
    version: string | null;
    rowCount: number | null;
    loading: boolean;
    error: string | null;
  }>({
    tableName: null,
    version: null,
    rowCount: null,
    loading: false,
    error: null,
  });

  // Stable cache key.
  const filterKey =
    customFileIds && customFileIds.length > 0
      ? `${customFileIds.length}:${[...customFileIds].sort().join(',')}`
      : 'all';
  const cacheKey = `${sortBy}:${filterKey}`;

  useEffect(() => {
    if (!isReady) return;
    const filterClause =
      customFileIds && customFileIds.length > 0
        ? `WHERE f.id IN (${customFileIds.map(escapeId).join(',')})`
        : '';
    counterRef.current += 1;
    const versionedTable = `${RASTER_TABLE_BASE}_${counterRef.current}`;
    const previousTable = previousTableRef.current;
    const sql = `CREATE OR REPLACE TABLE ${versionedTable} AS
      WITH ranked AS (
        SELECT f.id,
               (DENSE_RANK() OVER (
                  ORDER BY f.${sortBy} NULLS LAST, f.id
                ) - 1)::INTEGER AS row_idx
        FROM ${TABLE.filesCategorized} f
        ${filterClause}
      )
      SELECT
        r.row_idx,
        ((reg.start + reg."end") / 2)::INTEGER AS pos,
        reg.cclass
      FROM ${TABLE.tokenizedCorpus} t
      JOIN ranked r ON r.id = t.id
      CROSS JOIN UNNEST(t.chr16_active_token_ids) AS u(token_id)
      JOIN ${TABLE.regionsClassed} reg ON reg.token_id = u.token_id`;

    let cancelled = false;
    // Same fetch-pattern suppression as useEnrichmentTable — we manage an
    // external resource (the rebuilt DuckDB table) and need to flip
    // loading immediately so consumers can render a spinner.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((prev) => ({ ...prev, loading: true, error: null }));
    coordinator
      .exec(sql)
      .then(async () => {
        if (cancelled) return;
        previousTableRef.current = versionedTable;
        if (previousTable) {
          coordinator
            .exec(`DROP TABLE IF EXISTS ${previousTable}`)
            .catch(() => {
              /* ignored — best-effort cleanup */
            });
        }
        const rows = (await coordinator.query(
          `SELECT MAX(row_idx) + 1 AS n FROM ${versionedTable}`,
          { type: 'json' },
        )) as Array<{ n: number | null }>;
        if (cancelled) return;
        setState({
          tableName: versionedTable,
          version: cacheKey,
          rowCount: rows.length > 0 ? Number(rows[0].n ?? 0) : 0,
          loading: false,
          error: null,
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setState({
          tableName: null,
          version: null,
          rowCount: null,
          loading: false,
          error: msg,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [coordinator, isReady, cacheKey, customFileIds, sortBy]);

  return state;
}
