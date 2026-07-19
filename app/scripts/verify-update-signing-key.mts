import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { BUILT_IN_UPDATE_PUBLIC_KEY } from '../electron/updatePublicKey.ts'

const privateKeyPem = String(process.env.UPDATE_PRIVATE_KEY || '').trim()
assert.ok(privateKeyPem, 'UPDATE_PRIVATE_KEY is required')

const expectedDer = crypto.createPublicKey(BUILT_IN_UPDATE_PUBLIC_KEY).export({ type: 'spki', format: 'der' })
const derivedDer = crypto.createPublicKey(privateKeyPem).export({ type: 'spki', format: 'der' })
assert.equal(Buffer.from(derivedDer).toString('base64'), Buffer.from(expectedDer).toString('base64'), 'UPDATE_PRIVATE_KEY does not match the packaged update trust root')
console.log(`Update signing key matches packaged trust root (sha256=${crypto.createHash('sha256').update(expectedDer).digest('hex')})`)
