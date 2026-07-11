import { defineConfig } from 'vite'
import path from 'node:path'

export default defineConfig({
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
})
