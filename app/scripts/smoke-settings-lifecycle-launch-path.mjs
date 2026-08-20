import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { resolveElectronExecutable } from './electron-executable.mjs'

let packageResolverCalled = false
const executable = resolveElectronExecutable(() => {
  packageResolverCalled = true
  return path.resolve('/electron-package/dist/electron')
})
assert.equal(packageResolverCalled, true)
assert.equal(executable, path.resolve('/electron-package/dist/electron'))

const installedExecutable = resolveElectronExecutable()
assert.equal(fs.existsSync(installedExecutable), true, `Electron package binary is missing: ${installedExecutable}`)

console.log('Settings lifecycle Electron launch path matches the runner platform')
