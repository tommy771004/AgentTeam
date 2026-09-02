import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { runBash } from './shellBridge.ts'
import { quoteShellArg } from './platformProcess.ts'
import { capabilitiesFromCliHelp, type CliProviderCapabilitySnapshot } from '../src/agent/cliProviderCapabilities.ts'

type Cached = { key: string; snapshot: CliProviderCapabilitySnapshot }
const cache = new Map<string, Cached>()

function providerKey(provider: string): string {
  return provider === 'anthropic' ? 'claude' : provider === 'google' ? 'gemini' : provider
}

function cacheKey(binaryPath: string): string {
  try {
    const stat = fs.statSync(binaryPath)
    return `${fs.realpathSync(binaryPath)}:${stat.size}:${stat.mtimeMs}`
  } catch {
    return binaryPath
  }
}

export async function inspectCliProviderCapabilities(
  provider: string,
  binaryPath: string,
): Promise<CliProviderCapabilitySnapshot> {
  const normalizedProvider = providerKey(provider)
  const key = cacheKey(binaryPath)
  const existing = cache.get(normalizedProvider)
  if (existing?.key === key) return existing.snapshot
  const executable = quoteShellArg(binaryPath)
  const [versionResult, helpResult] = await Promise.all([
    runBash({ command: `${executable} --version`, timeoutMs: 4_000 }),
    runBash({ command: `${executable} --help`, timeoutMs: 6_000 }),
  ])
  const version = (versionResult.stdout || versionResult.stderr || 'unknown').trim().slice(0, 240)
  const help = `${helpResult.stdout}\n${helpResult.stderr}`.slice(0, 120_000)
  const revision = createHash('sha256')
    .update(normalizedProvider)
    .update('\0')
    .update(key)
    .update('\0')
    .update(version)
    .update('\0')
    .update(help)
    .digest('hex')
  const snapshot = capabilitiesFromCliHelp({
    provider: normalizedProvider,
    binaryPath,
    version,
    revision,
    detectedAt: new Date().toISOString(),
    help,
  })
  cache.set(normalizedProvider, { key, snapshot })
  return snapshot
}
