export type InstructionDeliveryMode = 'explicit' | 'native' | 'unverified'

export type RecordedInstructionSource = Readonly<{
  id: string
  kind: string
  scope: 'global' | 'project'
  path?: string
  parentPath?: string
  /** Resolver provenance retained when the Electron snapshot provides it. */
  directoryDepth?: number
  /** Resolver include tree depth, retained for replay/UI provenance. */
  includeDepth?: number
  bytesKnown?: boolean
  metadataStatus?: 'content' | 'metadata' | 'unavailable' | 'unauthorized'
  openable?: boolean
  effectiveOrder?: number | null
  revision: number
  bytes: number
  includedBytes: number
  droppedBytes: number
  hash: string
  applied: boolean
  deduplicated: boolean
  truncated: boolean
  shadowed: boolean
  /** Exact bounded model-visible source body; historical replay never rereads disk. */
  content: string
}>

export type RecordedInstructionSnapshot = Readonly<{
  id: string
  revision: number
  projectIdentity?: string
  workPath?: string
  effectiveHash: string
  /** Exact text sent before the current request. */
  effectiveText: string
  /** Expanded global-only segment used by native CLI delivery. */
  globalEffectiveText: string
  presence?: Readonly<{
    globalCustomInstructions: 'unset' | 'blank' | 'value'
    advancedPersonalityInstructions: 'unset' | 'blank' | 'value'
  }>
  sources: readonly RecordedInstructionSource[]
  diagnostics: readonly Readonly<{ code: string; message: string; path?: string; parentPath?: string }>[]
  usage: Readonly<{
    personalizationBytes: number
    personalizationBudgetBytes?: number
    projectInstructionBytes: number
    projectInstructionBudgetBytes?: number
    totalBytes: number
    budgetBytes: number
    lowerAuthorityAvailableBytes?: number
  }>
  deliveryMode: InstructionDeliveryMode
  exactSnapshot: boolean
}>

/**
 * Metadata-only evidence shared by live and replayed run surfaces.  Source
 * bodies deliberately do not cross this presentation boundary; the Turn
 * Record remains the authority for the exact text while this view explains
 * what could (and could not) be proved about delivery.
 */
export type InstructionDeliveryEvidence = Readonly<{
  mode: InstructionDeliveryMode
  exactSnapshot: boolean
  hashAvailable: boolean
  sourceSummary: readonly Readonly<{
    id: string
    kind: string
    scope: 'global' | 'project'
    path?: string
    bytes: number
    hashAvailable: boolean
    status: 'applied' | 'shadowed' | 'deduplicated' | 'degraded'
    effectiveOrder: number | null
  }>[]
  limitationReason?: string
}>

function sourceStatus(source: RecordedInstructionSource): InstructionDeliveryEvidence['sourceSummary'][number]['status'] {
  if (source.deduplicated) return 'deduplicated'
  if (source.shadowed) return 'shadowed'
  if (!source.applied || source.metadataStatus === 'unavailable' || source.metadataStatus === 'unauthorized') return 'degraded'
  return 'applied'
}

/** Project delivery facts without rereading settings or the filesystem. */
export function instructionDeliveryEvidence(snapshot: RecordedInstructionSnapshot): InstructionDeliveryEvidence {
  const sourceSummary = snapshot.sources.map((source) => ({
    id: source.id,
    kind: source.kind,
    scope: source.scope,
    ...(source.path ? { path: source.path } : {}),
    bytes: source.bytes,
    hashAvailable: /^[a-f0-9]{64}$/i.test(source.hash),
    status: sourceStatus(source),
    effectiveOrder: source.effectiveOrder ?? null,
  }))
  const hashAvailable = /^[a-f0-9]{64}$/i.test(snapshot.effectiveHash)
  const limitationReason = snapshot.deliveryMode === 'native'
    ? 'provider-owned native discovery; exact effective text cannot be proven by Host'
    : snapshot.deliveryMode === 'unverified'
      ? 'provider discovery is unavailable, so explicit delivery is not verified'
      : undefined
  return Object.freeze({
    mode: snapshot.deliveryMode,
    exactSnapshot: snapshot.exactSnapshot,
    hashAvailable,
    sourceSummary: Object.freeze(sourceSummary),
    ...(limitationReason ? { limitationReason } : {}),
  })
}

