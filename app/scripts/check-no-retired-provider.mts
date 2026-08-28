import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const retired = ['open', 'code'].join('')
const retiredSpaced = ['open', ' code'].join('')
const roots = ['src', 'electron', 'scripts']
const violations: string[] = []

function visit(path: string): void {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name)
    const name = entry.name.toLowerCase()
    if (name.includes(retired)) violations.push(relative(appRoot, full))
    if (entry.isDirectory()) visit(full)
    else if (full !== fileURLToPath(import.meta.url)) {
      const source = readFileSync(full, 'utf8').toLowerCase()
      if (source.includes(retired) || source.includes(retiredSpaced)) {
        violations.push(relative(appRoot, full))
      }
    }
  }
}

for (const root of roots) visit(join(appRoot, root))
assert.deepEqual([...new Set(violations)], [], `retired provider references remain: ${violations.join(', ')}`)
console.log('Retired external provider is absent from shipped code and executable tests')
