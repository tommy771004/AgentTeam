import { defineConfig } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    // Real `electron` is CJS; named ESM imports break under plain Node.
    // E2E never needs a real BrowserWindow — stub vault/path APIs only.
    alias: {
      electron: path.resolve(__dirname, 'electron-e2e-stub.mjs'),
    },
  },
  build: {
    ssr: path.resolve(__dirname, 'plugin-installer-e2e.ts'),
    target: 'node22',
    outDir: '.tmp/plugin-e2e',
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      output: {
        format: 'es',
        entryFileNames: 'plugin-installer-e2e.mjs',
      },
    },
  },
  ssr: {
    noExternal: true,
  },
})
