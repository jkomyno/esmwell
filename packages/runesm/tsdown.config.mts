import { defineConfig } from 'tsdown'
import { baseConfig } from '../../tsdown.config.base.ts'

export default defineConfig({
  ...baseConfig,
  // Two entries: the main-thread API and the worker-side script the main
  // thread loads by URL.
  entry: ['src/index.ts', 'src/worker-entry.ts'],
  tsconfig: 'tsconfig.build.json',
  // Browser-only, ESM-only output.
  format: ['esm'],
  target: 'es2023',
  // The exports map is import-only, so the node16 CJS resolution is
  // intentionally absent: validate the ESM surface instead.
  attw: {
    profile: 'esm-only',
  },
})
