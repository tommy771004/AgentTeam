export type CliDoctorProviderProbe = {
  id: string
  name: string
  foundBinary: boolean
  binaryPath: string | null
  hasAuth: boolean
  /** True only when a provider-specific, read-only auth probe confirms login. */
  authVerified?: boolean
  authNote: string
  notes?: string[]
}

export type CliDoctorCheckStatus = 'ready' | 'missing' | 'needs-auth'

export type CliDoctorCheck = {
  id: string
  label: string
  status: CliDoctorCheckStatus
  detail: string
  remediation: string
  retryable: true
}

export type CliDoctorReport = {
  platform: string
  checkedAt: string
  readyToRun: boolean
  summary: string
  checks: CliDoctorCheck[]
}

export type CliDoctorInput = {
  platform?: string
  git: {
    found: boolean
    path: string | null
    version: string | null
  }
  providers: CliDoctorProviderProbe[]
}

export type CliDoctorConfiguredProvider = {
  id: string
  name: string
  authorized: boolean
  cliBinary?: string
}

/** Keep doctor IPC input diagnostic-only; never forward BYOK secrets. */
export function sanitizeCliDoctorProviders(input: unknown[]): CliDoctorConfiguredProvider[] {
  return input.flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const provider = value as Record<string, unknown>
    const id = String(provider.id || '').trim()
    if (!id) return []
    const name = String(provider.name || id).trim() || id
    const cliBinary = String(provider.cliBinary || '').trim()
    return [{
      id,
      name,
      authorized: Boolean(provider.authorized),
      ...(cliBinary ? { cliBinary } : {}),
    }]
  })
}

const providerBinaryNames: Record<string, string> = {
  codex: 'codex',
  anthropic: 'claude',
  opencode: 'opencode',
  google: 'gemini',
  cursor: 'cursor-agent',
  grok: 'grok',
}

function platformLabel(platform: string) {
  if (platform === 'win32') return 'Windows'
  if (platform === 'darwin') return 'macOS'
  if (platform === 'linux') return 'Linux'
  return platform || '本機平台'
}

export function buildCliDoctorReport(input: CliDoctorInput): CliDoctorReport {
  const platform = input.platform || 'unknown'
  const checks: CliDoctorCheck[] = []
  if (input.git.found) {
    checks.push({
      id: 'git',
      label: 'Git',
      status: 'ready',
      detail: input.git.version || input.git.path || '已找到 Git',
      remediation: 'Git 已可用。',
      retryable: true,
    })
  } else {
    checks.push({
      id: 'git',
      label: 'Git',
      status: 'missing',
      detail: '找不到 git 執行檔。',
      remediation: `請在${platformLabel(platform)}安裝 Git，並確認 git 已加入 PATH；完成後重新檢查。`,
      retryable: true,
    })
  }

  for (const provider of input.providers) {
    const binaryName = providerBinaryNames[provider.id] || provider.id
    if (!provider.foundBinary) {
      checks.push({
        id: provider.id,
        label: provider.name,
        status: 'missing',
        detail: `找不到 ${binaryName} 執行檔。`,
        remediation: `請安裝 ${provider.name}，確認可在終端機執行 ${binaryName} 並加入 PATH；完成後重新檢查。`,
        retryable: true,
      })
      continue
    }
    if (!provider.hasAuth || provider.authVerified !== true) {
      checks.push({
        id: provider.id,
        label: provider.name,
        status: 'needs-auth',
        detail: provider.authNote || '尚未偵測到登入狀態。',
        remediation: `請在 ${provider.name} 自有 CLI 完成登入；本 App 不讀取或複製 token，完成後重新檢查。`,
        retryable: true,
      })
      continue
    }
    checks.push({
      id: provider.id,
      label: provider.name,
      status: 'ready',
      detail: provider.binaryPath ? `binary: ${provider.binaryPath}` : 'CLI 與本機設定已找到。',
      remediation: '可用於首次任務。',
      retryable: true,
    })
  }

  const availableProviderCount = checks.filter((check) => check.id !== 'git' && check.status !== 'missing').length
  const verifiedProviderCount = checks.filter((check) => check.id !== 'git' && check.status === 'ready').length
  const readyToRun = input.git.found && availableProviderCount > 0
  const summary = readyToRun
    ? `環境檢查完成：Git 可用，${availableProviderCount} 個 CLI 可嘗試首次任務${verifiedProviderCount ? `（${verifiedProviderCount} 個已確認登入）` : '；需登入項目請依指引完成登入'}。`
    : '環境尚未就緒：請依下方指引修正後重新檢查。'
  return {
    platform,
    checkedAt: new Date().toISOString(),
    readyToRun,
    summary,
    checks,
  }
}
