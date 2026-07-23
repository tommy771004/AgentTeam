import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

export const PI_PIN_FILE = 'PI_UPSTREAM_PIN.json'
export const PI_LEDGER_FILE = 'PI_CORE_PATCH_LEDGER.md'

export async function listPiVendorFiles(root: string): Promise<string[]> {
  const files: string[] = []
  async function visit(directory: string, prefix = ''): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (relative === PI_PIN_FILE || relative === PI_LEDGER_FILE) continue
      if (relative.split('/').includes('node_modules')) continue
      if (entry.name === 'dist' || entry.name === '.DS_Store') continue
      if (relative === 'packages/ai/src/providers/data' || relative.startsWith('packages/ai/src/providers/data/')) continue
      const absolute = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Symlinks are not allowed in vendored Pi trees: ${relative}`)
      if (entry.isDirectory()) await visit(absolute, relative)
      else if (entry.isFile()) files.push(relative)
    }
  }
  await visit(root)
  return files.sort()
}

export async function hashPiVendorTree(root: string, pathPrefix = 'vendor/pi/'): Promise<string> {
  const hash = createHash('sha256')
  for (const relative of await listPiVendorFiles(root)) {
    hash.update(`${pathPrefix}${relative}\0`)
    hash.update(await readFile(path.join(root, relative)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

export async function diffPiVendorTrees(left: string, right: string): Promise<string[]> {
  const files = new Set([
    ...(await listPiVendorFiles(left)),
    ...(await listPiVendorFiles(right)),
  ])
  const differences: string[] = []
  for (const relative of [...files].sort()) {
    let leftBytes: Buffer | undefined
    let rightBytes: Buffer | undefined
    try { leftBytes = await readFile(path.join(left, relative)) } catch { /* missing */ }
    try { rightBytes = await readFile(path.join(right, relative)) } catch { /* missing */ }
    if (!leftBytes || !rightBytes || !leftBytes.equals(rightBytes)) differences.push(relative)
  }
  return differences
}
