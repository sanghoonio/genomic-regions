// Context object + value type only — kept in its own file so
// react-refresh/only-export-components is happy with the provider component.

import { createContext } from 'react';
import type * as vg from '@uwdata/vgplot';

export type LoadProgress = {
  done: number;
  total: number;
  /** Human-readable label for the most recently completed step. */
  label: string;
};

export type MosaicCoordinatorContextValue = {
  getCoordinator: () => vg.Coordinator;
  initializeData: () => Promise<void>;
  isReady: boolean;
  error: string | null;
  /** Streaming progress through the parquet-registration pipeline.
   * Null until the first step lands. */
  loadProgress: LoadProgress | null;
};

export const MosaicCoordinatorContext =
  createContext<MosaicCoordinatorContextValue | null>(null);
