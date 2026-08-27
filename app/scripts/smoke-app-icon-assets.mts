import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const appRoot = resolve(import.meta.dirname, '..')
const read = (relative: string): Buffer => readFileSync(resolve(appRoot, relative))
const master = read('build/icons/icon.svg')
const svg = master.toString('utf8')

assert.match(svg, /viewBox="0 0 1024 1024"/)
assert.match(svg, /x="80" y="80" width="864" height="864" rx="216" fill="#0075DE"/)
assert.match(svg, /M377 377H620M377 377V647/)
assert.match(svg, /fill="#FFFFFF"/)
assert.equal((svg.match(/fill="#D6E5F9"/g) ?? []).length, 2, 'the two connected secondary nodes stay ice blue')
assert.equal((svg.match(/fill="#FEB10F"/g) ?? []).length, 1, 'the independent candidate stays amber')
assert.doesNotMatch(svg, /(?:linearGradient|radialGradient|filter|shadow|blur)/i, 'the app icon stays flat and deterministic')

const pngSize = (relative: string): [number, number] => {
  const png = read(relative)
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${relative} must be PNG`)
  return [png.readUInt32BE(16), png.readUInt32BE(20)]
}
for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
  assert.deepEqual(pngSize(`build/icons/icon-${size}.png`), [size, size], `missing ${size}px app icon`)
}

const ico = read('build/icon.ico')
const icoEntries = ico.readUInt16LE(4)
assert.equal(icoEntries, 7, 'Windows icon must retain seven resolution layers')
const icoSizes = Array.from({ length: icoEntries }, (_, index) => {
  const offset = 6 + index * 16
  return ico[offset] || 256
})
assert.deepEqual(icoSizes, [16, 24, 32, 48, 64, 128, 256])

assert.deepEqual(read('public/favicon.svg'), master, 'favicon master must match the application icon')
assert.deepEqual(read('public/brand/subagents-icon.svg'), master, 'public brand master must match the application icon')
assert.deepEqual(read('src/assets/subagents-icon.svg'), master, 'renderer master must match the application icon')

const packageJson = JSON.parse(read('package.json').toString('utf8')) as { build?: { mac?: { icon?: string } } }
assert.equal(packageJson.build?.mac?.icon, 'icons/icon-1024.png', 'macOS packaging must consume the high-resolution source')

console.log('app icon assets passed: flat SVG master, 9 PNG sizes, 7 ICO layers, 1024px macOS source')
