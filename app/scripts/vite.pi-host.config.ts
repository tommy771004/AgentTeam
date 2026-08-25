import { defineConfig } from 'vite'
import path from 'node:path'

export default defineConfig({
  // The Host bundle shares `dist-electron` with main/preload; Vite would
  // otherwise copy all of `public/` (71MB of Open Design templates) in here
  // too, where nothing reads it. The renderer build keeps its copy in `dist`.
  publicDir: false,
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
      external: ['node:crypto', 'node:readline', 'node:path', 'node:url', 'node:fs', 'node:fs/promises', 'node:os', 'node:vm', 'node:child_process'],
      output: { inlineDynamicImports: true },
    },
  },
})
