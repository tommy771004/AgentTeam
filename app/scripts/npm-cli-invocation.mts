export type NpmCliInvocation = { command: string; args: string[] }

export function resolveNpmCliInvocation(
  args: string[],
  input: { platform: NodeJS.Platform; execPath: string; npmExecPath?: string },
): NpmCliInvocation {
  if (input.npmExecPath) {
    return {
      command: input.execPath,
      args: [input.npmExecPath, ...args],
    }
  }
  if (input.platform === 'win32') {
    throw new Error('npm_execpath is required to run npm subprocesses on Windows')
  }
  return {
    command: 'npm',
    args: [...args],
  }
}
