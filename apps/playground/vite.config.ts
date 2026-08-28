import { defineConfig } from 'vite'

export default defineConfig({
  // Non-root base on purpose: the playground must work when mounted under a
  // sub-path, including its worker asset.
  base: '/playground/',
  // Consume runesm from its TypeScript source during dev and build.
  resolve: {
    conditions: ['@jkomyno/source', 'module', 'browser', 'import', 'default'],
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2023',
  },
})
