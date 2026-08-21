/**
 * Plugin input resolution — the one authority on what a v1 plugin's declared
 * inputs resolve to for a run.
 *
 * Used on both sides deliberately: the renderer calls it to decide whether a
 * run is ready or a form is still owed, and Pi Host calls it again before
 * execution so a failed surface, a skipped form, or a forged request can never
 * slip past a required input (issue 07).
 */

import type { PluginInput, PluginInputType } from '../openDesign/pluginContract.ts'

export type PluginInputValue = string | number | boolean
export type PluginInputValues = Record<string, PluginInputValue>

export type PluginInputResolution =
  | { ok: true; values: PluginInputValues }
  | { ok: false; missing: string[]; invalid: Array<{ name: string; reason: string }> }

function coerce(type: PluginInputType, raw: unknown): PluginInputValue | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  switch (type) {
    case 'number': {
      const value = typeof raw === 'number' ? raw : Number(String(raw).trim())
      return Number.isFinite(value) ? value : undefined
    }
    case 'boolean':
      if (typeof raw === 'boolean') return raw
      if (raw === 'true') return true
      if (raw === 'false') return false
      return undefined
    default: {
      const value = String(raw).trim()
      return value ? value.slice(0, 4000) : undefined
    }
  }
}

/**
 * Declared defaults fill in first, then whatever the user supplied. A missing
 * required input is a block, never a silently omitted field.
 */
export function resolvePluginInputs(
  declared: readonly PluginInput[] | undefined,
  provided: Record<string, unknown> | undefined,
): PluginInputResolution {
  const values: PluginInputValues = {}
  const missing: string[] = []
  const invalid: Array<{ name: string; reason: string }> = []

  for (const input of declared ?? []) {
    const supplied = coerce(input.type, provided?.[input.name])
    const fallback = coerce(input.type, input.default)
    const value = supplied ?? fallback

    if (value === undefined) {
      if (input.required) missing.push(input.name)
      continue
    }
    if (input.type === 'select' && input.options?.length && !input.options.includes(String(value))) {
      invalid.push({ name: input.name, reason: `必須是 ${input.options.join(' / ')} 之一。` })
      continue
    }
    values[input.name] = value
  }

  // Unknown keys are dropped rather than forwarded: only declared inputs reach
  // the provider, so a surface cannot smuggle extra fields into execution.
  return missing.length || invalid.length ? { ok: false, missing, invalid } : { ok: true, values }
}

export function pluginInputsMessage(resolution: Extract<PluginInputResolution, { ok: false }>): string {
  const parts: string[] = []
  if (resolution.missing.length) parts.push(`缺少必填輸入：${resolution.missing.join('、')}`)
  for (const item of resolution.invalid) parts.push(`${item.name} ${item.reason}`)
  return `${parts.join('；')}。`
}
