const TOOL_FAILURE_DETAIL_LIMIT = 500

function boundedToolFailureText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text ? text.slice(0, TOOL_FAILURE_DETAIL_LIMIT) : undefined
}

/**
 * The model-visible failure Pi returned, reduced to a bounded display string.
 *
 * Pi tools normally return `{ content: [{ type: 'text', text }], isError }`,
 * while extension tools sometimes expose a top-level or details message. Keep
 * this parser deliberately narrow: the Turn Record needs the cause the model
 * saw, not an unbounded serialization of arbitrary tool output.
 */
export function piToolFailureDetail(value: unknown): string | undefined {
  const direct = boundedToolFailureText(value)
  if (direct) return direct
  if (!value || typeof value !== 'object') return undefined
  const result = value as { message?: unknown; content?: unknown; details?: unknown }
  const message = boundedToolFailureText(result.message)
  if (message) return message
  if (Array.isArray(result.content)) {
    for (const item of result.content) {
      if (!item || typeof item !== 'object') continue
      const text = boundedToolFailureText((item as { text?: unknown }).text)
      if (text) return text
    }
  }
  if (result.details && typeof result.details === 'object') {
    const details = result.details as { error?: unknown; message?: unknown }
    return boundedToolFailureText(details.error) ?? boundedToolFailureText(details.message)
  }
  return undefined
}
