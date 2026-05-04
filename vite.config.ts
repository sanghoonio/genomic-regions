import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

// Plugin set + esnext target match bedbase-ui — required for DuckDB-WASM
// (mosaic-core's wasmConnector) which needs WebAssembly + top-level await.
export default defineConfig({
  plugins: [react(), tailwindcss(), wasm(), topLevelAwait()],
  build: { target: 'esnext' },
  worker: {
    plugins: () => [wasm(), topLevelAwait()],
  },
});
