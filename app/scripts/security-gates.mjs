/**
 * Issue 06 — release qualification 安全門檻（pure helpers + CLI）。
 * - evaluateDependencyAudit：npm audit --json 結果，high/critical 未被例外覆蓋 → fail
 * - scanTextForSecrets / scanDirectoryForSecrets：高訊號憑證 pattern 掃描
 * - loadSecurityExceptions：例外需 scope/id/reason/approvedBy/expires，過期即失效
 * release-evidence.mjs 會把結果寫入 manifest.security；smoke-security.mts 驗證邏輯。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function loadSecurityExceptions(jsonText) {
  let parsed
  try {
    parsed = JSON.parse(jsonText || '[]')
  } catch (e) {
    return { valid: [], invalid: [{ error: `unparseable exceptions file: ${e.message}` }] }
  }
  const valid = []
  const invalid = []
  const now = Date.now()
  for (const entry of Array.isArray(parsed) ? parsed : []) {
    const missing = ['scope', 'id', 'reason', 'approvedBy', 'expires'].filter(
      (k) => !entry?.[k] || String(entry[k]).trim() === '',
    )
    if (missing.length) {
      invalid.push({ ...entry, error: `missing ${missing.join(', ')}` })
      continue
    }
    if (!['dependency-audit', 'secret-scan'].includes(entry.scope)) {
      invalid.push({ ...entry, error: `unknown scope ${entry.scope}` })
      continue
    }
    const expires = Date.parse(entry.expires)
    if (!Number.isFinite(expires)) {
      invalid.push({ ...entry, error: 'invalid expires timestamp' })
      continue
    }
    if (expires <= now) {
      invalid.push({ ...entry, error: 'expired' })
      continue
    }
    valid.push(entry)
  }
  return { valid, invalid }
}

const BLOCKING_SEVERITIES = new Set(['high', 'critical'])

export function evaluateDependencyAudit(auditReport, exceptions = []) {
  // Fail closed：空殼 / 格式錯誤的報告（npm audit 失敗仍產檔）不得默默放行
  if (!auditReport?.metadata?.vulnerabilities) {
    return {
      ok: false,
      counts: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 },
      failures: [{ package: '(audit report)', severity: 'malformed-or-empty' }],
      exceptionsApplied: [],
    }
  }
  const counts = auditReport.metadata.vulnerabilities
  const active = exceptions.filter(
    (e) => e.scope === 'dependency-audit' && Date.parse(e.expires) > Date.now(),
  )
  const exceptedIds = new Set(active.map((e) => e.id))
  const failures = []
  const exceptionsApplied = []
  for (const [name, vuln] of Object.entries(auditReport?.vulnerabilities || {})) {
    if (!BLOCKING_SEVERITIES.has(vuln?.severity)) continue
    if (exceptedIds.has(name)) {
      exceptionsApplied.push(name)
    } else {
      failures.push({ package: name, severity: vuln.severity })
    }
  }
  return {
    ok: failures.length === 0,
    counts: {
      info: counts.info || 0,
      low: counts.low || 0,
      moderate: counts.moderate || 0,
      high: counts.high || 0,
      critical: counts.critical || 0,
    },
    failures,
    exceptionsApplied,
  }
}

/** 高訊號 pattern：長隨機 token 前綴 / 金鑰檔頭。低訊號（generic password=）刻意不掃，避免誤報。 */
const SECRET_PATTERNS = [
  { id: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b/g },
  { id: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'private-key-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { id: 'openai-anthropic-key', re: /\bsk-(?:ant-|proj-|live-)?[A-Za-z0-9_-]{20,}\b/g },
  { id: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'telegram-bot-token', re: /\b\d{8,10}:AA[A-Za-z0-9_-]{30,}\b/g },
]

export function scanTextForSecrets(text, { path: filePath = '' } = {}) {
  const findings = []
  for (const { id, re } of SECRET_PATTERNS) {
    re.lastIndex = 0
    let match
    while ((match = re.exec(text || '')) !== null) {
      const line = (text.slice(0, match.index).match(/\n/g) || []).length + 1
      findings.push({ pattern: id, path: filePath, line })
    }
  }
  return findings
}

const DEFAULT_SCAN_EXTENSIONS = new Set([
  '.ts', '.tsx', '.mts', '.mjs', '.js', '.cjs', '.json', '.md', '.html', '.yml', '.yaml', '.env',
])

export async function scanDirectoryForSecrets(dir, { extensions = DEFAULT_SCAN_EXTENSIONS, ignore = ['node_modules', '.git', 'release'] } = {}) {
  const findings = []
  async function walk(current) {
    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (ignore.includes(entry.name)) continue
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute)
      } else if (extensions.has(path.extname(entry.name)) || entry.name === '.env') {
        const text = await fs.readFile(absolute, 'utf8').catch(() => '')
        findings.push(...scanTextForSecrets(text, { path: path.relative(dir, absolute).replaceAll('\\', '/') }))
      }
    }
  }
  await walk(dir)
  return findings
}

export function applySecretScanExceptions(findings, exceptions = []) {
  const active = new Set(
    exceptions
      .filter((e) => e.scope === 'secret-scan' && Date.parse(e.expires) > Date.now())
      .map((e) => e.id),
  )
  const remaining = findings.filter((f) => !active.has(f.path))
  return { ok: remaining.length === 0, remaining, excepted: findings.length - remaining.length }
}

// ── CLI: node security-gates.mjs [--dir <path>] [--audit-report <json>] [--exceptions <json>] ──
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2)
  const value = (name) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const exceptionsPath = value('--exceptions') || path.join(appRoot, '..', 'docs', 'security-exceptions.json')
  const exceptionsText = await fs.readFile(exceptionsPath, 'utf8').catch(() => '[]')
  const { valid: exceptions, invalid } = loadSecurityExceptions(exceptionsText)
  if (invalid.length) {
    console.error('Invalid security exceptions:', JSON.stringify(invalid, null, 2))
    process.exit(1)
  }

  let failed = false
  const auditPath = value('--audit-report')
  if (auditPath) {
    const audit = JSON.parse(await fs.readFile(auditPath, 'utf8'))
    const result = evaluateDependencyAudit(audit, exceptions)
    console.log('dependency-audit:', JSON.stringify({ ok: result.ok, counts: result.counts, failures: result.failures, exceptionsApplied: result.exceptionsApplied }))
    if (!result.ok) failed = true
  }

  const scanDirs = value('--dir') ? [value('--dir')] : [path.join(appRoot, 'src'), path.join(appRoot, 'electron'), path.join(appRoot, 'scripts')]
  for (const dir of scanDirs) {
    const findings = await scanDirectoryForSecrets(dir)
    const result = applySecretScanExceptions(
      findings.map((f) => ({ ...f, path: `${path.relative(appRoot, dir).replaceAll('\\', '/')}/${f.path}` })),
      exceptions,
    )
    if (!result.ok) {
      console.error('secret-scan findings:', JSON.stringify(result.remaining, null, 2))
      failed = true
    }
  }

  if (failed) {
    console.error('security-gates: FAILED')
    process.exit(1)
  }
  console.log('security-gates: OK')
}
