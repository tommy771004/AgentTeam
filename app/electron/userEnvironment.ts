import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

type UserEnvironmentOptions = {
  platform?: NodeJS.Platform
  home?: string
  accountShell?: string
  captureLoginPath?: (shell: string, environment: NodeJS.ProcessEnv) => string | undefined
  captureLoginPathAsync?: (shell: string, environment: NodeJS.ProcessEnv) => Promise<string | undefined>
}

const loginPathCache = new Map<string, string | undefined>()
const loginPathWarmups = new Map<string, Promise<string | undefined>>()

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

const loginPathCacheKey = (shell: string, environment: NodeJS.ProcessEnv): string =>
  `${shell}\0${environment.HOME || ''}\0${environment.PATH || ''}`

function captureLoginPathAsync(shell: string, environment: NodeJS.ProcessEnv): Promise<string | undefined> {
  const shellName = path.basename(shell)
  const args = shellName === 'bash' || shellName === 'zsh'
    ? ['-ilc', '/usr/bin/env -0']
    : ['-lc', '/usr/bin/env -0']
  return new Promise((resolve) => {
    const child = spawn(shell, args, { env: environment, stdio: ['ignore', 'pipe', 'ignore'] })
    let stdout = ''
    let settled = false
    const finish = (value?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(value)
    }
    const timeout = setTimeout(() => {
      child.kill()
      finish()
    }, 4_000)
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length <= 1024 * 1024) stdout += chunk.toString('utf8')
    })
    child.once('error', () => finish())
    child.once('close', (code) => finish(code === 0
      ? stdout.split('\0').find((entry) => entry.startsWith('PATH='))?.slice('PATH='.length)
      : undefined))
  })
}

function defaultCaptureLoginPath(shell: string, environment: NodeJS.ProcessEnv): string | undefined {
  const cacheKey = loginPathCacheKey(shell, environment)
  if (!loginPathCache.has(cacheKey) && !loginPathWarmups.has(cacheKey)) {
    const warmup = captureLoginPathAsync(shell, environment).then((captured) => {
      loginPathCache.set(cacheKey, captured)
      loginPathWarmups.delete(cacheKey)
      return captured
    })
    loginPathWarmups.set(cacheKey, warmup)
  }
  return loginPathCache.get(cacheKey)
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

/** Preload the account login PATH without blocking Electron's main thread. */
export async function warmUserEnvironment(
  overrides: NodeJS.ProcessEnv = {},
  base: NodeJS.ProcessEnv = process.env,
  options: UserEnvironmentOptions = {},
): Promise<NodeJS.ProcessEnv> {
  const platform = options.platform || process.platform
  if (platform === 'win32' || Object.hasOwn(overrides, 'PATH')) return buildUserEnvironment(overrides, base, options)
  const home = options.home || overrides.HOME || base.HOME || os.homedir()
  const environment: NodeJS.ProcessEnv = { ...base, ...overrides, HOME: home }
  const shell = resolveUserShell(environment, platform, options.accountShell)
  const cacheKey = loginPathCacheKey(shell, environment)
  const capture = options.captureLoginPathAsync || captureLoginPathAsync
  const captured = loginPathCache.has(cacheKey)
    ? loginPathCache.get(cacheKey)
    : await (loginPathWarmups.get(cacheKey) || capture(shell, environment))
  loginPathCache.set(cacheKey, captured)
  return buildUserEnvironment(overrides, base, { ...options, captureLoginPath: () => captured })
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
