import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

const distDir = new URL('../dist/assets/', import.meta.url)
const assets = await readdir(distDir)
const routeChunks = assets.filter((name) => /^(SettingsPage|LearningPage|SubDesignPage)-.*\.js$/.test(name))
assert.deepEqual(
  routeChunks.map((name) => name.replace(/-.*/, '')).sort(),
  ['LearningPage', 'SettingsPage', 'SubDesignPage'],
  'production build must expose one identifiable chunk for each low-frequency route',
)

const indexHtml = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8')
const initialChunk = indexHtml.match(/src="\.\/assets\/(index-[^"]+\.js)"/)?.[1]
assert.ok(initialChunk, 'production index must identify the initial renderer chunk')
const initialBytes = (await stat(join(distDir.pathname, initialChunk))).size
assert.ok(
  initialBytes < 1_100_000,
  `initial renderer chunk must materially improve from the 1,277,330-byte baseline; got ${initialBytes}`,
)

console.log(`route lazy loading passed: initial=${initialBytes} bytes; chunks=${routeChunks.join(',')}`)
