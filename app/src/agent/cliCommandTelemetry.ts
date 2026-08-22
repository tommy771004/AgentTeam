/**
 * Safe command metadata for external CLI telemetry.
 *
 * The real argv is passed to the child unchanged.  Only the display copy is
 * redacted, so diagnostics can identify the adapter and flags without
 * persisting the user's prompt, credentials, or other payloads.
 */

const SECRET_ASSIGNMENT = /(token|secret|password|api[_ -]?key|authorization)\s*[:=]\s*[^\s,;]+/gi
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi

export function redactCliTelemetryText(value: string): string {
  return value.replace(BEARER, 'Bearer [redacted]').replace(SECRET_ASSIGNMENT, '$1=[redacted]')
}

/** Replace exact prompt argv values while retaining safe flag/value metadata. */
export function redactCliDisplayArgs(args: readonly string[], prompt?: string): string[] {
  const promptValue = typeof prompt === 'string' ? prompt : undefined
  let redactNext = false
  return args.map((arg) => {
    if (redactNext) {
      redactNext = false
      return '[credential omitted]'
    }
    if (/^--?(?:token|secret|password|api[-_ ]?key|authorization)$/i.test(arg)) {
      redactNext = true
      return arg
    }
    return promptValue && arg === promptValue ? '[prompt omitted]' : redactCliTelemetryText(arg)
  })
}
