import { defineConfig } from 'tsdown'
import { baseConfig } from '../../tsdown.config.base.ts'

export default defineConfig({
  ...baseConfig,
  // Main-thread API plus lazy execution- and module-service-worker assets.
  entry: [
    'src/index.ts',
    'src/worker-entry.ts',
    'src/execution-worker-entry.ts',
    'src/test-worker-entry.ts',
    'src/module-service-worker.ts',
  ],
  tsconfig: 'tsconfig.build.json',
  // Browser-only, ESM-only output.
  format: ['esm'],
  target: 'es2023',
  minify: true,
  outputOptions: {
    // Function and class names are observable through the public API and errors.
    keepNames: true,
  },
  // The exports map is import-only, so the node16 CJS resolution is
  // intentionally absent: validate the ESM surface instead.
  attw: {
    profile: 'esm-only',
  },
})
