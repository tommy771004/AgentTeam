import assert from 'node:assert/strict'
import path from 'node:path'
import { resolveElectronExecutable } from './electron-executable.mjs'

const appRoot = path.resolve('/workspace/app')

assert.equal(
  resolveElectronExecutable(appRoot, 'linux'),
  path.join(appRoot, 'node_modules', 'electron', 'dist', 'electron'),
)
assert.equal(
  resolveElectronExecutable(appRoot, 'darwin'),
  path.join(appRoot, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'),
)
assert.equal(
  resolveElectronExecutable(appRoot, 'win32'),
  path.join(appRoot, 'node_modules', 'electron', 'dist', 'electron.exe'),
)

console.log('Settings lifecycle Electron launch path matches the runner platform')
