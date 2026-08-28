import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

type UserEnvironmentOptions = {
  platform?: NodeJS.Platform
  home?: string
  accountShell?: string
  captureLoginPath?: (shell: string, environment: NodeJS.ProcessEnv) => string | undefined
}

const loginPathCache = new Map<string, string | undefined>()

function accountShell(): string | undefined {
  try {
    return os.userInfo().shell || undefined
  } catch {
    return undefined
  }
}

export function resolveUserPathValue(value: string, home = os.homedir()): string {
  const trimmed = value.trim()
  if (trimmed === '~') return home
  if (trimmed.startsWith('~/') || trimmed.startsWith(`~${path.sep}`)) {
    return path.join(home, trimmed.slice(2))
  }
  return path.resolve(trimmed)
}

export function configuredUserPath(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: string,
  home = os.homedir(),
): string {
  const configured = environment[name]?.trim()
  return configured ? resolveUserPathValue(configured, home) : fallback
}

export function resolveUserShell(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  detectedAccountShell = accountShell(),
): string {
  if (platform === 'win32') return environment.COMSPEC?.trim() || 'cmd.exe'
  const configured = environment.SHELL?.trim()
  if (configured && path.isAbsolute(configured)) return configured
  if (detectedAccountShell && path.isAbsolute(detectedAccountShell)) return detectedAccountShell
  return '/bin/sh'
}

function defaultCaptureLoginPath(shell: string, environment: NodeJS.ProcessEnv): string | undefined {
  const cacheKey = `${shell}\0${environment.HOME || ''}\0${environment.PATH || ''}`
  if (loginPathCache.has(cacheKey)) return loginPathCache.get(cacheKey)
  const shellName = path.basename(shell)
  const args = shellName === 'bash' || shellName === 'zsh'
    ? ['-ilc', '/usr/bin/env -0']
    : ['-lc', '/usr/bin/env -0']
  const result = spawnSync(shell, args, {
    env: environment,
    encoding: 'utf8',
    timeout: 4_000,
    maxBuffer: 1024 * 1024,
  })
  const captured = result.status === 0
    ? result.stdout
        .split('\0')
        .find((entry) => entry.startsWith('PATH='))
        ?.slice('PATH='.length)
    : undefined
  loginPathCache.set(cacheKey, captured)
  return captured
}

function mergePaths(primary: string | undefined, inherited: string | undefined): string | undefined {
  const entries = [...(primary || '').split(path.delimiter), ...(inherited || '').split(path.delimiter)]
    .map((entry) => entry.trim())
    .filter(Boolean)
  return entries.length ? [...new Set(entries)].join(path.delimiter) : undefined
}

/** Build a child environment from the actual user's login shell without dropping app-owned PATH entries. */
export function buildUserEnvironment(
  overrides: NodeJS.ProcessEnv = {},
  base: NodeJS.ProcessEnv = process.env,
  options: UserEnvironmentOptions = {},
): NodeJS.ProcessEnv {
  const platform = options.platform || process.platform
  const home = options.home || overrides.HOME || base.HOME || os.homedir()
  const environment: NodeJS.ProcessEnv = { ...base, ...overrides, HOME: home }
  const shell = resolveUserShell(environment, platform, options.accountShell)
  environment.SHELL = shell
  if (platform !== 'win32' && !Object.hasOwn(overrides, 'PATH')) {
    const capture = options.captureLoginPath || defaultCaptureLoginPath
    environment.PATH = mergePaths(capture(shell, environment), environment.PATH)
  }
  return environment
}

export function interactiveUserShellSpec(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  detectedAccountShell = accountShell(),
): { file: string; args: string[]; windowsVerbatimArguments?: boolean } {
  const shell = resolveUserShell(environment, platform, detectedAccountShell)
  if (platform === 'win32') {
    return { file: shell, args: ['/d'], windowsVerbatimArguments: true }
  }
  const name = path.basename(shell)
  return { file: shell, args: name === 'bash' || name === 'zsh' ? ['-il'] : ['-i'] }
}
