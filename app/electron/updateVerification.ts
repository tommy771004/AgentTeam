import { createHash, createVerify, verify as cryptoVerify } from 'node:crypto'
import { artifactSignaturePayload, canonicalJson, unsignedManifestPayload, type SignedUpdateManifest, type UpdateArtifactDescriptor } from '../src/agent/updateContracts.ts'

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function verifier(algorithm: UpdateArtifactDescriptor['signatureAlgorithm']) {
  if (algorithm === 'ed25519') return null
  return createVerify('RSA-SHA256')
}

export function verifyDetachedSignature(payload: string | Uint8Array, signatureBase64: string, publicKeyPem: string, algorithm: UpdateArtifactDescriptor['signatureAlgorithm']): boolean {
  try {
    if (algorithm === 'ed25519') {
      return cryptoVerify(null, Buffer.from(payload), publicKeyPem, Buffer.from(signatureBase64, 'base64'))
    }
    const v = verifier(algorithm)
    if (!v) return false
    v.update(typeof payload === 'string' ? payload : Buffer.from(payload))
    v.end()
    return v.verify(publicKeyPem, Buffer.from(signatureBase64, 'base64'))
  } catch {
    return false
  }
}

export function verifyManifestSignature(manifest: SignedUpdateManifest, publicKeyPem: string, algorithm: UpdateArtifactDescriptor['signatureAlgorithm'] = 'rsa-sha256'): boolean {
  return verifyDetachedSignature(unsignedManifestPayload(manifest), manifest.signature, publicKeyPem, algorithm)
}

export function verifyArtifactSignature(artifact: UpdateArtifactDescriptor, bytes: Uint8Array, publicKeyPem: string): boolean {
  return sha256Hex(bytes) === artifact.sha256 && verifyDetachedSignature(artifactSignaturePayload(artifact), artifact.signature, publicKeyPem, artifact.signatureAlgorithm)
}

export function sha256ForManifest(manifest: SignedUpdateManifest): string {
  return createHash('sha256').update(canonicalJson(manifest)).digest('hex')
}
