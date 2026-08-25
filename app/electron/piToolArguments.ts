import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'

export type PiToolArgumentsValidation =
  | { ok: true; arguments: Record<string, unknown> }
  | { ok: false; message: string; errors: readonly ErrorObject[] }

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  useDefaults: true,
  coerceTypes: false,
  allowUnionTypes: true,
})
const validators = new Map<string, ValidateFunction>()

function schemaKey(schema: Record<string, unknown>): string {
  return JSON.stringify(schema)
}

function formatErrors(errors: readonly ErrorObject[]): string {
  return errors.map((error) => {
    const location = error.instancePath || '/'
    return `${location} ${error.message || error.keyword}`
  }).join('; ')
}

/**
 * Validate and normalize model-visible arguments with the exact schema Pi
 * exposed. The clone is important: Ajv materializes declared JSON Schema
 * defaults, while the protocol envelope remains a separate immutable value.
 */
export function validatePiToolArguments(
  schema: Record<string, unknown>,
  input: Record<string, unknown>,
): PiToolArgumentsValidation {
  const arguments_ = structuredClone(input)
  let validate = validators.get(schemaKey(schema))
  try {
    if (!validate) {
      validate = ajv.compile(schema)
      validators.set(schemaKey(schema), validate)
    }
  } catch (error) {
    return {
      ok: false,
      message: `tool schema could not be compiled: ${error instanceof Error ? error.message : String(error)}`,
      errors: [],
    }
  }
  if (validate(arguments_)) return { ok: true, arguments: arguments_ }
  const errors = [...(validate.errors || [])]
  return { ok: false, message: formatErrors(errors), errors }
}
