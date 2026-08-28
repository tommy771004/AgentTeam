import assert from 'node:assert/strict'
import { buildCliDoctorReport, sanitizeCliDoctorProviders } from '../src/agent/cliDoctor.ts'

type Probe = {
  id: string
  name: string
  foundBinary: boolean
  binaryPath: string | null
  hasAuth: boolean
  authNote: string
  notes?: string[]
}

const probes: Probe[] = [
  {
    id: 'codex',
    name: 'Codex CLI',
    foundBinary: true,
    binaryPath: 'C:/Users/test/.codex/codex.exe',
    hasAuth: false,
    authVerified: false,
    authNote: '未偵測到 Codex 登入',
    notes: ['請在 Codex CLI 完成 login'],
  },
  {
    id: 'anthropic',
    name: 'Claude Code',
    foundBinary: false,
    binaryPath: null,
    hasAuth: false,
    authVerified: false,
    authNote: '未偵測到 Claude 設定',
  },
]

const sanitized = sanitizeCliDoctorProviders([
  {
    id: 'custom',
    name: 'Custom CLI',
    authorized: true,
    cliBinary: 'custom-agent',
    apiKey: 'must-not-cross-ipc',
    baseUrl: 'https://example.invalid',
  },
])
assert.deepEqual(sanitized, [{ id: 'custom', name: 'Custom CLI', authorized: true, cliBinary: 'custom-agent' }])
assert.equal(JSON.stringify(sanitized).includes('must-not-cross-ipc'), false)

const blocked = buildCliDoctorReport({
  platform: 'win32',
  git: { found: false, path: null, version: null },
  providers: probes,
})
assert.equal(blocked.readyToRun, false)
assert.equal(blocked.checks.find((check) => check.id === 'git')?.status, 'missing')
assert.equal(blocked.checks.find((check) => check.id === 'codex')?.status, 'needs-auth')
assert.equal(blocked.checks.find((check) => check.id === 'anthropic')?.status, 'missing')
assert.match(blocked.checks.find((check) => check.id === 'git')?.remediation || '', /PATH|Git/)
assert.match(blocked.checks.find((check) => check.id === 'codex')?.remediation || '', /login|登入/)
assert.doesNotMatch(JSON.stringify(blocked), /apiKey|access_token|password|secretValue/i)

const ready = buildCliDoctorReport({
  platform: 'darwin',
  git: { found: true, path: '/usr/bin/git', version: 'git version 2.45.0' },
  providers: probes.map((probe) =>
    probe.id === 'codex' ? { ...probe, hasAuth: true, authVerified: true, authNote: '本機 CLI 管理登入' } : probe,
  ),
})
assert.equal(ready.readyToRun, true)
assert.equal(ready.checks.find((check) => check.id === 'git')?.status, 'ready')
assert.match(ready.summary, /首次任務|ready/i)
assert.ok(ready.checkedAt)

console.log('CLI doctor smoke: 2 scenarios passed')
