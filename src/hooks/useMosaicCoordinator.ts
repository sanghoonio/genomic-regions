import { useContext } from 'react';
import {
  MosaicCoordinatorContext,
  type MosaicCoordinatorContextValue,
} from '../contexts/MosaicCoordinatorContext';

export function useMosaicCoordinator() {
  const ctx = useContext(MosaicCoordinatorContext);
  if (!ctx) {
    throw new Error(
      'useMosaicCoordinator must be used within MosaicCoordinatorProvider',
    );
  }
  return {
    coordinator: ctx.getCoordinator(),
    initializeData: ctx.initializeData,
    isReady: ctx.isReady,
    error: ctx.error,
    loadProgress: ctx.loadProgress,
  };
}

export type { MosaicCoordinatorContextValue };
