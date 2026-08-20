import path from 'node:path'

export function resolveElectronExecutable(appRoot, platform = process.platform) {
  const relativeExecutable = platform === 'darwin'
    ? path.join('Electron.app', 'Contents', 'MacOS', 'Electron')
    : platform === 'linux'
      ? 'electron'
      : platform === 'win32'
        ? 'electron.exe'
        : undefined
  if (!relativeExecutable) throw new Error(`Unsupported Electron launch platform: ${platform}`)
  return path.join(
    appRoot,
    'node_modules',
    'electron',
    'dist',
    relativeExecutable,
  )
}
