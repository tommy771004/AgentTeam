/**
 * Pi Host bundle 新鮮度守衛（取代每次無條件 `vite build --config scripts/vite.pi-host.config.ts`）。
 *
 * 背景：`dist:mac` 的 smoke 鏈會巢狀觸發 `build:pi-host` 十餘次，且每次的
 * 產物完全相同——真正被打包進 app 的只有最後 `npm run build` 那一次。
 * 這裡以內容指紋判定 `dist-electron/pi-host.js` 是否仍新鮮：
 *
 *   fingerprint = sha256(
 *     vendor/pi source tree hash   ← 與 build-pi-vendor 快取同一把尺
 *     + electron import graph（自 piHostEntry.ts 可達的相對 .ts 檔內容）
 *     + vite.pi-host.config.ts 內容
 *     + vite 版本
 *   )
 *
 * 指紋未變且產物存在 → 跳過 bundle；否則執行 vite build 後寫入快取。
 * 強制重建：SUBAGENTS_PI_HOST_BUNDLE_FORCE_BUILD=1。
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashPiVendorTree } from './piVendorTree.mts'

const schemaVersion = 1
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const entryFile = path.join(appRoot, 'electron/piHostEntry.ts')
const viteConfig = path.join(appRoot, 'scripts/vite.pi-host.config.ts')
const outBundle = path.join(appRoot, 'dist-electron/pi-host.js')
const cachePath = path.join(appRoot, '.cache/pi-host-bundle.json')
const vendorRoot = path.join(appRoot, '../vendor/pi')

// 匯入解析僅追蹤帶 `.ts` 副檔名的相對匯入（electron/ 的既定慣例）；
// 指向 vendor 套件的 bare specifier 由 vendor tree hash 一併覆蓋。
const importPatterns = [
  /from\s+['"](\.[^'"]+)['"]/g,
  /\bimport\s+['"](\.[^'"]+)['"]/g,
  /\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/g,
]

async function listElectronGraphFiles(): Promise<string[]> {
  const seen = new Set<string>()
  const queue = [entryFile]
  while (queue.length > 0) {
    const current = queue.pop() as string
    const resolved = path.resolve(current)
    if (seen.has(resolved)) continue
    if (!existsSync(resolved)) continue
    seen.add(resolved)
    const source = await readFile(resolved, 'utf8')
    for (const pattern of importPatterns) {
      for (const match of source.matchAll(pattern)) {
        const specifier = (match[1] ?? '').split('?')[0]
        if (!specifier.endsWith('.ts')) continue
        queue.push(path.resolve(path.dirname(resolved), specifier))
      }
    }
  }
  return [...seen].sort()
}

async function readCache(): Promise<{ schemaVersion?: number; fingerprint?: string }> {
  try {
    return JSON.parse(await readFile(cachePath, 'utf8'))
  } catch {
    return {}
  }
}

function resolveViteVersion(): string {
  try {
    const manifest = JSON.parse(readFileSync(path.join(appRoot, 'node_modules/vite/package.json'), 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

async function computeFingerprint(): Promise<string> {
  const hash = createHash('sha256')
  hash.update(`schema:${schemaVersion}\0`)
  hash.update(`vite:${resolveViteVersion()}\0`)
  hash.update(`vendorTree:${await hashPiVendorTree(vendorRoot)}\0`)
  for (const file of [viteConfig, ...(await listElectronGraphFiles())]) {
    hash.update(`${path.relative(appRoot, file)}\0`)
    hash.update(await readFile(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function runViteBuild(): void {
  const viteBin = path.join(appRoot, 'node_modules/vite/bin/vite.js')
  if (!existsSync(viteBin)) throw new Error(`vite binary not found at ${viteBin}`)
  execFileSync(process.execPath, [viteBin, 'build', '--config', viteConfig], {
    cwd: appRoot,
    stdio: 'inherit',
  })
}

const forceBuild = process.env.SUBAGENTS_PI_HOST_BUNDLE_FORCE_BUILD === '1'
if (!forceBuild) {
  const previous = await readCache()
  if (
    previous.schemaVersion === schemaVersion
    && typeof previous.fingerprint === 'string'
    && existsSync(outBundle)
    && previous.fingerprint === (await computeFingerprint())
  ) {
    console.log('pi-host bundle is fresh; skipping vite build')
    process.exit(0)
  }
}

runViteBuild()
if (!existsSync(outBundle)) {
  throw new Error('vite build finished without dist-electron/pi-host.js')
}
await mkdir(path.dirname(cachePath), { recursive: true })
await writeFile(cachePath, `${JSON.stringify({
  schemaVersion,
  fingerprint: await computeFingerprint(),
}, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
console.log('Built pi-host bundle (fingerprint cached)')
