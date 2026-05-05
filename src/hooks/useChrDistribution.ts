// Universe density (chr16) and partner positions for the chr16 distribution
// strip. Universe density is queried once via DuckDB GROUP BY in fixed-width
// bins; partner positions are queried per (token, source). The pool is
// either the full corpus or a custom file id list (legend pins / brush).

import { useMemo } from 'react';
import { useSqlQuery } from './useSqlQuery';
import { TABLE } from '../lib/duckdb';

function escapeId(id: string): string {
  return `'${id.replace(/'/g, "''")}'`;
}

export const CHR16_END = 90_338_345;

export type Bin = {
  binIndex: number;
  start: number;
  end: number;
  universe: number;
  partners: number;
};

type UniverseRow = { bin_idx: number; n: number };

export function useChr16UniverseBins(nBins: number): {
  bins: { binIndex: number; start: number; end: number; universe: number }[] | null;
  loading: boolean;
  error: string | null;
} {
  // Pre-aggregate in DuckDB so we don't ship 36k rows just to count them.
  const sql = `SELECT
    FLOOR((start + "end") / 2 / (${CHR16_END}.0 / ${nBins}))::INTEGER AS bin_idx,
    COUNT(*)::INTEGER AS n
  FROM ${TABLE.regions}
  WHERE chrom = 'chr16'
  GROUP BY bin_idx
  ORDER BY bin_idx`;

  const { rows, loading, error } = useSqlQuery<UniverseRow>(sql, [nBins]);

  const bins = useMemo(() => {
    if (!rows) return null;
    const binSize = CHR16_END / nBins;
    const counts = new Map<number, number>();
    for (const r of rows) counts.set(Number(r.bin_idx), Number(r.n));
    return Array.from({ length: nBins }, (_, i) => ({
      binIndex: i,
      start: i * binSize,
      end: (i + 1) * binSize,
      universe: counts.get(i) ?? 0,
    }));
  }, [rows, nBins]);

  return { bins, loading, error };
}

// Light query for chr16 universe tokens overlapping a genomic window —
// used by the deepest zoom track when we'd rather render tokens at
// their actual coords than bin them. Returns a small list (~tens of
// tokens for a 20 kb window).
export type WindowToken = {
  token_id: number;
  start: number;
  end: number;
  cclass: string;
};

export function useChr16WindowTokens(
  range: [number, number] | null,
): { tokens: WindowToken[] | null; loading: boolean; error: string | null } {
  const sql = useMemo(() => {
    if (!range) return null;
    const [lo, hi] = range;
    return `SELECT token_id, start, "end" AS end,
                   COALESCE(cclass, 'unclassed') AS cclass
            FROM ${TABLE.regions}
            WHERE chrom = 'chr16' AND start <= ${hi} AND "end" >= ${lo}
            ORDER BY start`;
  }, [range]);

  const { rows, loading, error } = useSqlQuery<WindowToken>(sql, [range]);
  const tokens = useMemo(() => {
    if (!rows) return null;
    return rows.map((r) => ({
      token_id: Number(r.token_id),
      start: Number(r.start),
      end: Number(r.end),
      cclass: r.cclass,
    }));
  }, [rows]);
  return { tokens, loading, error };
}

export type PartnerSource = 'kNN' | 'NPMI';

export function useChr16PartnerPositions(
  tokenId: number | null,
  source: PartnerSource,
  topK: number = 30,
  customIds?: ReadonlyArray<string> | null,
): { positions: number[] | null; loading: boolean; error: string | null } {
  const sql = useMemo(() => {
    if (tokenId == null) return null;
    if (source === 'kNN') {
      return `WITH src AS (
        SELECT UNNEST(knn_token_ids) AS partner_token_id,
               generate_subscripts(knn_token_ids, 1) AS rank
        FROM ${TABLE.regions}
        WHERE token_id = ${tokenId}
      )
      SELECT r.start, r."end" AS end
      FROM src s
      JOIN ${TABLE.regions} r ON r.token_id = s.partner_token_id
      WHERE r.chrom = 'chr16' AND s.rank <= ${topK}`;
    }
    // NPMI: same on-demand pattern as useTokenNpmiPartners.
    // Pool is either full corpus or a custom file id list.
    const predicate =
      customIds && customIds.length > 0
        ? `id IN (${customIds.map(escapeId).join(',')})`
        : 'TRUE';
    const minFilesActive = 5;
    return `WITH pool AS (
        SELECT id FROM ${TABLE.manifest} WHERE ${predicate}
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
          LN(j.n_ab * (SELECT N FROM n_total)
             / NULLIF((SELECT n_a FROM n_anchor) * m.n_b, 0)) AS pmi
        FROM joints j JOIN marginals m USING (partner_id)
      )
      SELECT r.start, r."end" AS end
      FROM scored s
      JOIN ${TABLE.regions} r ON r.token_id = s.partner_id
      WHERE s.pmi > 0 AND r.chrom = 'chr16'
      ORDER BY
        CASE
          WHEN s.pmi > 0 AND s.n_ab > 0 AND s.n_ab < s.n_total_val
            THEN s.pmi / NULLIF(-LN(s.n_ab / s.n_total_val), 0)
          ELSE 0
        END DESC,
        s.n_ab DESC
      LIMIT ${topK}`;
  }, [tokenId, source, topK, customIds]);

  const { rows, loading, error } = useSqlQuery<{ start: number; end: number }>(
    sql,
    [tokenId, source, topK],
  );

  const positions = useMemo(() => {
    if (!rows) return null;
    return rows.map((r) => (Number(r.start) + Number(r.end)) / 2);
  }, [rows]);

  return { positions, loading, error };
}

// Compose universe + partners into the per-bin shape the strip plot needs.
export function composeBins(
  universe:
    | { binIndex: number; start: number; end: number; universe: number }[]
    | null,
  partnerPositions: number[] | null,
  nBins: number,
): Bin[] | null {
  if (!universe) return null;
  const binSize = CHR16_END / nBins;
  const indexOf = (pos: number) =>
    Math.min(nBins - 1, Math.max(0, Math.floor(pos / binSize)));
  const bins: Bin[] = universe.map((b) => ({
    binIndex: b.binIndex,
    start: b.start,
    end: b.end,
    universe: b.universe,
    partners: 0,
  }));
  if (partnerPositions) {
    for (const p of partnerPositions) bins[indexOf(p)].partners += 1;
  }
  return bins;
}
