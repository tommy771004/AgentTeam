import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveNpmCliInvocation } from './npm-cli-invocation.mts'

const appRoot = resolve(import.meta.dirname, '..')
const target = process.argv[2]
if (!target) throw new Error('after-build smoke target is required')

const requiredArtifacts = [
  'dist/index.html',
  'dist-electron/main.js',
  'dist-electron/preload.cjs',
  'dist-electron/pi-host.js',
]
const missing = requiredArtifacts.filter((relative) => !existsSync(resolve(appRoot, relative)))
if (missing.length > 0) {
  throw new Error(`after-build smoke requires npm run build first; missing: ${missing.join(', ')}`)
}

const invocation = resolveNpmCliInvocation(['run', target], {
  platform: process.platform,
  execPath: process.execPath,
  npmExecPath: process.env.npm_execpath,
})
execFileSync(invocation.command, invocation.args, {
  cwd: appRoot,
  env: { ...process.env, SUBAGENTS_RELEASE_AFTER_BUILD: '1' },
  stdio: 'inherit',
})

