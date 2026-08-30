import type { Dispatch, SetStateAction } from 'react'

/**
 * Keep the imperative draft mirror and React's render state in lockstep.
 * The ref is the synchronous authority used by refresh/CAS handlers; React
 * state is only the renderer projection of the same resolved value.
 */
export function updateDraftStateAtomically<T>(
  ref: { current: T },
  setState: Dispatch<SetStateAction<T>>,
  next: SetStateAction<T>,
): T {
  const resolved = typeof next === 'function'
    ? (next as (previous: T) => T)(ref.current)
    : next
  ref.current = resolved
  setState(resolved)
  return resolved
}
