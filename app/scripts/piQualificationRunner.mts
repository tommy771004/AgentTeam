import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const PI_GATE_NAMES = [
  'ledgerReconciled', 'upstreamTests', 'protocolCompatibility',
  'equivalentToolParity', 'settingsSessionMigration', 'electronSmoke',
  'recovery', 'security', 'packaging',
] as const

export type PiGateName = typeof PI_GATE_NAMES[number]
export type PiQualificationBinding = {
  toCommit: string
  treeSha256: string
  artifactSha256: string
}
export type PiGateResult = PiQualificationBinding & {
  schemaVersion: 1
  gate: PiGateName
  profile: 'production' | 'test-only'
  command: { executable: string; args: string[]; cwd: string }
  commandSha256: string
  startedAt: string
  completedAt: string
  exitCode: number
  logPath: string
  logSha256: string
  passed: boolean
}

type GateCommand = { executable: string; args: string[]; cwd: string }

const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const nodeSmoke = (appRoot: string, script: string): GateCommand => ({
  executable: process.execPath,
  args: ['--experimental-strip-types', path.join(appRoot, 'scripts', script)],
  cwd: appRoot,
})

function productionCommands(appRoot: string, repositoryRoot: string): Record<PiGateName, GateCommand> {
  return {
    ledgerReconciled: nodeSmoke(appRoot, 'smoke-pi-core-vendor.mts'),
    upstreamTests: { executable: process.platform === 'win32' ? 'bash.exe' : 'bash', args: ['test.sh'], cwd: path.join(repositoryRoot, 'vendor/pi') },
    protocolCompatibility: nodeSmoke(appRoot, 'smoke-pi-host-protocol.mts'),
    equivalentToolParity: nodeSmoke(appRoot, 'smoke-pi-parity-qualification.mts'),
    settingsSessionMigration: nodeSmoke(appRoot, 'smoke-pi-settings-migration.mts'),
    electronSmoke: nodeSmoke(appRoot, 'smoke-pi-electron-cutover.mts'),
    recovery: { executable: process.execPath, args: [path.join(appRoot, 'scripts/smoke-recovery-e2e.mjs')], cwd: appRoot },
    security: nodeSmoke(appRoot, 'smoke-security.mts'),
    packaging: nodeSmoke(appRoot, 'smoke-pi-packaging.mts'),
  }
}

function testCommands(appRoot: string): Record<PiGateName, GateCommand> {
  return Object.fromEntries(PI_GATE_NAMES.map((gate) => [gate, {
    executable: process.execPath,
    args: ['-e', `process.stdout.write(${JSON.stringify(`test-only ${gate}\n`)})`],
    cwd: appRoot,
  }])) as Record<PiGateName, GateCommand>
}

/** Execute every fixed gate and bind its log to the exact Pi source and artifact. */
export async function runPiQualificationGates(input: {
  appRoot: string
  repositoryRoot: string
  logDir: string
  binding: PiQualificationBinding
  profile?: 'production' | 'test-only'
}): Promise<Record<PiGateName, PiGateResult>> {
  const profile = input.profile || 'production'
  const commands = profile === 'production'
    ? productionCommands(input.appRoot, input.repositoryRoot)
    : testCommands(input.appRoot)
  await mkdir(input.logDir, { recursive: true })
  const results = {} as Record<PiGateName, PiGateResult>
  for (const gate of PI_GATE_NAMES) {
    const command = commands[gate]
    const startedAt = new Date().toISOString()
    const execution = spawnSync(command.executable, command.args, {
      cwd: command.cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
    const completedAt = new Date().toISOString()
    const exitCode = execution.status ?? 1
    const log = [execution.stdout || '', execution.stderr || '', execution.error?.stack || ''].filter(Boolean).join('\n')
    const logPath = path.join(input.logDir, `${gate}.log`)
    await writeFile(logPath, log, { encoding: 'utf8', mode: 0o600 })
    results[gate] = {
      schemaVersion: 1,
      gate,
      profile,
      command: { ...command, args: [...command.args] },
      commandSha256: hash(JSON.stringify(command)),
      startedAt,
      completedAt,
      exitCode,
      logPath: path.relative(input.repositoryRoot, logPath),
      logSha256: hash(log),
      ...input.binding,
      passed: exitCode === 0,
    }
    if (exitCode !== 0 && profile === 'production') break
  }
  return results
}
