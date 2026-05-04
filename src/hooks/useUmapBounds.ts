// Query the UMAP coordinate extents of a table so callers can build
// `viewportState` values for embedding-atlas. The component's auto-fit
// kicks in when viewportState is null; we use this hook to compute the
// equivalent viewport explicitly so we can scale the zoom relative to it.
//
// embedding-atlas's viewport uses the formula
//   px = ((x - vp.x) * vp.scale + 1) / 2 * width
// so the visible x range is [vp.x − 1/scale, vp.x + 1/scale]. Centering on
// the data midpoint with scale = 2 / max(x_range, y_range) reproduces
// auto-fit; multiplying that scale by < 1 zooms out.

import { useMemo } from 'react';
import { useSqlQuery } from './useSqlQuery';

type Bounds = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};

export function useUmapBounds(
  table: string,
  xCol: string = 'umap_x',
  yCol: string = 'umap_y',
): {
  bounds: Bounds | null;
  /** Viewport that exactly fits the data into the plot (default zoom). */
  fitViewport: { x: number; y: number; scale: number } | null;
  loading: boolean;
  error: string | null;
} {
  const sql = `SELECT
    MIN(${xCol})::DOUBLE AS x_min, MAX(${xCol})::DOUBLE AS x_max,
    MIN(${yCol})::DOUBLE AS y_min, MAX(${yCol})::DOUBLE AS y_max
  FROM ${table}`;

  const { rows, loading, error } = useSqlQuery<{
    x_min: number;
    x_max: number;
    y_min: number;
    y_max: number;
  }>(sql, [table, xCol, yCol]);

  const bounds = useMemo<Bounds | null>(() => {
    if (!rows || rows.length === 0) return null;
    const r = rows[0];
    return {
      xMin: Number(r.x_min),
      xMax: Number(r.x_max),
      yMin: Number(r.y_min),
      yMax: Number(r.y_max),
    };
  }, [rows]);

  const fitViewport = useMemo(() => {
    if (!bounds) return null;
    const xRange = bounds.xMax - bounds.xMin;
    const yRange = bounds.yMax - bounds.yMin;
    const span = Math.max(xRange, yRange) || 1;
    return {
      x: (bounds.xMin + bounds.xMax) / 2,
      y: (bounds.yMin + bounds.yMax) / 2,
      // 2/span makes the longer axis exactly fill the viewport.
      scale: 2 / span,
    };
  }, [bounds]);

  return { bounds, fitViewport, loading, error };
}
