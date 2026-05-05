// Mosaic / DuckDB-WASM coordinator provider.
// Pattern adapted from bedbase-ui's mosaic-coordinator-context: useRef
// singleton + dataInitializedRef guard so React Strict Mode's double-invoke
// of useEffect doesn't create two coordinators or re-register tables.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as vg from '@uwdata/vgplot';
import { TABLE, PARQUET_URLS } from '../lib/duckdb';
import { SCREEN_CLASS_CATEGORY_SQL, ASSAY_CATEGORY_SQL } from '../lib/colors';
import {
  MosaicCoordinatorContext,
  type LoadProgress,
  type MosaicCoordinatorContextValue,
} from './MosaicCoordinatorContext';

export function MosaicCoordinatorProvider({ children }: { children: ReactNode }) {
  const coordinatorRef = useRef<vg.Coordinator | null>(null);
  const dataInitializedRef = useRef(false);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadProgress, setLoadProgress] = useState<LoadProgress | null>(null);

  const getCoordinator = (): vg.Coordinator => {
    if (!coordinatorRef.current) {
      const coord = new vg.Coordinator(vg.wasmConnector());
      coordinatorRef.current = coord;
      // Register as the vgplot global singleton so high-level vg.plot()
      // calls (used by the token raster) bind to the same DuckDB-WASM
      // instance that EmbeddingViewMosaic talks to.
      vg.coordinator(coord);
    }
    return coordinatorRef.current;
  };

  const initializeData = async (): Promise<void> => {
    if (dataInitializedRef.current) return;
    const coord = getCoordinator();

    // Each step is a (label, sql) pair so we can stream progress to the
    // splash overlay. The labels are user-facing.
    const steps: Array<{ label: string; sql: string }> = [];
    for (const [key, url] of Object.entries(PARQUET_URLS)) {
      if (url == null) continue;
      const tableName = TABLE[key as keyof typeof TABLE];
      // File names from the URL tail make for the most descriptive label
      // (e.g., "tokenized_corpus_chr16.parquet" → "tokenized_corpus_chr16").
      const tail = url.split('/').pop() ?? key;
      const label = tail.replace(/\.parquet$/, '');
      steps.push({
        label,
        sql: `CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_parquet('${url}')`,
      });
    }
    // regionsClassed view exposes cclass_category + midpoint convenience.
    steps.push({
      label: 'regions_classed view',
      sql: `CREATE OR REPLACE VIEW ${TABLE.regionsClassed} AS
       SELECT *,
         ${SCREEN_CLASS_CATEGORY_SQL} AS cclass_category,
         ((start + "end") / 2)::INTEGER AS midpoint
       FROM ${TABLE.regions}
       WHERE cclass IS NOT NULL`,
    });
    // filesCategorized view exposes assay_category + cell_line_cat.
    steps.push({
      label: 'cell_line ranking',
      sql: `CREATE OR REPLACE TEMP VIEW _cell_line_top AS
       SELECT cell_line,
              (ROW_NUMBER() OVER (ORDER BY n DESC) - 1)::INTEGER AS cat
       FROM (
         SELECT cell_line, COUNT(*)::INTEGER AS n
         FROM ${TABLE.files}
         WHERE cell_line IS NOT NULL
         GROUP BY cell_line
         ORDER BY n DESC
         LIMIT 6
       )`,
    });
    steps.push({
      label: 'files_categorized view',
      sql: `CREATE OR REPLACE VIEW ${TABLE.filesCategorized} AS
       SELECT f.*,
         ${ASSAY_CATEGORY_SQL} AS assay_category,
         COALESCE(t.cat, 6)::INTEGER AS cell_line_cat
       FROM ${TABLE.files} f
       LEFT JOIN _cell_line_top t USING (cell_line)`,
    });

    const total = steps.length;
    for (let i = 0; i < total; i++) {
      const { label, sql } = steps[i];
      await coord.exec(sql);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoadProgress({ done: i + 1, total, label });
    }
    dataInitializedRef.current = true;
  };

  // Empty deps intentional: this runs exactly once on mount; the
  // dataInitializedRef guard makes Strict Mode's double-invoke a no-op.
  useEffect(() => {
    let cancelled = false;
    initializeData()
      .then(() => {
        if (!cancelled) setIsReady(true);
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[mosaic] data init failed', e);
        if (!cancelled) setError(msg);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<MosaicCoordinatorContextValue>(
    () => ({ getCoordinator, initializeData, isReady, error, loadProgress }),
    // getCoordinator + initializeData are stable closures over refs; deps
    // limited to the reactive state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isReady, error, loadProgress],
  );

  return (
    <MosaicCoordinatorContext.Provider value={value}>
      {children}
    </MosaicCoordinatorContext.Provider>
  );
}
