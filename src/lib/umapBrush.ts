// Helpers for converting embedding-atlas's brush events
// (rectangle / lasso polygon) into a Mosaic / DuckDB predicate.
// Ported verbatim from bedbase-ui/src/lib/umap-utils.ts so the file
// UMAP brush behaviour matches across the two apps.

import * as vg from '@uwdata/vgplot';
import { add, sub, mul, mod } from '@uwdata/mosaic-sql';

/** SQL point-in-polygon predicate for DuckDB — ray-casting algorithm
 * expressed as SQL expressions via vgplot/mosaic-sql helpers. The
 * `x` and `y` arguments are column references (`vg.column('umap_x')`
 * etc.); the polygon is a list of `{x, y}` vertices in plot
 * coordinates. The vgplot helper types are loose, so we lean on
 * `any` here (same as bedbase-ui's reference implementation). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pointInPolygonPredicate(
  x: any,
  y: any,
  polygon: { x: number; y: number }[],
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    const { x: x1, y: y1 } = polygon[i];
    const { x: x2, y: y2 } = polygon[j];
    const pred1 =
      y1 < y2
        ? vg.and(vg.lte(vg.literal(y1), y), vg.lt(y, vg.literal(y2)))
        : vg.and(vg.lte(vg.literal(y2), y), vg.lt(y, vg.literal(y1)));
    const pred2 = (y1 < y2 ? vg.lt : vg.gt)(
      sub(mul(vg.literal(x2 - x1), y), mul(vg.literal(y2 - y1), x)),
      vg.literal((x2 - x1) * y1 - (y2 - y1) * x1),
    );
    parts.push(vg.cast(vg.and(pred1, pred2), 'INT'));
  }
  const sum = parts.reduce((a, b) => add(a, b));
  return vg.eq(mod(sum, vg.literal(2)), vg.literal(1));
}

/** Bounding rectangle of a polygon — used as a fast pre-filter
 * predicate so the more expensive point-in-polygon test only runs
 * against points already inside the polygon's bbox. */
export function boundingRect(points: { x: number; y: number }[]) {
  let xMin = Infinity,
    yMin = Infinity,
    xMax = -Infinity,
    yMax = -Infinity;
  for (const p of points) {
    if (p.x < xMin) xMin = p.x;
    if (p.x > xMax) xMax = p.x;
    if (p.y < yMin) yMin = p.y;
    if (p.y > yMax) yMax = p.y;
  }
  return { xMin, yMin, xMax, yMax };
}
