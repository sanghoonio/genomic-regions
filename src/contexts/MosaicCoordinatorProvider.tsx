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
  type MosaicCoordinatorContextValue,
} from './MosaicCoordinatorContext';

export function MosaicCoordinatorProvider({ children }: { children: ReactNode }) {
  const coordinatorRef = useRef<vg.Coordinator | null>(null);
  const dataInitializedRef = useRef(false);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getCoordinator = (): vg.Coordinator => {
    if (!coordinatorRef.current) {
      coordinatorRef.current = new vg.Coordinator(vg.wasmConnector());
    }
    return coordinatorRef.current;
  };

  const initializeData = async (): Promise<void> => {
    if (dataInitializedRef.current) return;
    const coord = getCoordinator();

    const stmts: string[] = [];
    for (const [key, url] of Object.entries(PARQUET_URLS)) {
      if (url == null) continue;
      const tableName = TABLE[key as keyof typeof TABLE];
      stmts.push(
        `CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_parquet('${url}')`,
      );
    }
    // regionsClassed view also exposes:
    //   - cclass_category: 0-indexed integer expected by EmbeddingViewMosaic
    //     (mirrors SCREEN_CLASS_ORDER in lib/colors)
    //   - midpoint: convenience for genomic-axis lookups elsewhere
    stmts.push(
      `CREATE OR REPLACE VIEW ${TABLE.regionsClassed} AS
       SELECT *,
         ${SCREEN_CLASS_CATEGORY_SQL} AS cclass_category,
         ((start + "end") / 2)::INTEGER AS midpoint
       FROM ${TABLE.regions}
       WHERE cclass IS NOT NULL`,
    );
    // filesCategorized view exposes integer category columns expected by
    // EmbeddingViewMosaic for each color-by option:
    //   - assay_category — hand-coded 0..5 (matches ASSAY_ORDER)
    //   - cell_line_cat — top-6 cell_line values by file count get
    //     categories 0..5; everything else (including NULL) lands in
    //     bucket 6 = "Other". Caps the legend at 7 chips so it fits in
    //     one row of the floating chip overlay.
    stmts.push(
      `CREATE OR REPLACE TEMP VIEW _cell_line_top AS
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
    );
    stmts.push(
      `CREATE OR REPLACE VIEW ${TABLE.filesCategorized} AS
       SELECT f.*,
         ${ASSAY_CATEGORY_SQL} AS assay_category,
         COALESCE(t.cat, 6)::INTEGER AS cell_line_cat
       FROM ${TABLE.files} f
       LEFT JOIN _cell_line_top t USING (cell_line)`,
    );

    await coord.exec(stmts);
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
    () => ({ getCoordinator, initializeData, isReady, error }),
    // getCoordinator + initializeData are stable closures over refs; deps
    // limited to the reactive state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isReady, error],
  );

  return (
    <MosaicCoordinatorContext.Provider value={value}>
      {children}
    </MosaicCoordinatorContext.Provider>
  );
}
