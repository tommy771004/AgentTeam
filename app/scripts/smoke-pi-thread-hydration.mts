import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const source = await readFile(resolve(import.meta.dirname, '../src/store/threadStore.ts'), 'utf8')
assert.match(
  source,
  /if \(piHostCanonical\(\) && get\(\)\.threads\.length > 0\) return/,
  'canonical Pi Host remounts must preserve the live conversation projection',
)

console.log('Pi Host canonical remount preserves the live conversation projection')
