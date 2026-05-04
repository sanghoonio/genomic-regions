// Single-row chr16 distribution strip.
// Bar height = universe region count per bin.
// Bar color  = partner count for the picked region under the chosen source.
// Vertical rule marks the picked region's chr16 midpoint.

import { useEffect, useMemo, useRef } from 'react';
import * as Plot from '@observablehq/plot';
import {
  useChr16UniverseBins,
  useChr16PartnerPositions,
  composeBins,
  CHR16_END,
} from '../hooks/useChrDistribution';
import type { PickedRegion } from './RegionUMAP';
import { UMAPCard } from './UMAPHeaderChip';

const N_BINS = 250;

// 9-stop YlOrRd ramp — matches Plot's `scheme: 'YlOrRd'` so the inline
// legend gradient mirrors the bar coloring exactly.
const YLORRD_STOPS = [
  '#ffffcc', '#ffeda0', '#fed976', '#feb24c', '#fd8d3c',
  '#fc4e2a', '#e31a1c', '#bd0026', '#800026',
];

export function ChrDistributionStrip({
  picked,
  customFileIds,
}: {
  picked: PickedRegion | null;
  customFileIds?: ReadonlyArray<string> | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { bins: universe } = useChr16UniverseBins(N_BINS);
  const { positions: partnerPositions, loading: partnersLoading } =
    useChr16PartnerPositions(
      picked?.token_id ?? null,
      'NPMI',
      30,
      customFileIds,
    );

  const bins = useMemo(
    () => composeBins(universe, partnerPositions, N_BINS),
    [universe, partnerPositions],
  );

  const maxPartner = useMemo(() => {
    if (!bins) return 1;
    return Math.max(1, ...bins.map((b) => b.partners));
  }, [bins]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !bins) return;

    const plot = Plot.plot({
      width: el.clientWidth || 900,
      height: 180,
      marginLeft: 60,
      marginRight: 24,
      // Bumped from 8 → 17 so the y-axis label has room above the
      // topmost tick label without overlapping it.
      marginTop: 17,
      marginBottom: 36,
      x: {
        domain: [0, CHR16_END],
        label: 'chr16 position',
        tickFormat: (d: number) => `${(d / 1e6).toFixed(0)}M`,
        ticks: 10,
      },
      y: {
        label: `universe regions / ${(CHR16_END / N_BINS / 1000).toFixed(0)}-kb bin`,
        // Explicit labelOffset lifts the label clear of the topmost tick.
        labelOffset: 38,
      },
      // Built-in legend off — we render a custom inline gradient next to
      // the caption so it sits flush with the descriptive text.
      color: {
        scheme: 'YlOrRd',
        domain: [0, maxPartner],
        label: 'NPMI partners / bin',
        legend: false,
      },
      marks: [
        Plot.rectY(bins, {
          x1: 'start',
          x2: 'end',
          y: 'universe',
          fill: 'partners',
          stroke: '#ddd',
          strokeWidth: 0.2,
          title: (d: { start: number; end: number; universe: number; partners: number }) =>
            `chr16:${Math.round(d.start).toLocaleString()}–${Math.round(d.end).toLocaleString()}\nuniverse: ${d.universe}\nNPMI partners: ${d.partners}`,
        }),
        ...(picked
          ? [
              Plot.ruleX([picked.midpoint], {
                stroke: 'currentColor',
                strokeWidth: 2,
                strokeDasharray: '3,2',
              }),
            ]
          : []),
      ],
    });

    el.appendChild(plot);
    return () => {
      plot.remove();
    };
  }, [bins, maxPartner, picked]);

  const poolLabel =
    customFileIds && customFileIds.length > 0
      ? `${customFileIds.length.toLocaleString()} files`
      : 'full corpus';

  return (
    <UMAPCard title="chr16 distribution" suffix={`(pool: ${poolLabel})`}>
      <div className="p-2 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-base-content/60 leading-snug min-w-0 flex-1">
            Bar height = R2V universe density; bar color = number of NPMI
            partners for the picked region in that ~360-kb bin.{' '}
            {picked
              ? `Black rule = picked region midpoint (${(picked.midpoint / 1e6).toFixed(2)}M).`
              : 'Click a region on the UMAP to populate.'}
          </p>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-base-content/70 bg-base-100 rounded-md border border-base-300 shadow-sm px-2 py-1 shrink-0">
            <span>0</span>
            <span
              className="inline-block h-2 w-24 rounded-sm border border-base-300/50"
              style={{
                background: `linear-gradient(to right, ${YLORRD_STOPS.join(', ')})`,
              }}
            />
            <span>{maxPartner}</span>
            <span className="text-base-content/50 font-normal">
              NPMI partners
            </span>
          </span>
        </div>
        <div ref={ref} className="w-full" aria-busy={partnersLoading} />
      </div>
    </UMAPCard>
  );
}
