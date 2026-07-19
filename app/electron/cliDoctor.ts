import { buildCliDoctorReport, type CliDoctorProviderProbe, type CliDoctorReport } from '../src/agent/cliDoctor'
import { discoverLocalClis } from './cliDiscover'
import { runBash } from './shellBridge'
import { executableLookupCommand, firstExecutablePath } from './platformProcess'

type ConfiguredProvider = Record<string, unknown>

export async function runCliDoctor(
  currentProviders: ConfiguredProvider[] = [],
): Promise<CliDoctorReport> {
  const [gitProbe, discovery] = await Promise.all([
    probeGit(),
    discoverLocalClis(),
  ])
  const discovered = discovery.clis.map<CliDoctorProviderProbe>((cli) => ({
    id: cli.id,
    name: cli.name,
    foundBinary: cli.foundBinary,
    binaryPath: cli.binaryPath,
    hasAuth: cli.hasAuth,
    // Discovery only sees local markers; it must not claim a valid/active login.
    authVerified: false,
    authNote: cli.authNote,
    notes: cli.notes,
  }))
  const discoveredIds = new Set(discovered.map((cli) => cli.id))
  for (const provider of currentProviders) {
    const id = String(provider.id || '').trim()
    const configuredBinary = String(provider.cliBinary || '').trim()
    if (!id || discoveredIds.has(id) || !configuredBinary) continue
    discovered.push({
      id,
      name: String(provider.name || id),
      foundBinary: false,
      binaryPath: null,
      hasAuth: Boolean(provider.authorized),
      authNote: provider.authorized ? '已由設定標記授權；尚未找到 CLI binary。' : '尚未授權。',
    })
  }
  return buildCliDoctorReport({
    platform: process.platform,
    git: gitProbe,
    providers: discovered,
  })
}

async function probeGit(): Promise<{
  found: boolean
  path: string | null
  version: string | null
}> {
  const lookup = await runBash({
    command: executableLookupCommand('git'),
    timeoutMs: 4000,
  })
  const path = firstExecutablePath(lookup.stdout)
  if (!lookup.ok || !path) return { found: false, path: null, version: null }
  const versionResult = await runBash({ command: 'git --version', timeoutMs: 4000 })
  return {
    found: true,
    path,
    version: versionResult.ok ? versionResult.stdout.trim().split(/\r?\n/)[0] || null : null,
  }
}
