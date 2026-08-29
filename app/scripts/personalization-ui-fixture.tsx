import React from 'react'
import { createRoot } from 'react-dom/client'
import { PersonalizationInstructionsSection } from '../src/components/settings/PersonalizationInstructionsSection.tsx'

const projectRoot = '/tmp/personalization-ui-project'
const degradedMode = new URLSearchParams(window.location.search).has('degraded')
let recovered = false
const hash = (letter: string) => letter.repeat(64)
const source = (input: {
  id: string
  kind: string
  scope: 'global' | 'project'
  path?: string
  parentPath?: string
  directoryDepth?: number
  includeDepth?: number
  effectiveOrder?: number | null
  bytes: number
  applied: boolean
  shadowed?: boolean
  content: string
  hash: string
}) => ({
  ...input,
  revision: 12,
  includedBytes: input.applied ? input.bytes : 0,
  droppedBytes: input.applied ? 0 : input.bytes,
  bytesKnown: true,
  metadataStatus: 'content' as const,
  openable: Boolean(input.path),
  deduplicated: false,
  truncated: false,
  shadowed: input.shadowed === true,
})

const globalText = '使用繁體中文，先給結論再列出可執行步驟。'
const personalityText = '保持直接、精確且尊重的語氣。'
const projectText = '本專案使用 pnpm；所有變更先執行 bounded tests。'
const includeText = 'Included local guidance: 保留可稽核的 source provenance。'
const agentsPath = `${projectRoot}/AGENTS.md`
const includePath = `${projectRoot}/shared-guidance.md`
const baseSources = [
  source({ id: 'global-12', kind: 'global-custom', scope: 'global', effectiveOrder: 1, bytes: globalText.length, applied: true, content: globalText, hash: hash('a') }),
  source({ id: 'personality-12', kind: 'personality', scope: 'global', effectiveOrder: 2, bytes: personalityText.length, applied: true, content: personalityText, hash: hash('b') }),
  source({ id: 'project-12', kind: 'project-root', scope: 'project', path: agentsPath, directoryDepth: 0, effectiveOrder: 3, bytes: projectText.length, applied: true, content: projectText, hash: hash('c') }),
  source({ id: 'include-12', kind: 'include', scope: 'project', path: includePath, parentPath: agentsPath, directoryDepth: 0, includeDepth: 1, effectiveOrder: 4, bytes: includeText.length, applied: true, content: includeText, hash: hash('d') }),
  source({ id: 'shadowed-12', kind: 'project-directory', scope: 'project', path: `${projectRoot}/subdir/AGENTS.md`, directoryDepth: 1, effectiveOrder: null, bytes: 22, applied: false, shadowed: true, content: '', hash: hash('f') }),
]
const unauthorizedSource = source({
  id: 'unauthorized-12',
  kind: 'include',
  scope: 'project',
  path: '/tmp/personalization-ui-outside.md',
  parentPath: agentsPath,
  directoryDepth: 0,
  includeDepth: 1,
  effectiveOrder: null,
  bytes: 31,
  applied: false,
  content: '',
  hash: hash('u'),
})
const snapshot = {
  id: 'ui-snapshot-12',
  revision: 12,
  projectIdentity: projectRoot,
  workPath: projectRoot,
  effectiveHash: hash('e'),
  effectiveText: [globalText, personalityText, projectText, includeText].join('\n'),
  globalEffectiveText: [globalText, personalityText].join('\n'),
  presence: { globalCustomInstructions: 'value' as const, advancedPersonalityInstructions: 'value' as const },
  sources: degradedMode ? [...baseSources, unauthorizedSource] : baseSources,
  diagnostics: degradedMode ? [{ code: 'unauthorized', message: 'include target 未獲 exact authorization。', path: unauthorizedSource.path }] : [],
  usage: {
    personalizationBytes: globalText.length + personalityText.length,
    personalizationBudgetBytes: 512,
    projectInstructionBytes: projectText.length + includeText.length,
    projectInstructionBudgetBytes: 1024,
    totalBytes: globalText.length + personalityText.length + projectText.length + includeText.length,
    budgetBytes: 1536,
    lowerAuthorityAvailableBytes: 1536 - (globalText.length + personalityText.length + projectText.length + includeText.length),
  },
  deliveryMode: 'explicit' as const,
  exactSnapshot: true,
}

