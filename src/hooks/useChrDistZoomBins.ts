// Compute high-resolution chr16 distribution bins for a brushed range.
//
// The overview plot uses 250 bins across the entire ~90 Mb chromosome
// (≈360 kb/bin, precomputed once). The zoom plot needs much finer bins
// inside whatever range the user brushed — at a 5 Mb brush, 250 bins
// give 20 kb resolution; at 1 Mb it's 4 kb. We compute these on demand
// in DuckDB and `loadObjects` them as a versioned table.
//
// Each row: { binIndex, start, end, universe, partners }, same shape as
// composeBins() so the zoom plot can reuse the overview's mark spec.

import { useEffect, useMemo, useRef, useState } from 'react';
import { loadObjects } from '@uwdata/mosaic-sql';
import { useMosaicCoordinator } from './useMosaicCoordinator';
import { useChr16PartnerPositions } from './useChrDistribution';
import { TABLE } from '../lib/duckdb';
import type { PickedRegion } from '../components/RegionUMAP';

const ZOOM_TABLE_BASE = 'dict_chr16_dist_zoom';

export type ZoomBin = {
  binIndex: number;
  start: number;
  end: number;
  universe: number;
  partners: number;
};

export function useChrDistZoomBins(
  range: [number, number] | null,
  picked: PickedRegion | null,
  customFileIds: ReadonlyArray<string> | null | undefined,
  nBins: number = 250,
): {
  tableName: string | null;
  version: string | null;
  maxPartner: number;
  bins: ZoomBin[] | null;
  loading: boolean;
  error: string | null;
} {
  const { coordinator, isReady } = useMosaicCoordinator();
  // Reuse the same partner-positions hook the overview uses — top-30 NPMI
  // partner positions for the picked token, scoped to the active pool.
  const { positions: partnerPositions } = useChr16PartnerPositions(
    picked?.token_id ?? null,
    'NPMI',
    30,
    customFileIds,
  );

  const [bins, setBins] = useState<ZoomBin[] | null>(null);
  const [tableState, setTableState] = useState<{
    name: string | null;
    version: string | null;
    loading: boolean;
    error: string | null;
  }>({ name: null, version: null, loading: false, error: null });

  const counterRef = useRef(0);
  const previousTableRef = useRef<string | null>(null);

  // Stable cache key — recompute only when something material changes.
  const cacheKey = useMemo(() => {
    if (!range) return null;
    const partnerKey = partnerPositions
      ? partnerPositions.length === 0
        ? 'p0'
        : `p${partnerPositions.length}:${partnerPositions[0]}-${partnerPositions[partnerPositions.length - 1]}`
      : 'p?';
    return `${range[0]}-${range[1]}@${nBins}|${partnerKey}`;
  }, [range, nBins, partnerPositions]);

  useEffect(() => {
    if (!isReady) return;
    if (!range) {
      // External-resource sync — clear bin state when the brush is cleared.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBins(null);
      setTableState({ name: null, version: null, loading: false, error: null });
      return;
    }

    let cancelled = false;
    const [start, end] = range;
    const span = Math.max(1, end - start);
    const binWidth = span / nBins;

    // Aggregate universe density per bin in the range. Bin index is
    // computed from the region midpoint to match composeBins's behaviour.
    const universeSql = `SELECT
      LEAST(${nBins - 1},
        FLOOR(((start + "end") / 2 - ${start}) / ${binWidth})
      )::INTEGER AS bin_idx,
      COUNT(*)::INTEGER AS n
    FROM ${TABLE.regions}
    WHERE chrom = 'chr16'
      AND ((start + "end") / 2) BETWEEN ${start} AND ${end}
    GROUP BY bin_idx
    ORDER BY bin_idx`;

    counterRef.current += 1;
    const tableName = `${ZOOM_TABLE_BASE}_${counterRef.current}`;
    const previous = previousTableRef.current;

    setTableState((prev) => ({ ...prev, loading: true, error: null }));
    coordinator
      .query(universeSql, { type: 'json' })
      .then((rows: unknown) => {
        if (cancelled) return null;
        const universeCounts = new Map<number, number>();
        for (const r of rows as Array<{ bin_idx: number; n: number }>) {
          universeCounts.set(Number(r.bin_idx), Number(r.n));
        }
        const partnerCounts = new Map<number, number>();
        for (const pos of partnerPositions ?? []) {
          if (pos < start || pos > end) continue;
          const idx = Math.min(
            nBins - 1,
            Math.max(0, Math.floor((pos - start) / binWidth)),
          );
          partnerCounts.set(idx, (partnerCounts.get(idx) ?? 0) + 1);
        }
        const next: ZoomBin[] = Array.from({ length: nBins }, (_, i) => ({
          binIndex: i,
          start: start + i * binWidth,
          end: start + (i + 1) * binWidth,
          universe: universeCounts.get(i) ?? 0,
          partners: partnerCounts.get(i) ?? 0,
        }));
        return next;
      })
      .then((next) => {
        if (cancelled || !next) return;
        return coordinator
          .exec(
            loadObjects(
              tableName,
              next as unknown as Record<string, unknown>[],
            ),
          )
          .then(() => next);
      })
      .then((next) => {
        if (cancelled || !next) return;
        previousTableRef.current = tableName;
        if (previous) {
          coordinator
            .exec(`DROP TABLE IF EXISTS ${previous}`)
            .catch(() => {
              /* ignored */
            });
        }
        setBins(next);
        setTableState({
          name: tableName,
          version: cacheKey,
          loading: false,
          error: null,
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setTableState({ name: null, version: null, loading: false, error: msg });
      });

    return () => {
      cancelled = true;
    };
  }, [coordinator, isReady, cacheKey, range, nBins, partnerPositions]);

  const maxPartner = useMemo(() => {
    if (!bins) return 1;
    return Math.max(1, ...bins.map((b) => b.partners));
  }, [bins]);

  return {
    tableName: tableState.name,
    version: tableState.version,
    maxPartner,
    bins,
    loading: tableState.loading,
    error: tableState.error,
  };
}
