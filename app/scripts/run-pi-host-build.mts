import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveNpmCliInvocation } from './npm-cli-invocation.mts'

const appRoot = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(appRoot, '..')
const target = process.argv[2]
if (!target) throw new Error('Pi Host build target is required')

if (process.env.SUBAGENTS_RELEASE_AFTER_BUILD === '1') {
  const requiredArtifacts = [
    resolve(appRoot, 'dist-electron/pi-host.js'),
    resolve(repositoryRoot, 'vendor/pi/packages/ai/dist/index.js'),
    resolve(repositoryRoot, 'vendor/pi/packages/agent/dist/index.js'),
    resolve(repositoryRoot, 'vendor/pi/packages/coding-agent/dist/index.js'),
    resolve(repositoryRoot, 'vendor/pi/packages/server/dist/index.js'),
  ]
  const missing = requiredArtifacts.filter((file) => !existsSync(file))
  if (missing.length > 0) {
    throw new Error(`release smoke cannot reuse incomplete Pi Host artifacts: ${missing.join(', ')}`)
  }
  console.log('Pi Host artifacts were built before release smoke; skipping nested build')
  process.exit(0)
}

const invocation = resolveNpmCliInvocation(['run', target], {
  platform: process.platform,
  execPath: process.execPath,
  npmExecPath: process.env.npm_execpath,
})
execFileSync(invocation.command, invocation.args, { cwd: appRoot, stdio: 'inherit' })
