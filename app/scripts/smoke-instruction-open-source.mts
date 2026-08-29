import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openInstructionSource, InstructionSourceOpenError } from '../electron/instructionSourceOpen.ts'
import { resolveInstructionSnapshot } from '../electron/instructionResolver.ts'

const root = await mkdtemp(join(tmpdir(), 'agentstudio-instruction-open-'))
const outside = await mkdtemp(join(tmpdir(), 'agentstudio-instruction-open-outside-'))
const projectA = join(root, 'project-a')
const projectB = join(root, 'project-b')
await Promise.all([mkdir(projectA), mkdir(projectB)])
const openCalls: string[] = []
try {
  const agentsA = join(projectA, 'AGENTS.md')
  const claudeA = join(projectA, 'CLAUDE.md')
  const outsideFile = join(outside, 'secret.md')
  await writeFile(agentsA, 'PROJECT_A_PRIMARY')
  await writeFile(claudeA, 'PROJECT_A_SHADOWED')
  await writeFile(outsideFile, 'OUTSIDE_SECRET')
  await symlink(outsideFile, join(projectA, 'FALLBACK.md'))
  const canonicalAgentsA = await realpath(agentsA)

  const projectionA = await resolveInstructionSnapshot({ globalRevision: 4, globalCustomInstructions: 'GLOBAL_A', projectRoot: projectA, workPath: projectA, fallbackFilenames: ['FALLBACK.md'] })
  const shadowed = projectionA.sources.find((source) => source.path?.endsWith('/CLAUDE.md'))
  assert.equal(shadowed?.shadowed, true)
  assert.equal(shadowed?.metadataStatus, 'content')
  assert.equal(shadowed?.openable, true)
  assert.equal(shadowed?.bytes, Buffer.byteLength('PROJECT_A_SHADOWED'))
  assert.equal(shadowed?.hash, createHash('sha256').update('PROJECT_A_SHADOWED').digest('hex'))
  assert.equal(shadowed?.content, '')
  assert.ok(!projectionA.effectiveText.includes('PROJECT_A_SHADOWED'))

  const escaped = projectionA.sources.find((source) => source.path?.endsWith('/secret.md'))
  assert.equal(escaped?.shadowed, true)
  assert.equal(escaped?.metadataStatus, 'unauthorized')
  assert.equal(escaped?.openable, false)
  assert.ok(projectionA.diagnostics.some((diagnostic) => diagnostic.code === 'unauthorized'))
  assert.ok(!projectionA.effectiveText.includes('OUTSIDE_SECRET'))

  const resolveA = () => resolveInstructionSnapshot({ globalRevision: 4, globalCustomInstructions: 'GLOBAL_A', projectRoot: projectA, workPath: projectA, fallbackFilenames: ['FALLBACK.md'] })
  const opened = await openInstructionSource({ projectRoot: projectA, workPath: projectA, path: agentsA, resolveCurrent: resolveA, shellOpen: async (path) => { openCalls.push(path); return '' } })
  assert.equal(opened.ok, true)
  assert.equal(opened.path, canonicalAgentsA)
  assert.deepEqual(openCalls, [canonicalAgentsA])

  await assert.rejects(
    openInstructionSource({ projectRoot: projectA, workPath: projectA, path: agentsA, resolveCurrent: () => resolveInstructionSnapshot({ globalRevision: 4, globalCustomInstructions: 'GLOBAL_B', projectRoot: projectB, workPath: projectB }), shellOpen: async () => '' }),
    (error: unknown) => error instanceof InstructionSourceOpenError && error.code === 'not_current_source',
    'a stale project source must not open after project switch',
  )
  await assert.rejects(
    openInstructionSource({ projectRoot: projectA, workPath: projectA, path: agentsA, resolveCurrent: resolveA, shellOpen: async () => 'editor unavailable' }),
    (error: unknown) => error instanceof InstructionSourceOpenError && error.code === 'open_failed',
  )
  await assert.rejects(
    openInstructionSource({ projectRoot: projectA, workPath: projectA, path: agentsA, resolveCurrent: resolveA, shellOpen: async () => { throw new Error('editor crashed') } }),
    (error: unknown) => error instanceof InstructionSourceOpenError && error.code === 'open_failed',
  )

  await writeFile(agentsA, 'PROJECT_A_CHANGED')
  await assert.rejects(
    openInstructionSource({ projectRoot: projectA, workPath: projectA, path: agentsA, resolveCurrent: async () => {
      const stale = await resolveInstructionSnapshot({ globalRevision: 4, globalCustomInstructions: 'GLOBAL_A', projectRoot: projectA, workPath: projectA, fallbackFilenames: ['FALLBACK.md'] })
      await writeFile(agentsA, 'PROJECT_A_CHANGED_AGAIN')
      return stale
    }, shellOpen: async () => '' }),
    (error: unknown) => error instanceof InstructionSourceOpenError && error.code === 'stale_source',
  )
  assert.equal(await readFile(agentsA, 'utf8'), 'PROJECT_A_CHANGED_AGAIN')
} finally {
  await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })])
}

console.log('instruction source open contract: shadowed metadata, canonical safety, fresh membership and shell failures passed')
