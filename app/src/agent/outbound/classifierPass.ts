import { callCompanyClassifier, mergeAdditiveExclusions, type ClassifierExclusion } from './companyClassifier.ts'
import type { OutboundGuardMode } from './outboundGate.ts'

/**
 * The company classifier, applied to a Sanitized Workspace before anything
 * leaves (issue 21).
 *
 * `companyClassifier.ts` has existed with a smoke and a Settings "test
 * connection" button since it was written, but nothing ever called it on the
 * real outbound path — so configuring an endpoint changed nothing about what
 * was actually sent. This is the pass that makes the setting mean something.
 *
 * The classifier is ADDITIVE by construction: it may only ask for MORE to be
 * excluded, never less. A classifier that could un-exclude would be a way to
 * widen egress from outside the gate.
 */

export type ClassifierPassOutcome =
  | { status: 'not-configured' }
  | { status: 'applied'; added: number; files: number; transport: 'https' | 'http' }
  | { status: 'degraded'; reason: string }
  | { status: 'blocked'; reason: string }

export type ClassifierPassInput = {
  endpointUrl?: string
  allowPlaintextHttp?: boolean
  effectiveMode: OutboundGuardMode
  connectionId: string
  /** Each sanitized file the classifier should see, with its already-sanitized text. */
  files: ReadonlyArray<{ relPath: string; text: string }>
  /** Exclusions the local profile already produced, merged in place per file. */
  applyExclusions: (relPath: string, added: ClassifierExclusion[]) => void
  fetchImpl?: typeof fetch
}

/**
 * Run the classifier over every sanitized file and merge what it returns.
 *
 * The failure posture follows the same law the rest of the Outbound Data Gate
 * uses (ADR-0047/0051) rather than inventing a policy: under `required` a
 * classifier that cannot answer BLOCKS, because "we could not check" is not
 * evidence that the content is safe to send. Under `optional`/`demo` it
 * degrades with an explicit reason, and under `off` it does not run at all.
 */
export async function runClassifierPass(input: ClassifierPassInput): Promise<ClassifierPassOutcome> {
  const endpoint = (input.endpointUrl || '').trim()
  if (input.effectiveMode === 'off' || !endpoint) return { status: 'not-configured' }

  let added = 0
  let touched = 0
  let transport: 'https' | 'http' = 'https'

  for (const file of input.files) {
    if (!file.text.trim()) continue
    const result = await callCompanyClassifier({
      endpointUrl: endpoint,
      allowPlaintextHttp: input.allowPlaintextHttp === true,
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
      request: {
        providerId: input.connectionId,
        sourceKind: 'file',
        sourceName: file.relPath,
        chunk: file.text,
      },
    })
    if (!result.ok) {
      const reason = `company classifier could not classify ${file.relPath}: ${result.reason}`
      // One unanswerable file is enough to stop the run under `required`: a
      // partial classification would let exactly the unchecked file through.
      return input.effectiveMode === 'required'
        ? { status: 'blocked', reason }
        : { status: 'degraded', reason }
    }
    transport = result.transport
    if (result.exclusions.length) {
      input.applyExclusions(file.relPath, result.exclusions)
      added += result.exclusions.length
      touched += 1
    }
  }

  return { status: 'applied', added, files: touched, transport }
}

/** Re-export so callers merge through one implementation. */
export { mergeAdditiveExclusions }
