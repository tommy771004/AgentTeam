import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import Ajv from 'ajv'
import type { GoalCriterion } from '../../src/agent/goalContract.ts'
import { resolveCriterionPath } from './pathAuthority.ts'

const schemas = Object.freeze({
  'agentteam:json-object-v1': { type: 'object', additionalProperties: true } as const,
  'agentteam:string-array-v1': { type: 'array', items: { type: 'string' } } as const,
})

export type RegisteredArtifactSchemaId = keyof typeof schemas

export type ArtifactCheckResult = Readonly<{
  state: 'matched' | 'missing' | 'invalid-path' | 'digest-mismatch' | 'invalid-json' | 'unknown-schema' | 'schema-mismatch'
  path: string
  actualSha256?: string
  validationErrorSha256?: string
}>

export function registeredArtifactSchemaIds(): readonly RegisteredArtifactSchemaId[] {
  return Object.freeze(Object.keys(schemas) as RegisteredArtifactSchemaId[])
}

export async function checkArtifactContract(input: {
  criterion: Extract<GoalCriterion, { kind: 'artifact-exists' | 'json-schema' }>
  workspaceRoot: string
}): Promise<ArtifactCheckResult> {
  const resolved = await resolveCriterionPath(input.workspaceRoot, input.criterion.path)
  if (!resolved.valid) return { state: 'invalid-path', path: resolved.candidate }
  if (!resolved.canonical) return { state: 'missing', path: resolved.candidate }
  let content: Buffer
  try { content = await readFile(resolved.canonical) } catch {
    return { state: 'missing', path: resolved.canonical }
  }
  const actualSha256 = createHash('sha256').update(content).digest('hex')
  if (input.criterion.kind === 'artifact-exists') {
    return input.criterion.sha256 && input.criterion.sha256 !== actualSha256
      ? { state: 'digest-mismatch', path: resolved.canonical, actualSha256 }
      : { state: 'matched', path: resolved.canonical, actualSha256 }
  }
  const schema = schemas[input.criterion.schemaId as RegisteredArtifactSchemaId]
  if (!schema) return { state: 'unknown-schema', path: resolved.canonical, actualSha256 }
  let value: unknown
  try { value = JSON.parse(content.toString('utf8')) } catch {
    return { state: 'invalid-json', path: resolved.canonical, actualSha256 }
  }
  const validate = new Ajv({ allErrors: true, strict: true }).compile(schema as Record<string, unknown>)
  if (validate(value)) return { state: 'matched', path: resolved.canonical, actualSha256 }
  return {
    state: 'schema-mismatch', path: resolved.canonical, actualSha256,
    validationErrorSha256: createHash('sha256').update(JSON.stringify(validate.errors || [])).digest('hex'),
  }
}
