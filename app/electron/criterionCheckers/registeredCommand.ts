import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { captureReviewWorkspaceAdmission } from '../reviewWorkspaceBinding.ts'

export type RegisteredVerificationCommandId = 'project:build' | 'project:lint' | 'project:smoke' | 'project:test'

export type RegisteredCommandExecution = Readonly<{
  registryId: string
  command: string
  args: readonly string[]
  cwd: string
  workspaceRevision?: string
  finalWorkspaceRevision?: string
  exitCode?: number
  outputSha256?: string
  unavailableReason?: string
}>

const REGISTRY: Readonly<Record<RegisteredVerificationCommandId, Readonly<{ script: 'build' | 'lint' | 'smoke' | 'test' }>>> = Object.freeze({
  'project:build': { script: 'build' },
  'project:lint': { script: 'lint' },
  'project:smoke': { script: 'smoke' },
  'project:test': { script: 'test' },
})

export const TEST_SUITE_COMMAND_IDS = Object.freeze({
  build: 'project:build',
  lint: 'project:lint',
  smoke: 'project:smoke',
  test: 'project:test',
} satisfies Record<'build' | 'lint' | 'smoke' | 'test', RegisteredVerificationCommandId>)

export function registeredVerificationCommandIds(): readonly RegisteredVerificationCommandId[] {
  return Object.freeze(Object.keys(REGISTRY) as RegisteredVerificationCommandId[])
}

function resolveScript(workspaceRoot: string, registryId: string): { command: string; args: string[]; cwd: string } | undefined {
  const entry = REGISTRY[registryId as RegisteredVerificationCommandId]
  if (!entry) return undefined
  for (const cwd of [workspaceRoot, resolve(workspaceRoot, 'app')]) {
    const packagePath = resolve(cwd, 'package.json')
    if (!existsSync(packagePath)) continue
    try {
      const scripts = (JSON.parse(readFileSync(packagePath, 'utf8')) as { scripts?: Record<string, unknown> }).scripts
      if (typeof scripts?.[entry.script] === 'string') return { command: 'npm', args: ['run', entry.script], cwd }
    } catch { /* malformed package metadata is an unavailable registered command */ }
  }
  return undefined
}

async function workspaceRevision(workspaceRoot: string, identity: string): Promise<string | undefined> {
  const admission = await captureReviewWorkspaceAdmission({ runId: identity, projectRoot: workspaceRoot, runnerKind: 'builtin' })
  return admission.canonical ? admission.baseline?.workingRevision : undefined
}

export async function executeRegisteredVerificationCommand(input: {
  registryId: string
  workspaceRoot: string
  timeoutMs?: number
}): Promise<RegisteredCommandExecution> {
  const script = resolveScript(input.workspaceRoot, input.registryId)
  if (!script) return {
    registryId: input.registryId, command: '', args: [], cwd: input.workspaceRoot,
    unavailableReason: REGISTRY[input.registryId as RegisteredVerificationCommandId]
      ? 'Registered package script is unavailable' : 'Command id is not present in the Host registry',
  }
  const revision = await workspaceRevision(input.workspaceRoot, `criterion:${input.registryId}:before`)
  const hash = createHash('sha256')
  const exitCode = await new Promise<number | undefined>((done) => {
    const child = spawn(script.command, script.args, { cwd: script.cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = setTimeout(() => child.kill('SIGTERM'), Math.max(1_000, Math.min(input.timeoutMs || 10 * 60_000, 30 * 60_000)))
    child.stdout.on('data', (chunk: Buffer) => hash.update(chunk))
    child.stderr.on('data', (chunk: Buffer) => hash.update(chunk))
    child.once('error', () => { clearTimeout(timer); done(undefined) })
    child.once('close', (code) => { clearTimeout(timer); done(code ?? undefined) })
  })
  const finalRevision = await workspaceRevision(input.workspaceRoot, `criterion:${input.registryId}:after`)
  return {
    registryId: input.registryId,
    ...script,
    ...(revision ? { workspaceRevision: revision } : {}),
    ...(finalRevision ? { finalWorkspaceRevision: finalRevision } : {}),
    ...(exitCode === undefined ? { unavailableReason: 'Registered command could not be executed' } : { exitCode, outputSha256: hash.digest('hex') }),
  }
}
