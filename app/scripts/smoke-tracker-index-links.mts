import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Tracker truth reconciliation issue 01 — INDEX.md never dead-ends.
 *
 * The map a maintainer plans from is `.scratch/INDEX.md`. When it references a
 * path that no longer exists, nothing errors: the tracker renders, tickets read
 * fine, and the rot compounds daily — exactly how two deleted directories kept
 * directing work for weeks. This guard closes that hole with one machine-checkable
 * invariant: every relative path linked from INDEX.md must exist on disk, files
 * and directories alike. No allowlist; an INDEX cannot grow a silent exception pile.
 *
 * The failure message lists the exact offending paths so a red build needs no
 * reverse-engineering.
 */

export function extractRelativeLinkTargets(markdown: string): string[] {
  const targets: string[] = []
  for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = match[1].trim()
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1)
    // Drop a markdown title ("(path "title")") and any #fragment.
    target = target.split(/\s+/)[0] ?? ''
    target = target.split('#')[0]
    if (!target) continue
    if (/^(https?:|mailto:|mailto\b|#|\/\/)/i.test(target)) continue
    targets.push(target)
  }
  return [...new Set(targets)]
}

export function findDeadPaths(
  markdown: string,
  baseDir: string,
  exists: (path: string) => boolean = existsSync,
): string[] {
  return extractRelativeLinkTargets(markdown).filter((target) => {
    const resolved = resolve(baseDir, target)
    return !exists(resolved)
  })
}

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

console.log('smoke-tracker-index-links')

const scratch = await mkdtemp(join(tmpdir(), 'index-links-'))
try {
  const existingFile = join(scratch, 'real', 'spec.md')
  await mkdir(join(scratch, 'real', 'issues'), { recursive: true })
  await writeFile(existingFile, '# real\n')
  await writeFile(join(scratch, 'real', 'issues', '01-a.md'), '# ticket\n')

  test('a dead relative path fails and the message names it', () => {
    const dead = findDeadLinksForTest('see [spec](ghost/spec.md)', scratch)
    assert.deepEqual(dead, ['ghost/spec.md'])
    assert.throws(() => assertIndexHealthy('see [spec](ghost/spec.md)', scratch), /ghost\/spec\.md/)
  })

  test('all-existing references pass', () => {
    assert.deepEqual(findDeadLinksForTest('see [spec](real/spec.md) and [t](real/issues/01-a.md)', scratch), [])
    assertIndexHealthy('see [spec](real/spec.md)', scratch)
  })

  test('a reference to a deleted DIRECTORY also fails (this effort\u2019s original case shape)', () => {
    const md = 'frontier [row](removed-effort/issues/05-x.md) and [spec](removed-effort/spec.md)'
    const dead = findDeadLinksForTest(md, scratch)
    assert.deepEqual(dead.sort(), ['removed-effort/issues/05-x.md', 'removed-effort/spec.md'])
  })

  test('external links, anchors and fragments do not count as paths', () => {
    const md = [
      '[site](https://example.com/x)',
      '[mail](mailto:a@b.c)',
      '[anchor](#section)',
      '[file-with-anchor](real/spec.md#heading)',
    ].join('\n')
    assert.deepEqual(findDeadLinksForTest(md, scratch), [])
  })

  test('the same dead path twice is reported once (dedupe, stable message)', () => {
    const md = '[a](ghost/spec.md) [b](ghost/spec.md)'
    assert.deepEqual(findDeadLinksForTest(md, scratch), ['ghost/spec.md'])
  })

  function findDeadLinksForTest(md: string, base: string) {
    return findDeadPaths(md, base)
  }
  function assertIndexHealthy(md: string, base: string) {
    const dead = findDeadPaths(md, base)
    assert.deepEqual(
      dead,
      [],
      `.scratch/INDEX.md references paths that do not exist (fix the link or record the fate in text): ${dead.join(', ')}`,
    )
  }

  // ── The real map ──────────────────────────────────────────────────────────
  const repoRoot = resolve(import.meta.dirname, '../..')
  const indexPath = join(repoRoot, '.scratch', 'INDEX.md')
  const indexMd = await import('node:fs/promises').then((m) => m.readFile(indexPath, 'utf8'))
  test('the real .scratch/INDEX.md has zero dead relative paths', () => {
    assertIndexHealthy(indexMd, join(repoRoot, '.scratch'))
  })

  console.log(`smoke-tracker-index-links passed (${passed} checks): every relative path referenced from .scratch/INDEX.md exists`)
} finally {
  await rm(scratch, { recursive: true, force: true })
}
