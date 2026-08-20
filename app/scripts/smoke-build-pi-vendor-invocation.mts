import assert from 'node:assert/strict'
import { resolveNpmCliInvocation } from './npm-cli-invocation.mts'

assert.deepEqual(
  resolveNpmCliInvocation(['ci', '--ignore-scripts'], {
    platform: 'win32',
    execPath: 'C:\\node\\node.exe',
    npmExecPath: 'C:\\node\\node_modules\\npm\\bin\\npm-cli.js',
  }),
  {
    command: 'C:\\node\\node.exe',
    args: ['C:\\node\\node_modules\\npm\\bin\\npm-cli.js', 'ci', '--ignore-scripts'],
  },
)
assert.throws(
  () => resolveNpmCliInvocation(['ci'], { platform: 'win32', execPath: 'C:\\node\\node.exe' }),
  /npm_execpath is required/,
)
assert.deepEqual(
  resolveNpmCliInvocation(['ci'], { platform: 'linux', execPath: '/usr/bin/node' }),
  { command: 'npm', args: ['ci'] },
)

console.log('Pi vendor npm subprocess uses the Node-hosted npm CLI on Windows')
