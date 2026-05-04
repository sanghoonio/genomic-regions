// Token raster — pixel-binned vgplot view of (file_row × chr16 position)
// activation density across the BED corpus. One pixel column ≈ a stretch
// of chr16; one pixel row aggregates ~(file_count / plot_height) files
// from the current pool. Fill = dominant SCREEN class in that pixel,
// fillOpacity = activation count → bright = many files / high density.
//
// Data source: a (row_idx, pos, cclass) table built by useTokenRasterTable
// against the coordinator. The table is rebuilt whenever the file pool
// or sort field changes; we remount the plot via a `key` derived from
// the table's version token so vgplot re-issues queries against the
// fresh rows.

import { useEffect, useRef, useState } from 'react';
import * as vg from '@uwdata/vgplot';
import { SCREEN_CLASS_COLOR_RANGE, SCREEN_CLASS_ORDER } from '../lib/colors';

const CHR16_END = 90_338_345;

export type TokenRasterPlotProps = {
  tableName: string | null;
  version: string | null;
  rowCount: number | null;
  height?: number;
  /** Inserted into the y-axis label so the user knows the row order. */
  sortLabel?: string;
};

export function TokenRasterPlot({
  tableName,
  version,
  rowCount,
  height = 400,
  sortLabel,
}: TokenRasterPlotProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  // Container width feeds vgplot's `vg.width()`, which it uses to size the
  // raster's internal pixel grid.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        setWidth(Math.max(0, Math.floor(e.contentRect.width)));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || !tableName || !rowCount || width === 0) return;

    const plot = vg.plot(
      vg.frame({ stroke: '#ddd' }),
      vg.raster(vg.from(tableName), {
        x: 'pos',
        y: 'row_idx',
        // mode = most-common SCREEN class in the pixel; opacity scales
        // with activation count so dense regions glow.
        fill: vg.mode('cclass'),
        fillOpacity: vg.count(),
        imageRendering: 'pixelated',
      }),
      vg.colorDomain(SCREEN_CLASS_ORDER),
      vg.colorRange(SCREEN_CLASS_COLOR_RANGE),
      vg.opacityClamp(true),
      vg.xDomain([0, CHR16_END]),
      vg.xLabel('chr16 position'),
      vg.xTickFormat((d: number) => `${(d / 1e6).toFixed(0)}M`),
      vg.yDomain([0, Math.max(1, rowCount)]),
      vg.yLabel(`Files${sortLabel ? ` · ordered by ${sortLabel}` : ''}`),
      vg.yReverse(true),
      vg.width(width),
      vg.height(height),
      vg.margins({ left: 40, top: 8, bottom: 36, right: 8 }),
      vg.style({ fontSize: '9px' }),
    );

    el.appendChild(plot);
    return () => {
      plot.remove();
    };
  }, [tableName, version, rowCount, width, height, sortLabel]);

  return <div ref={ref} className="w-full" />;
}
