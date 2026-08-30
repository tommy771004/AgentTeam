import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron/simple'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { buildRendererCsp } from './electron/securityPolicy'

const fileProtocolModulePlugin = {
  name: 'file-protocol-module-scripts',
  transformIndexHtml: {
    order: 'post' as const,
    handler(html: string) {
      return html
        .replace(/\s+crossorigin(?:="[^"]*")?/g, '')
        .replace(
          /<script type="module" src="([^"]+)"><\/script>/,
          (_match, src) => `<script>const moduleScript=document.createElement('script');moduleScript.type='module';moduleScript.src=${JSON.stringify(src)};document.head.append(moduleScript)</script>`,
        )
    },
  },
}

// Issue 06 — production CSP：build 時注入 meta；內聯 shim（上面 plugin 產生）
// 以 sha256 hash 放行，不使用 unsafe-inline。dev（vite HMR / react-refresh）不注入。
const rendererCspPlugin = {
  name: 'inject-renderer-csp',
  apply: 'build' as const,
  transformIndexHtml: {
    order: 'post' as const,
    handler(html: string) {
      const inlineScriptHashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
        ([, body]) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`,
      )
      const csp = buildRendererCsp({ inlineScriptHashes })
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      )
    },
  },
}

function clearRendererBuildFiles(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      clearRendererBuildFiles(target)
      continue
    }
    rmSync(target, { force: true, maxRetries: 10, retryDelay: 50 })
  }
}

let rendererOutDirCleaned = false
const robustRendererOutDirPlugin = {
  name: 'robust-renderer-out-dir',
  apply: 'build' as const,
  configResolved(config: { build: { outDir: string; emptyOutDir?: boolean } }) {
    if (path.basename(config.build.outDir) !== 'dist') return
    config.build.emptyOutDir = false
    if (rendererOutDirCleaned) return
    rendererOutDirCleaned = true
    // Keep the directory tree stable: Finder can recreate .DS_Store at any
    // level between rimraf's final readdir and rmdir, yielding ENOTEMPTY even
    // after retries. Remove build-owned files, but never rmdir the directories;
    // Vite can safely reuse the empty skeleton and harmless Finder metadata.
    if (!existsSync(config.build.outDir)) return
    clearRendererBuildFiles(config.build.outDir)
  },
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    fileProtocolModulePlugin,
    rendererCspPlugin,
    robustRendererOutDirPlugin,
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          // Vite copies `public/` into every build's outDir by default. For the
          // renderer that is the point (`/open-design/*` is fetched at runtime),
          // but the Electron sub-builds share `dist-electron` and would each
          // stamp another copy of the 71MB design-template tree into the asar,
          // where nothing reads it — main resolves brand from resourcesPath or
          // `dist/brand`, never from here.
          publicDir: false,
          build: {
            outDir: 'dist-electron',
            // Main process: ESM (package.json "type":"module"). Do NOT emit require().
            rollupOptions: {
              external: ['electron'],
              output: {
                format: 'es',
                entryFileNames: 'main.js',
              },
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
        vite: {
          // Same reason as main: no public/ copy into the Electron outDir.
          publicDir: false,
          build: {
            outDir: 'dist-electron',
            // Preload MUST be CJS (.cjs). Emitting .mjs + require() crashes with
            // "require is not defined in ES module scope" → window.subagents never loads
            // → folder pick / term / CLI / MCP / scheduler all silently fail.
            rollupOptions: {
              external: ['electron'],
              output: {
                format: 'cjs',
                entryFileNames: 'preload.cjs',
              },
            },
          },
        },
      },
      // No `renderer` option: vite-plugin-electron-renderer's whole purpose is
      // polyfilling Node builtins via a real `require` in the renderer, which
      // needs nodeIntegration:true (see its README warning) — this app runs
      // contextIsolation:true/nodeIntegration:false (electron/main.ts), so the
      // shim's `const _r_ = require` throws "require is not defined" on any
      // renderer-reachable `node:*` import and blanks the whole app.
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
  },
  base: './',
})
