import { readFile } from 'node:fs/promises'

const SHA256 = /^[0-9a-f]{64}$/
const COMMIT = /^[0-9a-f]{40}$/
const VERSION = /^\d+\.\d+\.\d+$/

export type BuildablePiUpstreamPin = {
  repository: string
  commit: string
  tag: string
  packageVersion: string
  releaseSourceArchive: {
    asset: string
    sha256: string
    modelDataManifestSha256: string
  }
  treeSha256: string
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** The single contract shared by Pi sync, build, and release qualification. */
export function parseBuildablePiUpstreamPin(value: unknown): BuildablePiUpstreamPin {
  if (!record(value) || !record(value.releaseSourceArchive)) throw new Error('Pi pin is not an object')
  const archive = value.releaseSourceArchive
  if (typeof value.repository !== 'string' || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?$/.test(value.repository)) {
    throw new Error('Pi pin repository is invalid')
  }
  if (typeof value.commit !== 'string' || !COMMIT.test(value.commit)) throw new Error('Pi pin commit is invalid')
  if (typeof value.packageVersion !== 'string' || !VERSION.test(value.packageVersion)) throw new Error('Pi pin package version is invalid')
  if (value.tag !== `v${value.packageVersion}`) throw new Error('Pi pin must identify the exact package release tag')
  if (archive.asset !== `pi-${value.packageVersion}-source.tar.gz`) throw new Error('Pi pin source archive does not match its package version')
  if (typeof archive.sha256 !== 'string' || !SHA256.test(archive.sha256)) throw new Error('Pi pin source archive SHA-256 is invalid')
  if (typeof archive.modelDataManifestSha256 !== 'string' || !SHA256.test(archive.modelDataManifestSha256)) {
    throw new Error('Pi pin model-data manifest SHA-256 is invalid')
  }
  if (typeof value.treeSha256 !== 'string' || !SHA256.test(value.treeSha256)) throw new Error('Pi pin vendor tree SHA-256 is invalid')
  return structuredClone(value) as BuildablePiUpstreamPin
}

export async function readBuildablePiUpstreamPin(path: string): Promise<BuildablePiUpstreamPin> {
  return parseBuildablePiUpstreamPin(JSON.parse(await readFile(path, 'utf8')))
}
