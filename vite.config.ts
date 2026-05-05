import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import wasm from 'vite-plugin-wasm';

// Plugin set + esnext target match bedbase-ui — required for DuckDB-WASM
// (mosaic-core's wasmConnector) which needs WebAssembly. Top-level await
// is supported natively at `target: 'esnext'`, so the explicit
// vite-plugin-top-level-await plugin is dropped: it crashes on one of
// embedding-atlas's worker chunks (`generateBundle` → undefined path).
export default defineConfig({
  plugins: [react(), tailwindcss(), wasm()],
  build: { target: 'esnext' },
  worker: {
    plugins: () => [wasm()],
  },
  // macOS fsevents has been silently dropping changes on this project,
  // leaving HMR stale until a manual restart. Polling is slightly more
  // CPU but reliable; tuned at 300ms for snappy feel.
  server: {
    watch: {
      usePolling: true,
      interval: 300,
    },
  },
});
