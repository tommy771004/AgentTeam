import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  executableLookupCommand,
  firstExecutablePath,
  isPathInside,
  quoteShellArg,
  shellCommandSpec,
  spawnCommandSpec,
} from '../electron/platformProcess.ts'

let passed = 0

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
    passed += 1
  } catch (error) {
    console.error(`  ✗ ${name}`)
    console.error(error)
    process.exitCode = 1
  }
}

function run(spec: { file: string; args: string[]; windowsVerbatimArguments?: boolean }) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(spec.file, spec.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: spec.windowsVerbatimArguments,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.once('error', reject)
    child.once('close', (code) => resolve({ code, stdout, stderr }))
  })
}

console.log('Platform process smoke\n')

await test('Windows shell uses COMSPEC with cmd-safe flags', () => {
  const spec = shellCommandSpec('echo ok', 'win32')
  assert.match(spec.file.toLowerCase(), /cmd\.exe$/)
  assert.deepEqual(spec.args, ['/d', '/s', '/c', 'echo ok'])
})

await test('macOS shell uses login bash', () => {
  assert.deepEqual(shellCommandSpec('pwd', 'darwin'), {
    file: '/bin/bash',
    args: ['-lc', 'pwd'],
  })
})

await test('Windows npm shims use COMSPEC while native executables stay direct', () => {
  const shim = spawnCommandSpec('npx', ['--version'], 'win32')
  assert.match(shim.file.toLowerCase(), /cmd\.exe$/)
  assert.match(shim.args.at(-1) || '', /npx(?:\.cmd)?"?\s+--version"?$/i)

  const native = spawnCommandSpec('C:\\Tools\\agent.exe', ['--version'], 'win32')
  assert.deepEqual(native, {
    file: 'C:\\Tools\\agent.exe',
    args: ['--version'],
  })
})

await test('binary lookup commands match each platform', () => {
  assert.match(executableLookupCommand('npm', 'win32'), /^where "?npm"?$/)
  assert.equal(executableLookupCommand('npm', 'darwin'), "command -v 'npm'")
})

await test('Windows lookup skips POSIX shims and selects PATHEXT files', () => {
  const output = [
    'C:\\Program Files\\nodejs\\npm',
    'C:\\Program Files\\nodejs\\npm.cmd',
  ].join('\r\n')
  assert.equal(
    firstExecutablePath(output, 'win32'),
    'C:\\Program Files\\nodejs\\npm.cmd',
  )
  assert.equal(firstExecutablePath('/opt/homebrew/bin/npm\n', 'darwin'), '/opt/homebrew/bin/npm')
})

await test('path containment respects Windows and macOS semantics', () => {
  assert.equal(isPathInside('C:\\Work\\Repo', 'c:\\work\\repo\\src', 'win32'), true)
  assert.equal(isPathInside('C:\\Work\\Repo', 'C:\\Work\\Repo2', 'win32'), false)
  assert.equal(isPathInside('/Users/me/repo', '/Users/me/repo/src', 'darwin'), true)
  assert.equal(isPathInside('/Users/me/repo', '/Users/me/Repo/src', 'darwin'), false)
  assert.equal(isPathInside('/Users/me/repo', '/Users/me/repo-old', 'darwin'), false)
})

await test('current platform can launch npm through portable spawn spec', async () => {
  const lookup = await run(shellCommandSpec(executableLookupCommand('npm')))
  assert.equal(lookup.code, 0, lookup.stderr)
  assert.ok(lookup.stdout.trim(), 'npm lookup should return a path')

  const npmPath = firstExecutablePath(lookup.stdout)
  assert.ok(npmPath, 'npm lookup should select a platform executable')
  const absolute = await run(shellCommandSpec(`${quoteShellArg(npmPath)} --version`))
  assert.equal(absolute.code, 0, absolute.stderr)
  assert.match(absolute.stdout.trim(), /^\d+\.\d+\.\d+/)

  const result = await run(spawnCommandSpec('npm', ['--version']))
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/)
})

await test('portable spawn preserves spaces and shell metacharacters in arguments', async () => {
  const expected = 'hello world & 50%'
  const spec = spawnCommandSpec('node', [
    '-e',
    'process.stdout.write(process.argv[1])',
    expected,
  ])
  const result = await run(spec)
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.stdout, expected, JSON.stringify({ spec, result }))
})

console.log(`\n${passed} platform process smoke tests passed`)
if (process.exitCode) console.error('Platform process smoke failed')
