import childProcess from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { syncBuiltinESMExports } from 'node:module'

const marker = process.env.SUBAGENTS_NO_APP_LAUNCH_MARKER

function isElectronBinary(value) {
  const base = path.basename(String(value || '')).toLowerCase()
  return base === 'electron' || base === 'electron.exe'
}

function rejectElectronLaunch(method, file, args = []) {
  if (!isElectronBinary(file) && !args.some(isElectronBinary)) return
  if (marker) fs.appendFileSync(marker, `${JSON.stringify({ method, blocked: true })}\n`)
  throw new Error('deterministic qualification attempted to launch Electron App')
}

for (const method of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const original = childProcess[method]
  childProcess[method] = function guarded(file, args, ...rest) {
    rejectElectronLaunch(method, file, Array.isArray(args) ? args : [])
    return original.call(this, file, args, ...rest)
  }
}

syncBuiltinESMExports()
