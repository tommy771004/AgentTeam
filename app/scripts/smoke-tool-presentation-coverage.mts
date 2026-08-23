import { strict as assert } from 'node:assert'
import { TOOL_DEFINITIONS } from '../src/agent/tools/toolDefinitions.ts'
import { presentToolCall, diffPaths } from '../src/agent/tools/toolPresentation.ts'
import { projectProducedFiles, projectRunOperations } from '../src/agent/runOperationsProjection.ts'
import { appendTurnRecord } from '../src/agent/turnRecord.ts'

/**
 * Every catalog tool declares how it presents, and the declaration is read.
 *
 * A declaration nothing consults is decoration: before this, `presentToolCall`
 * only knew Pi Core's builtin table, so a catalog tool's card was declared and
 * then ignored.
 */

const names = Object.keys(TOOL_DEFINITIONS)
const undeclared = names.filter((name) => !(TOOL_DEFINITIONS as Record<string, { presentCall?: unknown }>)[name].presentCall)
assert.deepEqual(undeclared, [], `every catalog tool declares its card; missing: ${undeclared.join(', ')}`)

// The declaration is what the projection reads — not a builtin lookup table.
assert.equal(presentToolCall('workspace_read', { path: 'src/app.ts' })?.card, 'generic')
assert.equal(presentToolCall('workspace_glob', { pattern: '**/*.ts' })?.card, 'search')
assert.equal(presentToolCall('bash', { command: 'ls -la' })?.card, 'terminal')
assert.equal(presentToolCall('workspace_write', { path: 'a.txt', content: 'hi' })?.card, 'diff')

// Every presenter is total: a malformed or older recorded argument degrades to
// a plain row and never throws, because these run on replay.
for (const name of names) {
  for (const args of [undefined, null, {}, { path: 123 }, 'not-an-object', []]) {
    assert.doesNotThrow(() => presentToolCall(name, args), `${name} must not throw on ${JSON.stringify(args)}`)
  }
}

// Card kinds actually in use, so the feed reads as a system rather than a
// wall of generic rows.
const cards = new Set(names.map((name) => presentToolCall(name, sampleArgs(name))?.card).filter(Boolean))
for (const card of ['generic', 'terminal', 'diff', 'search']) {
  assert.ok(cards.has(card as never), `no tool presents a ${card} card`)
}

// A mutation reaches the produced-files list; a read and a delete do not.
const record = appendTurnRecord(undefined, [
  { kind: 'tool-call', source: 'model', tool: 'workspace_download', callId: 'c1', args: { url: 'https://x/y', path: 'out/report.pdf' }, turn: 1, step: 1, at: 1 },
  { kind: 'tool-result', source: 'host', tool: 'workspace_download', callId: 'c1', settlement: 'success', turn: 1, step: 1, at: 2 },
  { kind: 'tool-call', source: 'model', tool: 'workspace_read', callId: 'c2', args: { path: 'src/app.ts' }, turn: 1, step: 1, at: 3 },
  { kind: 'tool-result', source: 'host', tool: 'workspace_read', callId: 'c2', settlement: 'success', turn: 1, step: 1, at: 4 },
  { kind: 'tool-call', source: 'model', tool: 'workspace_delete', callId: 'c3', args: { path: 'out/old.pdf' }, turn: 1, step: 1, at: 5 },
  { kind: 'tool-result', source: 'host', tool: 'workspace_delete', callId: 'c3', settlement: 'success', turn: 1, step: 1, at: 6 },
  { kind: 'tool-call', source: 'model', tool: 'workspace_mkdir', callId: 'c4', args: { path: 'out/sub' }, turn: 1, step: 1, at: 7 },
  { kind: 'tool-result', source: 'host', tool: 'workspace_mkdir', callId: 'c4', settlement: 'failed', turn: 1, step: 1, at: 8 },
] as never)
assert.deepEqual(projectProducedFiles(record).map((file) => file.path), ['out/report.pdf'])

// A delete still shows its path for editor follow-along — it just is not a
// thing the run produced.
const deleteCard = presentToolCall('workspace_delete', { path: 'out/old.pdf' })
assert.equal(deleteCard?.card === 'generic' ? deleteCard.locations?.[0]?.path : undefined, 'out/old.pdf')
assert.equal(deleteCard?.card === 'generic' ? deleteCard.kind : 'x', undefined, 'a delete never declares kind: edit')
assert.equal(diffPaths(deleteCard!), undefined)

// The operations projection renders those same calls without needing to know
// any tool's name.
assert.ok(projectRunOperations(record).length > 0)

/** One bag of plausible arguments, so every presenter sees the field it reads. */
function sampleArgs(_name: string): Record<string, unknown> {
  return {
    path: 'src/app.ts', content: 'hi', command: 'ls -la', pattern: '**/*.ts', query: 'needle',
    url: 'https://example.test/a', to: 'dst.txt', from: 'src.txt', name: 'thing', key: 'k',
    text: 'body', symbol: 'fn', goal: 'do it', chatId: '1', toolName: 'echo', serverId: 's1',
    question: 'why', severity: 'high', kind: 'png', format: 'pdf', artifactId: 'a1',
    briefId: 'b1', directionId: 'd1', tweakId: 't1', locator: 'spill://1',
    timezone: 'Asia/Taipei', delimiter: ',', jobId: 'j1', projectRoot: '/repo', paths: 'a,b',
  }
}

console.log('Every catalog tool declares a card, and the declaration is what the projection reads')
