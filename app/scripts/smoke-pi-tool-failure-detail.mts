import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { piToolFailureDetail } from '../electron/piToolFailureDetail.ts'

assert.equal(
  piToolFailureDetail({ content: [{ type: 'text', text: ' spawn rg ENOENT ' }], isError: true }),
  'spawn rg ENOENT',
  'Pi text content becomes the durable user-visible cause',
)
assert.equal(piToolFailureDetail({ message: 'extension failed' }), 'extension failed')
assert.equal(piToolFailureDetail({ details: { error: 'typed failure' } }), 'typed failure')
assert.equal(piToolFailureDetail({ content: [{ type: 'image', data: 'secret' }] }), undefined,
  'unknown result content is never serialized into the record')
assert.equal(piToolFailureDetail({ content: [{ type: 'text', text: 'x'.repeat(900) }] })?.length, 500,
  'failure details are bounded before publication')

const protocol = await readFile(resolve(import.meta.dirname, '../electron/piHostProtocol.ts'), 'utf8')
assert.match(protocol, /input\.toolFailed[\s\S]*piToolFailureDetail\(input\.trustedResult\)/,
  'the model tool terminal path extracts the failure cause')
assert.match(protocol, /failureReason \? \{ reason: failureReason \} : \{\}/,
  'the cause is published on the canonical Host result event')
assert.match(protocol, /record\.reason \? \{ detail: record\.reason \} : \{\}/,
  'the published cause becomes durable Turn Record detail')

console.log('Pi tool failure details preserve the model-visible cause without serializing arbitrary results')
