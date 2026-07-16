import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const isWindows = process.platform === 'win32'

function windowsPlatform(platform: NodeJS.Platform) {
  return platform === 'win32'
}

export type CommandSpec = {
  file: string
  args: string[]
  windowsVerbatimArguments?: boolean
}

/** Quote one argument for the platform command shell. */
export function quoteShellArg(
  value: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (windowsPlatform(platform)) {
    return `"${value
      .replace(/%/g, '%%')
      .replace(/(\\*)"/g, '$1$1\\"')
      .replace(/(\\*)$/g, '$1$1')}"`
  }
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function quoteWindowsCommandToken(value: string): string {
  return /^[a-zA-Z0-9_./:\\=@,+-]+$/.test(value)
    ? value
    : quoteShellArg(value, 'win32')
}

function resolveWindowsCommand(command: string): string | null {
  const hasPath = /[\\/]/.test(command)
  const searchDirs = hasPath
    ? ['']
    : (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  const existingExt = path.win32.extname(command)
  const extensions = existingExt
    ? ['']
    : (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
        .split(';')
        .filter(Boolean)

  for (const dir of searchDirs) {
    for (const extension of extensions) {
      const candidate = dir ? path.win32.join(dir, `${command}${extension}`) : `${command}${extension}`
      try {
        if (fs.statSync(candidate).isFile()) return candidate
      } catch {
        /* continue searching PATH/PATHEXT */
      }
    }
  }
  return null
}

/** Build a one-shot platform shell invocation. */
export function shellCommandSpec(
  command: string,
  platform: NodeJS.Platform = process.platform,
): CommandSpec {
  if (windowsPlatform(platform)) {
    // With /S, cmd.exe requires one outer quote pair when the command itself
    // begins with a quoted executable path (commonly Program Files\*.cmd).
    const commandLine = command.trimStart().startsWith('"') ? `"${command}"` : command
    return {
        file: process.env.COMSPEC || 'cmd.exe',
        args: ['/d', '/s', '/c', commandLine],
        windowsVerbatimArguments: true,
      }
  }
  return {
    file: '/bin/bash',
    args: ['-lc', command],
  }
}

/**
 * Build a portable spawn spec.
 *
 * Windows command shims installed by npm are usually bare names or .cmd/.bat
 * files and cannot be passed directly to CreateProcess. Route those through
 * COMSPEC while keeping native executables on the direct-spawn path.
 */
export function spawnCommandSpec(
  command: string,
  args: string[] = [],
  platform: NodeJS.Platform = process.platform,
): CommandSpec {
  if (!windowsPlatform(platform)) return { file: command, args }

  const resolved = resolveWindowsCommand(command) || command
  const ext = path.win32.extname(resolved).toLowerCase()
  const needsCommandShell = !ext || ext === '.cmd' || ext === '.bat'
  if (!needsCommandShell) return { file: resolved, args }

  return shellCommandSpec(
    [quoteWindowsCommandToken(resolved), ...args.map(quoteWindowsCommandToken)].join(' '),
    platform,
  )
}

export function executableLookupCommand(
  name: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return windowsPlatform(platform)
    ? `where ${quoteWindowsCommandToken(name)}`
    : `command -v ${quoteShellArg(name, platform)}`
}

/** Pick the first path the current OS can actually execute. */
export function firstExecutablePath(
  output: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (!windowsPlatform(platform)) return lines[0] || null

  const executableExtensions = new Set(
    (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
      .split(';')
      .map((extension) => extension.toLowerCase()),
  )
  return (
    lines.find((line) => executableExtensions.has(path.win32.extname(line).toLowerCase())) ||
    null
  )
}

/** Platform-correct containment check, including Windows drive/case semantics. */
export function isPathInside(
  root: string,
  candidate: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const pathApi = windowsPlatform(platform) ? path.win32 : path.posix
  const relative = pathApi.relative(pathApi.resolve(root), pathApi.resolve(candidate))
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${pathApi.sep}`) &&
      !pathApi.isAbsolute(relative))
  )
}

/** Terminate the child and its descendants, falling back to the direct child. */
export async function terminateProcessTree(
  child: ChildProcess,
  force = false,
): Promise<boolean> {
  const pid = child.pid
  if (!pid) return false

  if (isWindows) {
    return new Promise((resolve) => {
      let settled = false
      const finish = (ok: boolean) => {
        if (settled) return
        settled = true
        if (!ok) {
          try {
            child.kill()
          } catch {
            /* process already exited */
          }
        }
        resolve(ok)
      }

      let killer: ChildProcess
      try {
        killer = spawn(
          'taskkill.exe',
          ['/pid', String(pid), '/t', ...(force ? ['/f'] : [])],
          { stdio: 'ignore', windowsHide: true },
        )
      } catch {
        finish(false)
        return
      }
      killer.once('error', () => finish(false))
      killer.once('close', (code) => finish(code === 0))
    })
  }

  const signal: NodeJS.Signals = force ? 'SIGKILL' : 'SIGTERM'
  try {
    // Shell/PTY children are spawned detached on POSIX, so their pid is also
    // the process-group id. This reaches grandchildren created by the shell.
    process.kill(-pid, signal)
    return true
  } catch {
    try {
      return child.kill(signal)
    } catch {
      return false
    }
  }
}
