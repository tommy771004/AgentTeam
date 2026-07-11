/**
 * Pack multi-size PNGs into a Windows .ico (PNG-compressed entries, Vista+).
 *   node scripts/make-ico.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const iconsDir = path.resolve(__dirname, '../build/icons')
const sizes = [16, 24, 32, 48, 64, 128, 256]

function packIco(pngBuffers) {
  const count = pngBuffers.length
  const headerSize = 6
  const entrySize = 16
  const dataOffset0 = headerSize + entrySize * count

  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type = icon
  header.writeUInt16LE(count, 4)

  const entries = []
  let offset = dataOffset0
  for (const png of pngBuffers) {
    // Read IHDR for width/height
    let w = 0
    let h = 0
    if (png.length > 24 && png[0] === 0x89 && png[1] === 0x50) {
      w = png.readUInt32BE(16)
      h = png.readUInt32BE(20)
    }
    const entry = Buffer.alloc(entrySize)
    entry.writeUInt8(w >= 256 ? 0 : w, 0)
    entry.writeUInt8(h >= 256 ? 0 : h, 1)
    entry.writeUInt8(0, 2) // color palette
    entry.writeUInt8(0, 3) // reserved
    entry.writeUInt16LE(1, 4) // color planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += png.length
  }

  return Buffer.concat([header, ...entries, ...pngBuffers])
}

const pngs = []
for (const s of sizes) {
  const p = path.join(iconsDir, `icon-${s}.png`)
  if (!fs.existsSync(p)) {
    console.warn('skip missing', p)
    continue
  }
  pngs.push(fs.readFileSync(p))
}
if (!pngs.length) {
  console.error('No PNGs found in', iconsDir)
  process.exit(1)
}

const ico = packIco(pngs)
const outIco = path.join(iconsDir, 'icon.ico')
const buildRootIco = path.resolve(__dirname, '../build/icon.ico')
const buildRootPng = path.resolve(__dirname, '../build/icon.png')

fs.writeFileSync(outIco, ico)
fs.writeFileSync(buildRootIco, ico)
// electron-builder also looks at buildResources root for icon.png
fs.copyFileSync(path.join(iconsDir, 'icon-256.png'), buildRootPng)
fs.copyFileSync(path.join(iconsDir, 'icon-256.png'), path.join(iconsDir, 'icon.png'))

console.log('wrote', outIco, `(${ico.length} bytes, ${pngs.length} sizes)`)
console.log('wrote', buildRootIco)
console.log('wrote', buildRootPng)