/**
 * Provider-side redaction is intentionally performed by the owner of the
 * provider boundary (Pi Host or the external CLI adapter).  Once each text
 * fragment has been prepared, both boundaries must use this one pure mapper
 * to rebuild hashes, source accounting and the immutable identity.  Keeping
 * this conversion here prevents the two delivery paths from quietly drifting.
 */
export type SanitizedInstructionTexts = Readonly<{
  effectiveText: string
  globalEffectiveText: string
  sourceContents: readonly string[]
}>

export async function mapSanitizedInstructionSnapshot<T extends RecordedInstructionSnapshot>(
  snapshot: T,
  texts: SanitizedInstructionTexts,
  hashText: (text: string) => string | Promise<string>,
): Promise<T> {
  if (texts.sourceContents.length !== snapshot.sources.length) {
    throw new Error('sanitized instruction source count mismatch')
  }
  const effectiveBytes = new TextEncoder().encode(texts.effectiveText).byteLength
  const globalBytes = new TextEncoder().encode(texts.globalEffectiveText).byteLength
  if (effectiveBytes > snapshot.usage.budgetBytes || globalBytes > snapshot.usage.budgetBytes) {
    throw new Error('sanitized instruction text exceeds its admitted context budget')
  }
  const sources = await Promise.all(snapshot.sources.map(async (source, index) => {
    // Degraded/shadowed/oversized provenance is never a provider-visible body,
    // even when a caller supplies a stale or redacted parallel content array.
    const content = source.applied ? texts.sourceContents[index] || '' : ''
    const includedBytes = source.applied ? new TextEncoder().encode(content).byteLength : 0
    // `includedBytes` is measured after sanitization.  A fixed redaction
    // marker can be a few bytes longer than a short protected span, so source
    // accounting must report the actual delivered bytes rather than silently
    // clipping the marker.  The effective/global budget checks above remain
    // fail-closed for total context growth.
    return Object.freeze({
      ...source,
      content,
      // Non-applied provenance rows intentionally carry no body to the
      // provider, but their original source hash remains part of the exact
      // snapshot so replay can identify the degraded/shadowed source.
      hash: source.applied ? await hashText(content) : source.hash,
      includedBytes,
      droppedBytes: Math.max(0, source.bytes - includedBytes),
    })
  }))
  const effectiveHash = await hashText(texts.effectiveText)
  const idHash = await hashText(`${snapshot.id}:${effectiveHash}`)
  // Category usage is measured from the exact sanitized source bodies, not
  // reallocated from the old proportions. This keeps a redacted global source
  // and a redacted project source attributable to their real delivered bytes.
  const personalizationBytes = sources.reduce((total, source) =>
    total + (source.scope === 'global' && source.applied ? source.includedBytes : 0), 0)
  const projectInstructionBytes = sources.reduce((total, source) =>
    total + (source.scope === 'project' && source.applied ? source.includedBytes : 0), 0)
  const totalBytes = personalizationBytes + projectInstructionBytes
  if (totalBytes > snapshot.usage.budgetBytes) {
    throw new Error('sanitized instruction sources exceed their admitted context budget')
  }
  return Object.freeze({
    ...snapshot,
    id: `ins_${idHash.slice(0, 20)}`,
    effectiveText: texts.effectiveText,
    globalEffectiveText: texts.globalEffectiveText,
    effectiveHash,
    sources: Object.freeze(sources),
    usage: Object.freeze({
      ...snapshot.usage,
      personalizationBytes,
      projectInstructionBytes,
      totalBytes,
      lowerAuthorityAvailableBytes: Math.max(0, snapshot.usage.budgetBytes - totalBytes),
    }),
  }) as T
}
