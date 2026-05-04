// On-the-fly file-selection enrichment for chr16 tokens.
//
// For each chr16 token T, count files in the selection where T is active
// (n_in) vs files not in the selection where T is active (n_out). Score is
// log-odds with +0.5 smoothing on each cell so small counts don't blow up.
// Then bin into ENRICHMENT_BINS quantile buckets so EmbeddingViewMosaic can
// color-code them via the DIVERGING_PUOR palette.
//
// Materializes a DuckDB table `dict_regions_enriched` (column shape mirrors
// `dict_regions_classed` plus an `enrichment_category` integer in
// [0, ENRICHMENT_BINS)). The table is rebuilt on each selection change.
// Caller supplies a `customFileIds` array; nullish/empty disables the hook.

import { useEffect, useRef, useState } from 'react';
import { useMosaicCoordinator } from './useMosaicCoordinator';
import { TABLE } from '../lib/duckdb';
import { ENRICHMENT_BINS } from '../lib/palettes';

const ENRICHED_TABLE_BASE = 'dict_regions_enriched';

function escapeId(id: string): string {
  return `'${id.replace(/'/g, "''")}'`;
}

export function useEnrichmentTable(
  customFileIds: ReadonlyArray<string> | null | undefined,
): {
  tableName: string | null;
  /** Changes whenever the materialized data changes — use as an
   * EmbeddingViewMosaic `key` so the component remounts and re-reads the
   * underlying TABLE (replacing the same name in place isn't enough). */
  version: string | null;
  loading: boolean;
  error: string | null;
} {
  const { coordinator, isReady } = useMosaicCoordinator();
  // Per-hook counter feeds a versioned table name so each rebuild gets a
  // distinct DuckDB table (and a distinct cache key downstream). This
  // avoids the need to call `coordinator.clear()` to invalidate stale
  // pixel queries — that would abort every other in-flight query on the
  // coordinator (UMAP loads, etc.) and leave them with 0 rows.
  const counterRef = useRef(0);
  const previousTableRef = useRef<string | null>(null);
  const [state, setState] = useState<{
    tableName: string | null;
    version: string | null;
    loading: boolean;
    error: string | null;
  }>({ tableName: null, version: null, loading: false, error: null });

  // Stable cache key — the SQL contains the id list, but stringifying once
  // here keeps the effect deps cheap and dedupes identical selections.
  const cacheKey =
    customFileIds && customFileIds.length > 0
      ? `${customFileIds.length}:${[...customFileIds].sort().join(',')}`
      : null;

  useEffect(() => {
    if (!isReady) return;
    if (!cacheKey || !customFileIds || customFileIds.length === 0) {
      // Reset is the canonical sync-state-with-external-resource pattern
      // — the enrichment table is the external resource we manage. The
      // react-hooks/set-state-in-effect rule flags this generically.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ tableName: null, version: null, loading: false, error: null });
      return;
    }
    const idList = customFileIds.map(escapeId).join(',');
    counterRef.current += 1;
    const versionedTable = `${ENRICHED_TABLE_BASE}_${counterRef.current}`;
    const previousTable = previousTableRef.current;
    const sql = `CREATE OR REPLACE TABLE ${versionedTable} AS
      WITH selection AS (
        SELECT id FROM ${TABLE.tokenizedCorpus} WHERE id IN (${idList})
      ),
      sub AS (
        SELECT t.id,
               (t.id IN (SELECT id FROM selection)) AS in_sel,
               UNNEST(t.chr16_active_token_ids) AS token_id
        FROM ${TABLE.tokenizedCorpus} t
      ),
      totals AS (
        SELECT
          COUNT(DISTINCT t.id) FILTER (WHERE t.id IN (SELECT id FROM selection)) AS N_in,
          COUNT(DISTINCT t.id) FILTER (WHERE t.id NOT IN (SELECT id FROM selection)) AS N_out
        FROM ${TABLE.tokenizedCorpus} t
      ),
      counts AS (
        SELECT token_id,
               COUNT(*) FILTER (WHERE in_sel)::DOUBLE AS n_in,
               COUNT(*) FILTER (WHERE NOT in_sel)::DOUBLE AS n_out
        FROM sub
        GROUP BY token_id
      ),
      scored AS (
        SELECT c.token_id,
               LN(((c.n_in + 0.5) / (t.N_in - c.n_in + 0.5))
                  / NULLIF(((c.n_out + 0.5) / (t.N_out - c.n_out + 0.5)), 0)) AS enrichment
        FROM counts c, totals t
      ),
      binned AS (
        SELECT token_id,
               LEAST(${ENRICHMENT_BINS - 1},
                 CAST((NTILE(${ENRICHMENT_BINS}) OVER (ORDER BY enrichment) - 1) AS INTEGER)
               ) AS enrichment_category
        FROM scored
      )
      SELECT r.*,
             COALESCE(b.enrichment_category,
                      ${Math.floor(ENRICHMENT_BINS / 2)})::INTEGER AS enrichment_category,
             COALESCE(s.enrichment, 0.0) AS enrichment_score
      FROM ${TABLE.regionsClassed} r
      LEFT JOIN binned b ON b.token_id = r.token_id
      LEFT JOIN scored s ON s.token_id = r.token_id`;

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    coordinator
      .exec(sql)
      .then(() => {
        if (cancelled) return;
        previousTableRef.current = versionedTable;
        if (previousTable) {
          coordinator
            .exec(`DROP TABLE IF EXISTS ${previousTable}`)
            .catch(() => {
              /* ignored — best-effort cleanup */
            });
        }
        setState({
          tableName: versionedTable,
          version: cacheKey,
          loading: false,
          error: null,
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setState({ tableName: null, version: null, loading: false, error: msg });
      });
    return () => {
      cancelled = true;
    };
  }, [coordinator, isReady, cacheKey, customFileIds]);

  return state;
}
