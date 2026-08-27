import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { resolveNpmCliInvocation } from './npm-cli-invocation.mts'

const appRoot = resolve(import.meta.dirname, '..')
const standaloneTarget = process.argv[2]
const builtTarget = process.argv[3]
if (!standaloneTarget || !builtTarget) throw new Error('standalone and built Electron smoke targets are required')
const target = process.env.SUBAGENTS_RELEASE_AFTER_BUILD === '1'
  ? builtTarget
  : standaloneTarget
const invocation = resolveNpmCliInvocation(['run', target], {
  platform: process.platform,
  execPath: process.execPath,
  npmExecPath: process.env.npm_execpath,
})
execFileSync(invocation.command, invocation.args, { cwd: appRoot, stdio: 'inherit' })
