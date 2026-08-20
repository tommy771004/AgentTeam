import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export function resolveElectronExecutable(loadElectron = () => require('electron')) {
  const executable = loadElectron()
  if (typeof executable !== 'string' || !path.isAbsolute(executable)) {
    throw new Error('Electron package did not resolve an absolute executable path')
  }
  return executable
}

function installElectronBinary() {
  const installScript = require.resolve('electron/install.js')
  const env = { ...process.env }
  delete env.ELECTRON_SKIP_BINARY_DOWNLOAD
  const result = spawnSync(process.execPath, [installScript], {
    cwd: path.dirname(installScript),
    env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Electron binary installer exited with ${result.status ?? result.signal ?? 'unknown status'}`)
  }
}

export function ensureElectronExecutable({
  loadElectron = () => require('electron'),
  executableExists = fs.existsSync,
  installElectron = installElectronBinary,
} = {}) {
  let executable
  try {
    executable = resolveElectronExecutable(loadElectron)
  } catch {
    installElectron()
    executable = resolveElectronExecutable(loadElectron)
  }

  if (!executableExists(executable)) {
    installElectron()
    executable = resolveElectronExecutable(loadElectron)
  }
  if (!executableExists(executable)) {
    throw new Error(`Electron package binary is missing after install: ${executable}`)
  }
  return executable
}
