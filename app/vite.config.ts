import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron/simple'
import path from 'node:path'
import { createHash } from 'node:crypto'
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

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    fileProtocolModulePlugin,
    rendererCspPlugin,
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
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
      renderer: {},
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
