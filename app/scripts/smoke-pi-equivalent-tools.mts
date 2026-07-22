import { strict as assert } from 'node:assert'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { piFind, piGrep, piLs, piRead } from '../electron/piEquivalentTools.ts'

const root = await mkdtemp(join(tmpdir(), 'pi-tools-'))
try {
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src', 'main.ts'), 'const answer = 42\n')
  assert.deepEqual(await piRead(root, 'src/main.ts'), { path: 'src/main.ts', content: 'const answer = 42\n' })
  assert.deepEqual(await piLs(root, 'src'), ['main.ts'])
  assert.deepEqual(await piFind(root, '.ts'), ['src/main.ts'])
  assert.equal((await piGrep(root, 'answer'))[0].line, 1)
  await assert.rejects(() => piRead(root, '../outside'))
} finally { await rm(root, { recursive: true, force: true }) }
console.log('pi equivalent tools preserve project scope and contracts')
