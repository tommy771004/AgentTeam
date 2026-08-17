import type {
  SubDesignArtifact,
  SubDesignArtifactExport,
  SubDesignArtifactKind,
  SubDesignArtifactRenderer,
  SubDesignArtifactTweak,
} from './types.ts'

const KINDS: readonly SubDesignArtifactKind[] = [
  'html',
  'deck',
  'react-component',
  'markdown-document',
  'svg',
  'design-system',
]
const RENDERERS: readonly SubDesignArtifactRenderer[] = [
  'html',
  'deck-html',
  'markdown',
  'svg',
  'code',
  'design-system',
]
const EXPORTS: readonly SubDesignArtifactExport[] = ['html', 'pdf', 'zip', 'pptx', 'mp4', 'jsx', 'md', 'svg', 'txt']

function text(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max)
}

export function isProjectRelativePath(value: string): boolean {
  const path = value.replaceAll('\\', '/')
  if (!path || path.includes('\0') || path.startsWith('/') || /^[a-zA-Z]:\//.test(path)) return false
  return path.split('/').every((segment) => segment && segment !== '..' && segment !== '.')
}

function safeList(value: unknown, max = 80): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => text(item, 600)).filter(Boolean))]
    .filter(isProjectRelativePath)
    .slice(0, max)
}

function safeTweak(value: unknown): SubDesignArtifactTweak | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const id = text(raw.id, 80)
  const label = text(raw.label, 160)
  const kind = raw.kind
  const path = text(raw.path, 1000).replaceAll('\\', '/')
  const find = String(raw.find ?? '').slice(0, 12_000)
  const replaceTemplate = String(raw.replaceTemplate ?? '').slice(0, 12_000)
  if (!id || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(id) || !label || !isProjectRelativePath(path) || !find || !replaceTemplate.includes('{{value}}')) return null
  if (!['color', 'text', 'number', 'select', 'boolean'].includes(String(kind))) return null
  const tweak: SubDesignArtifactTweak = {
    id,
    label,
    kind: kind as SubDesignArtifactTweak['kind'],
    path,
    find,
    replaceTemplate,
    value: String(raw.value ?? raw.defaultValue ?? '').slice(0, 12_000),
    defaultValue: String(raw.defaultValue ?? '').slice(0, 12_000) || undefined,
  }
  for (const key of ['min', 'max', 'step'] as const) {
    const number = Number(raw[key])
    if (Number.isFinite(number)) tweak[key] = number
  }
  const options = Array.isArray(raw.options) ? [...new Set(raw.options.map((item) => text(item, 160)).filter(Boolean))].slice(0, 32) : []
  if (options.length) tweak.options = options
  if (tweak.kind === 'select' && !tweak.options?.length) return null
  return tweak
}

function safeTweaks(value: unknown): SubDesignArtifactTweak[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.map(safeTweak).filter((item): item is SubDesignArtifactTweak => Boolean(item)).filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  }).slice(0, 32)
}

export function validateSubDesignArtifactManifest(
  input: unknown,
  defaults?: { briefId?: string; designSystemId?: string },
): { ok: true; manifest: SubDesignArtifact } | { ok: false; errors: string[] } {
  if (!input || typeof input !== 'object') return { ok: false, errors: ['manifest 必須是 object。'] }
  const raw = input as Record<string, unknown>
  const id = text(raw.id, 120)
  const title = text(raw.title, 240)
  const entry = text(raw.entry, 1000).replaceAll('\\', '/')
  const briefId = text(raw.briefId, 120) || defaults?.briefId || ''
  const kind = raw.kind as SubDesignArtifactKind
  const renderer = raw.renderer as SubDesignArtifactRenderer
  const errors: string[] = []
  if (!id || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(id)) errors.push('id 不合法。')
  if (!title) errors.push('title 必填。')
  if (!briefId) errors.push('briefId 必填。')
  if (!isProjectRelativePath(entry)) errors.push('entry 必須是 project-relative path，且不可包含 ..。')
  if (!KINDS.includes(kind)) errors.push(`kind 不支援：${String(raw.kind)}`)
  if (!RENDERERS.includes(renderer)) errors.push(`renderer 不支援：${String(raw.renderer)}`)
  const exports = Array.isArray(raw.exports)
    ? [...new Set(raw.exports.filter((item): item is SubDesignArtifactExport => EXPORTS.includes(item as SubDesignArtifactExport)))]
    : []
  const supportingFiles = safeList(raw.supportingFiles)
  if (Array.isArray(raw.supportingFiles) && supportingFiles.length !== raw.supportingFiles.length) {
    errors.push('supportingFiles 必須全部是 project-relative paths。')
  }
  const status = raw.status === 'streaming' || raw.status === 'error' ? raw.status : 'complete'
  const tweaks = safeTweaks(raw.tweaks)
  if (Array.isArray(raw.tweaks) && tweaks.length !== raw.tweaks.length) errors.push('tweaks 含有不合法的控制項。')
  const revision = Number.isFinite(Number(raw.revision)) ? Math.max(1, Math.floor(Number(raw.revision))) : 1
  if (errors.length) return { ok: false, errors }
  const now = new Date().toISOString()
  return {
    ok: true,
    manifest: {
      id,
      briefId,
      kind,
      title,
      entry,
      renderer,
      exports,
      supportingFiles,
      tweaks: tweaks.length ? tweaks : undefined,
      designSystemId: text(raw.designSystemId, 120) || defaults?.designSystemId || undefined,
      status,
      revision,
      createdAt: text(raw.createdAt, 40) || now,
      updatedAt: text(raw.updatedAt, 40) || now,
    },
  }
}
