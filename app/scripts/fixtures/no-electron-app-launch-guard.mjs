import childProcess from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { syncBuiltinESMExports } from 'node:module'

const marker = process.env.SUBAGENTS_NO_APP_LAUNCH_MARKER

function isElectronBinary(value) {
  const base = path.basename(String(value || '')).toLowerCase()
  return base === 'electron' || base === 'electron.exe'
}

function containsElectronCommand(value) {
  const command = String(value || '')
  return /(?:^|[\\/\s"'`;&|()<>])electron(?:\.exe)?(?=$|[\s"'`;&|()<>])/i.test(command)
}

function rejectElectronLaunch(method, file, args = []) {
  const candidates = [file, ...args]
  if (!candidates.some((value) => isElectronBinary(value) || containsElectronCommand(value))) return
  if (marker) fs.appendFileSync(marker, `${JSON.stringify({ method, blocked: true })}\n`)
  throw new Error('deterministic qualification attempted to launch Electron App')
}

if (process.versions.electron) {
  rejectElectronLaunch('process', process.execPath)
}

for (const method of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const original = childProcess[method]
  childProcess[method] = function guarded(file, args, ...rest) {
    rejectElectronLaunch(method, file, Array.isArray(args) ? args : [])
    return original.call(this, file, args, ...rest)
  }
}

for (const method of ['exec', 'execSync']) {
  const original = childProcess[method]
  childProcess[method] = function guarded(command, ...rest) {
    rejectElectronLaunch(method, command)
    return original.call(this, command, ...rest)
  }
}

const originalFork = childProcess.fork
childProcess.fork = function guarded(modulePath, args, options) {
  const normalizedArgs = Array.isArray(args) ? args : []
  const normalizedOptions = Array.isArray(args) ? options : args
  rejectElectronLaunch('fork', normalizedOptions?.execPath, [modulePath, ...normalizedArgs])
  return originalFork.call(this, modulePath, args, options)
}

syncBuiltinESMExports()
