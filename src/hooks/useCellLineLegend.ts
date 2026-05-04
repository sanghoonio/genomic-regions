// Pull the cell-line legend (label + integer category) from the
// filesCategorized view so the FileUMAP legend chip lines up exactly with
// the points on the plot. The view encodes top-19 cell lines as 0..18 and
// everything else as 19 = Other.

import { useMemo } from 'react';
import { useSqlQuery } from './useSqlQuery';
import { TABLE } from '../lib/duckdb';
import { TABLEAU20 } from '../lib/palettes';

type Row = { cell_line: string | null; cat: number; n: number };

export function useCellLineLegend(): {
  items: { label: string; color: string }[] | null;
  loading: boolean;
  error: string | null;
} {
  const sql = `SELECT cell_line, cell_line_cat AS cat, COUNT(*)::INTEGER AS n
    FROM ${TABLE.filesCategorized}
    GROUP BY cell_line, cell_line_cat
    ORDER BY cat`;

  const { rows, loading, error } = useSqlQuery<Row>(sql, []);

  const items = useMemo(() => {
    if (!rows) return null;
    // Collapse the "Other" bucket — many cell_line strings may map to
    // category 6, but we only want one legend swatch labeled "Other".
    const seen = new Set<number>();
    const out: { label: string; color: string }[] = [];
    for (const r of rows) {
      const cat = Number(r.cat);
      if (seen.has(cat)) continue;
      seen.add(cat);
      out.push({
        label: cat === 6 ? 'Other' : (r.cell_line ?? 'Other'),
        color: TABLEAU20[cat] ?? '#888',
      });
    }
    return out;
  }, [rows]);

  return { items, loading, error };
}
