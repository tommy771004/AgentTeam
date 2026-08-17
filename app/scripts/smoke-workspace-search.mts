import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildRipgrepArgv, globWorkspaceFiles, grepWorkspaceFiles } from '../electron/workspaceFs.ts'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subagents-workspace-smoke-'))
fs.mkdirSync(path.join(root, 'src', 'nested'), { recursive: true })
fs.mkdirSync(path.join(root, 'node_modules', 'ignored'), { recursive: true })
fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export const answer = 42\n')
fs.writeFileSync(path.join(root, 'src', 'nested', 'b.ts'), 'const answer = 7\n')
fs.writeFileSync(path.join(root, 'node_modules', 'ignored', 'x.ts'), 'answer = secret\n')

const grep = grepWorkspaceFiles(root, 'answer', { glob: '**/*.ts' })
assert.equal(grep.ok, true)
assert.equal(grep.matches.length, 2)
assert.equal(grep.matches.some((m) => m.path.includes('node_modules')), false)

const glob = globWorkspaceFiles(root, 'src/**/*.ts')
assert.deepEqual(glob.files, ['src/a.ts', 'src/nested/b.ts'])
assert.deepEqual(buildRipgrepArgv('answer').slice(0, 2), ['--no-config', '--line-number'])

fs.rmSync(root, { recursive: true, force: true })
console.log('workspace search smoke passed')

