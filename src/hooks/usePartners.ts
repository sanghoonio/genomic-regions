// kNN + NPMI partner queries for a picked region.
//   kNN  → unrolled from regions.knn_token_ids[] (already in viz_chr16),
//          partner metadata resolved via a self-join.
//   NPMI → computed on demand against tokenized_corpus + manifest.
//          Anchor-restricted: O(pool_size × tokens_per_file), sub-second
//          for our 17k corpus. The pool is either the full corpus (default)
//          or a custom file id list (legend pins / brush selection).

import { useSqlQuery } from './useSqlQuery';
import { TABLE } from '../lib/duckdb';

export type PartnerRow = {
  partner_token_id: number;
  partner_region: string;
  partner_cclass: string;
  weight: number; // distance for kNN, NPMI weight for NPMI
  rank: number;
};

type RawKnn = {
  partner_token_id: number;
  partner_region: string;
  partner_cclass: string;
  knn_dist: number;
  rank: number;
};

type RawNpmi = {
  partner_token_id: number;
  partner_region: string;
  partner_cclass: string;
  npmi: number;
  n_ab: number;
  n_files_active: number;
  n_files_in_pool: number;
};

export function useTokenKnnPartners(
  tokenId: number | null,
  topK: number = 10,
): { rows: PartnerRow[] | null; loading: boolean; error: string | null } {
  const sql =
    tokenId == null
      ? null
      : `WITH src AS (
            SELECT UNNEST(knn_token_ids) AS partner_token_id,
                   UNNEST(knn_distances) AS knn_dist,
                   generate_subscripts(knn_token_ids, 1) AS rank
            FROM ${TABLE.regions}
            WHERE token_id = ${tokenId}
          )
          SELECT s.partner_token_id,
                 r.region AS partner_region,
                 COALESCE(r.cclass, 'unclassed') AS partner_cclass,
                 s.knn_dist,
                 s.rank
          FROM src s
          JOIN ${TABLE.regions} r ON r.token_id = s.partner_token_id
          ORDER BY s.rank
          LIMIT ${topK}`;

  const { rows, loading, error } = useSqlQuery<RawKnn>(sql, [tokenId, topK]);
  return {
    rows: rows
      ? rows.map((r) => ({
          partner_token_id: Number(r.partner_token_id),
          partner_region: r.partner_region,
          partner_cclass: r.partner_cclass,
          weight: Number(r.knn_dist),
          rank: Number(r.rank),
        }))
      : null,
    loading,
    error,
  };
}

// SQL-escape a file id for the `id IN (...)` predicate.
function escapeId(id: string): string {
  return `'${id.replace(/'/g, "''")}'`;
}

// On-demand NPMI: anchor-restricted, computed fresh against the tokenized
// corpus. The file pool is either the full corpus (when customIds is
// null/empty) or the supplied id list (legend pins or brush selection).
//
// Floor `minFilesActive` mirrors stage 12's config (5 by default) — drops
// pairs that co-occur in too few files to be statistically meaningful.
//
// NPMI = PPMI / -ln(P(a,b))  where PPMI = max(0, ln(P(a,b) / (P(a)·P(b)))).
// Both are computed inline; we only emit positive-PMI partners.
export function useTokenNpmiPartners(
  tokenId: number | null,
  topK: number = 10,
  minFilesActive: number = 5,
  customIds?: ReadonlyArray<string> | null,
): {
  rows: PartnerRow[] | null;
  meta: { n_files_active: number; n_files_in_pool: number } | null;
  loading: boolean;
  error: string | null;
} {
  const poolPredicate =
    customIds && customIds.length > 0
      ? `id IN (${customIds.map(escapeId).join(',')})`
      : 'TRUE';
  const sql =
    tokenId == null
      ? null
      : `WITH pool AS (
            SELECT id FROM ${TABLE.manifest} WHERE ${poolPredicate}
          ),
          n_total AS (SELECT COUNT(*)::DOUBLE AS N FROM pool),
          sub AS (
            SELECT t.id, UNNEST(t.chr16_active_token_ids) AS token_id
            FROM ${TABLE.tokenizedCorpus} t
            INNER JOIN pool p ON t.id = p.id
          ),
          anchor_files AS (
            SELECT id FROM sub WHERE token_id = ${tokenId}
          ),
          n_anchor AS (SELECT COUNT(*)::DOUBLE AS n_a FROM anchor_files),
          joints AS (
            SELECT s.token_id AS partner_id, COUNT(*)::DOUBLE AS n_ab
            FROM sub s
            WHERE s.id IN (SELECT id FROM anchor_files)
              AND s.token_id != ${tokenId}
            GROUP BY s.token_id
            HAVING COUNT(*) >= ${minFilesActive}
          ),
          marginals AS (
            SELECT token_id AS partner_id, COUNT(*)::DOUBLE AS n_b
            FROM sub
            GROUP BY token_id
          ),
          scored AS (
            SELECT
              j.partner_id,
              j.n_ab,
              (SELECT N FROM n_total) AS n_total_val,
              (SELECT n_a FROM n_anchor) AS n_a_val,
              LN(j.n_ab * (SELECT N FROM n_total)
                 / NULLIF((SELECT n_a FROM n_anchor) * m.n_b, 0)) AS pmi
            FROM joints j JOIN marginals m USING (partner_id)
          )
          SELECT
            s.partner_id AS partner_token_id,
            r.region AS partner_region,
            COALESCE(r.cclass, 'unclassed') AS partner_cclass,
            CASE
              WHEN s.pmi > 0 AND s.n_ab > 0 AND s.n_ab < s.n_total_val
                THEN s.pmi / NULLIF(-LN(s.n_ab / s.n_total_val), 0)
              ELSE 0
            END AS npmi,
            s.n_ab,
            s.n_a_val AS n_files_active,
            s.n_total_val AS n_files_in_pool
          FROM scored s
          JOIN ${TABLE.regions} r ON r.token_id = s.partner_id
          WHERE s.pmi > 0
          ORDER BY npmi DESC, s.n_ab DESC
          LIMIT ${topK}`;

  const { rows, loading, error } = useSqlQuery<RawNpmi>(sql, [
    tokenId,
    topK,
    minFilesActive,
  ]);

  if (!rows) {
    return { rows: null, meta: null, loading, error };
  }
  if (rows.length === 0) {
    return { rows: [], meta: null, loading, error };
  }

  return {
    rows: rows.map((r, i) => ({
      partner_token_id: Number(r.partner_token_id),
      partner_region: r.partner_region,
      partner_cclass: r.partner_cclass,
      weight: Number(r.npmi),
      rank: i + 1,
    })),
    meta: {
      n_files_active: Number(rows[0].n_files_active),
      n_files_in_pool: Number(rows[0].n_files_in_pool),
    },
    loading,
    error,
  };
}
