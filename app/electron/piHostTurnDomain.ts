export type PiHostTurnInterruptReason = 'user' | 'timeout'

/**
 * Versioned turn-method router. It owns method/parameter routing only; the
 * injected Host callbacks retain execution, approval, and settlement authority.
 */
export function handlePiHostTurnDomain<TInvalid, TInterrupt, TCancel, TSubmit>(input: {
  method: string
  params?: Record<string, unknown>
  invalid: (message: string) => TInvalid
  interrupt: (runId: string, reason: PiHostTurnInterruptReason) => TInterrupt
  cancel: (runId: string) => TCancel
  submit: () => TSubmit
}): TInvalid | TInterrupt | TCancel | TSubmit | undefined {
  if (input.method === 'turn/submit') return input.submit()
  if (input.method !== 'turn/interrupt' && input.method !== 'turn/cancel') return undefined

  const runId = typeof input.params?.runId === 'string' ? input.params.runId : ''
  if (!runId) return input.invalid('runId is required')
  if (input.method === 'turn/cancel') return input.cancel(runId)
  return input.interrupt(runId, input.params?.reason === 'timeout' ? 'timeout' : 'user')
}
