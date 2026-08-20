import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export function resolveElectronExecutable(loadElectron = () => require('electron')) {
  const executable = loadElectron()
  if (typeof executable !== 'string' || !path.isAbsolute(executable)) {
    throw new Error('Electron package did not resolve an absolute executable path')
  }
  return executable
}
