/**
 * Immutable provider connection identity (not vendor brand alone).
 * Same brand + different baseUrl → different IDs.
 */

function stableHash(input: string): string {
  // FNV-1a 32-bit — deterministic, no crypto dependency for identity labels.
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function connectionIdForBuiltinLlm(input: {
  apiProvider: string
  baseUrl: string
  /** Optional stable label if user names a connection later */
  label?: string
}): string {
  const brand = String(input.apiProvider || 'custom').trim().toLowerCase() || 'custom'
  const base = String(input.baseUrl || '').trim().replace(/\/+$/, '').toLowerCase()
  const label = String(input.label || '').trim().toLowerCase()
  const material = `llm|${brand}|${base}|${label}`
  return `llm:${brand}:${stableHash(material)}`
}

export function connectionIdForCliProvider(input: { id: string }): string {
  const id = String(input.id || '').trim().toLowerCase()
  if (!id) throw new Error('CLI provider id is required for connection identity')
  return `cli:${id}`
}
