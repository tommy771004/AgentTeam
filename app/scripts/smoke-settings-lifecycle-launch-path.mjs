import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { ensureElectronExecutable, resolveElectronExecutable } from './electron-executable.mjs'

let packageResolverCalled = false
const executable = resolveElectronExecutable(() => {
  packageResolverCalled = true
  return path.resolve('/electron-package/dist/electron')
})
assert.equal(packageResolverCalled, true)
assert.equal(executable, path.resolve('/electron-package/dist/electron'))

let fixtureInstalled = false
let installerCalls = 0
const bootstrappedExecutable = ensureElectronExecutable({
  loadElectron: () => path.resolve('/electron-package/dist/electron'),
  executableExists: () => fixtureInstalled,
  installElectron: () => {
    installerCalls += 1
    fixtureInstalled = true
  },
})
assert.equal(bootstrappedExecutable, path.resolve('/electron-package/dist/electron'))
assert.equal(installerCalls, 1)

const installedExecutable = ensureElectronExecutable()
assert.equal(fs.existsSync(installedExecutable), true, `Electron package binary is missing: ${installedExecutable}`)

console.log('Settings lifecycle Electron launch path matches the runner platform')
