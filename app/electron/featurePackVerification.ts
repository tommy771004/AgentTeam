import { sha256Hex, verifyDetachedSignature } from './updateVerification.ts'
import {
  unsignedFeaturePackManifestPayload,
  featurePackArtifactSignaturePayload,
  type FeaturePackManifest,
} from '../src/agent/featurePackContracts.ts'
import type { UpdateArtifactDescriptor } from '../src/agent/updateContracts.ts'

export { sha256Hex }

export function verifyFeaturePackManifestSignature(
  manifest: FeaturePackManifest,
  publicKeyPem: string,
  algorithm: UpdateArtifactDescriptor['signatureAlgorithm'] = 'rsa-sha256',
): boolean {
  return verifyDetachedSignature(unsignedFeaturePackManifestPayload(manifest), manifest.signature, publicKeyPem, algorithm)
}

export function verifyFeaturePackArtifactSignature(
  artifact: UpdateArtifactDescriptor,
  bytes: Uint8Array,
  publicKeyPem: string,
): boolean {
  return (
    sha256Hex(bytes) === artifact.sha256 &&
    verifyDetachedSignature(featurePackArtifactSignaturePayload(artifact), artifact.signature, publicKeyPem, artifact.signatureAlgorithm)
  )
}
