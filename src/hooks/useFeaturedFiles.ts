// Loads the featured files manifest. The chr16_active_token_ids list is the
// expensive column — fetched but only used once we intersect with an
// interval's universe set in Section 1.

import { useMemo } from 'react';
import { useSqlQuery } from './useSqlQuery';
import { TABLE } from '../lib/duckdb';
import type { FeaturedFile } from '../lib/types';

type Row = {
  file_id: string;
  name: string;
  assay: string;
  cell_line: string;
  target: string | null;
  role: string;
  n_chr16_active_tokens: number;
  chr16_active_token_ids: number[] | null;
};

export function useFeaturedFiles(): {
  files: FeaturedFile[] | null;
  loading: boolean;
  error: string | null;
} {
  const { rows, loading, error } = useSqlQuery<Row>(
    `SELECT file_id, name, assay, cell_line, target, role,
            n_chr16_active_tokens, chr16_active_token_ids
     FROM ${TABLE.featuredFiles}
     ORDER BY cell_line, target NULLS FIRST, name`,
  );

  const files = useMemo<FeaturedFile[] | null>(() => {
    if (!rows) return null;
    return rows.map((r) => ({
      file_id: r.file_id,
      name: r.name,
      assay: r.assay,
      cell_line: r.cell_line,
      target: r.target,
      role: r.role,
      n_chr16_active_tokens: Number(r.n_chr16_active_tokens),
      chr16_active_token_ids: r.chr16_active_token_ids
        ? Array.from(r.chr16_active_token_ids).map((id) => Number(id))
        : null,
    }));
  }, [rows]);

  return { files, loading, error };
}

// Human-readable label for a file row, mirrors observable's fileLabel().
export function fileLabel(f: FeaturedFile): string {
  if (f.assay === 'ATAC-seq') return `${f.cell_line} · ATAC-seq`;
  if (f.target) return `${f.cell_line} · ${f.target}`;
  return `${f.cell_line} · ${f.assay}`;
}
