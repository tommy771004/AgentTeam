import { defineConfig } from 'vite'
import path from 'node:path'

export default defineConfig({
  build: {
    outDir: path.resolve(__dirname, '../dist-electron'),
    emptyOutDir: false,
    target: 'node22',
    lib: {
      entry: path.resolve(__dirname, '../electron/piHostEntry.ts'),
      formats: ['es'],
      fileName: () => 'pi-host.js',
    },
    rollupOptions: {
      external: ['node:readline', 'node:path', 'node:url', 'node:fs', 'node:fs/promises'],
      output: { inlineDynamicImports: true },
    },
  },
})