let currentInstructions = {
  schemaVersion: 1 as const,
  revision: 12,
  globalCustomInstructions: globalText,
  advancedPersonalityInstructions: personalityText,
  personality: 'professional',
  aboutUser: '工程師；偏好繁體中文。',
  responseStyle: '結構清楚，避免冗長寒暄。',
  hash: hash('i'),
  updatedAt: '2026-08-29T00:00:00.000Z',
}
const ledger = {
  save: [] as unknown[],
  export: 0,
  exportMetadata: [] as Array<Record<string, unknown>>,
  previewImport: 0,
  applyImport: 0,
  revision: currentInstructions.revision,
  resolve: 0,
  open: [] as string[],
  projectRead: 0,
  projectWrite: 0,
}

const bridge = {
  get: async () => ({ instructions: currentInstructions }),
  resolve: async () => {
    ledger.resolve += 1
    return {
    instructionSnapshot: recovered
      ? {
          ...snapshot,
          diagnostics: [],
          sources: snapshot.sources.map((item) => item.id === unauthorizedSource.id
            ? { ...item, metadataStatus: 'content' as const, openable: true, applied: true, includedBytes: item.bytes, droppedBytes: 0, effectiveOrder: 5, content: 'authorized include body' }
            : item),
          usage: { ...snapshot.usage, projectInstructionBytes: snapshot.usage.projectInstructionBytes + unauthorizedSource.bytes, totalBytes: snapshot.usage.totalBytes + unauthorizedSource.bytes },
        }
      : snapshot,
    }
  },
  openSource: async ({ path }: { path: string }) => { ledger.open.push(path); return { ok: true as const, path } },
  authorizeInclude: async () => { recovered = true; return { ok: true as const } },
  save: async (input: { globalCustomInstructions: string; advancedPersonalityInstructions: string; personality: string; aboutUser: string; responseStyle: string }) => {
    ledger.save.push({ ...input, expectedRevision: currentInstructions.revision })
    currentInstructions = {
      ...currentInstructions,
      ...input,
      revision: currentInstructions.revision + 1,
      hash: hash('j'),
    }
    ledger.revision = currentInstructions.revision
    return { instructions: currentInstructions }
  },
  exportBundle: async () => {
    ledger.export += 1
    const metadata = { kind: 'agentstudio-personalization', schemaVersion: 1, revision: currentInstructions.revision }
    ledger.exportMetadata.push(metadata)
    return { bundle: { ...metadata, snapshot: currentInstructions } }
  },
  previewImport: async () => { ledger.previewImport += 1; return { preview: { status: 'ready', message: 'fixture import ready', localRevision: currentInstructions.revision } } },
  applyImport: async () => {
    ledger.applyImport += 1
    currentInstructions = {
      ...currentInstructions,
      globalCustomInstructions: 'IMPORTED_FIXTURE_GLOBAL',
      revision: currentInstructions.revision + 1,
      hash: hash('k'),
    }
    ledger.revision = currentInstructions.revision
    return { instructions: currentInstructions }
  },
  projectRead: async ({ target }: { target: string }) => { ledger.projectRead += 1; return { ok: true as const, path: `${projectRoot}/${target}`, content: projectText, hash: hash('c'), bytes: projectText.length, mode: 0o644 } },
  projectWrite: async ({ target }: { target: string }) => { ledger.projectWrite += 1; return { ok: true as const, path: `${projectRoot}/${target}` } },
}

;(window as unknown as { subagents: unknown }).subagents = { piHost: { instructions: bridge } }
;(window as unknown as { __personalizationFixtureLedger: typeof ledger }).__personalizationFixtureLedger = ledger

createRoot(document.getElementById('fixture')!).render(
  <div className="mx-auto w-full max-w-4xl p-4 sm:p-6">
    <PersonalizationInstructionsSection projectRoot={projectRoot} legacy={{}} />
  </div>,
)
