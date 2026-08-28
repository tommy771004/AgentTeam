/**
 * Render AgentStudio app icon SVG → PNG pack + favicon.
 * Uses Playwright (already a devDependency) for crisp rasterization.
 *
 *   node scripts/render-icons.mjs
 *
 * 以 `build/icons/icon.svg` 內容雜湊做快取：SVG 未變且輸出俱全時直接跳過
 * Playwright 重繪（快取存 `.cache/render-icons.json`，不入 git、不進打包）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(__dirname, '..')
const svgPath = path.join(appRoot, 'build', 'icons', 'icon.svg')
const outDir = path.join(appRoot, 'build', 'icons')
const brandDir = path.join(appRoot, 'public', 'brand')
const publicDir = path.join(appRoot, 'public')
const srcAssetsDir = path.join(appRoot, 'src', 'assets')

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
const CACHE_VERSION = 1
const cachePath = path.join(appRoot, '.cache', 'render-icons.json')

// 完整輸出清單：主渲染 + canonical 複本 + make-ico 產物。快取命中前逐一驗存在，
// 避免部分產物被清除後卻誤判新鮮。
const expectedOutputs = [
  ...SIZES.map((size) => path.join(outDir, `icon-${size}.png`)),
  path.join(outDir, 'icon.png'),
  path.join(brandDir, 'subagents-icon.svg'),
  ...[32, 64, 128, 512, 1024].map((size) => path.join(brandDir, `subagents-icon-${size}.png`)),
  path.join(publicDir, 'favicon.svg'),
  path.join(publicDir, 'favicon-32.png'),
  path.join(srcAssetsDir, 'subagents-icon.svg'),
  path.join(srcAssetsDir, 'subagents-icon-32.png'),
  path.join(srcAssetsDir, 'subagents-icon-64.png'),
  path.join(outDir, 'icon.ico'),
  path.join(appRoot, 'build', 'icon.ico'),
  path.join(appRoot, 'build', 'icon.png'),
]

function readCache() {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
    if (parsed?.schemaVersion !== CACHE_VERSION || typeof parsed?.svgSha256 !== 'string') return undefined
    return parsed
  } catch {
    return undefined
  }
}

function writeCache(svgSha256) {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true })
  fs.writeFileSync(cachePath, `${JSON.stringify({ schemaVersion: CACHE_VERSION, svgSha256 }, null, 2)}\n`)
}

async function main() {
  if (!fs.existsSync(svgPath)) {
    console.error('Missing', svgPath)
    process.exit(1)
  }
  fs.mkdirSync(outDir, { recursive: true })
  fs.mkdirSync(brandDir, { recursive: true })
  fs.mkdirSync(srcAssetsDir, { recursive: true })

  const svg = fs.readFileSync(svgPath, 'utf8')
  const svgSha256 = createHash('sha256').update(svg).digest('hex')
  const cached = readCache()
  if (!process.env.SUBAGENTS_ICONS_FORCE_RENDER && cached?.svgSha256 === svgSha256 && expectedOutputs.every((file) => fs.existsSync(file))) {
    console.log('icons are up-to-date; skipping render (force with SUBAGENTS_ICONS_FORCE_RENDER=1)')
    return
  }

  const browser = await chromium.launch()
  const page = await browser.newPage()

  for (const size of SIZES) {
    await page.setViewportSize({ width: size, height: size })
    const html = `<!doctype html><html><head><style>
      *{margin:0;padding:0;box-sizing:border-box}
      html,body{width:${size}px;height:${size}px;overflow:hidden;background:transparent}
      svg{display:block;width:${size}px;height:${size}px}
    </style></head><body>${svg.replace(/<\?xml[^>]*>/, '')}</body></html>`
    await page.setContent(html, { waitUntil: 'load' })
    const file = path.join(outDir, `icon-${size}.png`)
    await page.screenshot({ path: file, omitBackground: true })
    console.log('wrote', path.relative(appRoot, file))
  }

  // Canonical names for electron-builder / docs
  fs.copyFileSync(path.join(outDir, 'icon-512.png'), path.join(outDir, 'icon.png'))
  fs.copyFileSync(path.join(outDir, 'icon-256.png'), path.join(outDir, 'icon-256.png'))
  fs.copyFileSync(path.join(outDir, 'icon-1024.png'), path.join(brandDir, 'subagents-icon-1024.png'))
  fs.copyFileSync(path.join(outDir, 'icon-512.png'), path.join(brandDir, 'subagents-icon-512.png'))
  fs.copyFileSync(path.join(outDir, 'icon-128.png'), path.join(brandDir, 'subagents-icon-128.png'))
  fs.copyFileSync(path.join(outDir, 'icon-64.png'), path.join(brandDir, 'subagents-icon-64.png'))
  fs.copyFileSync(path.join(outDir, 'icon-32.png'), path.join(brandDir, 'subagents-icon-32.png'))

  // App favicon (SVG master + 32 PNG)
  fs.copyFileSync(svgPath, path.join(publicDir, 'favicon.svg'))
  fs.copyFileSync(path.join(outDir, 'icon-32.png'), path.join(publicDir, 'favicon-32.png'))
  fs.copyFileSync(svgPath, path.join(brandDir, 'subagents-icon.svg'))

  // UI bundle assets (Layout sidebar logo — Vite import, no public/ path issues)
  fs.copyFileSync(path.join(outDir, 'icon-64.png'), path.join(srcAssetsDir, 'subagents-icon-64.png'))
  fs.copyFileSync(path.join(outDir, 'icon-32.png'), path.join(srcAssetsDir, 'subagents-icon-32.png'))
  fs.copyFileSync(svgPath, path.join(srcAssetsDir, 'subagents-icon.svg'))

  await browser.close()

  // Windows .ico + buildResources root copies (electron-builder)
  const { spawnSync } = await import('node:child_process')
  const ico = spawnSync(process.execPath, [path.join(__dirname, 'make-ico.mjs')], {
    cwd: appRoot,
    stdio: 'inherit',
  })
  if (ico.status !== 0) {
    console.warn('make-ico failed — run: node scripts/make-ico.mjs')
  }

  console.log('OK — icons in build/icons and public/brand')
  writeCache(svgSha256)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
