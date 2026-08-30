import React from 'react'
import { createRoot } from 'react-dom/client'
import { PersonalizationInstructionsSection } from '../src/components/settings/PersonalizationInstructionsSection.tsx'

const baseProjectRoot = '/tmp/personalization-ui-project'
const degradedMode = new URLSearchParams(window.location.search).has('degraded')
const query = new URLSearchParams(window.location.search)
const raceMode = query.has('race')
const raceGetMode = raceMode || query.has('race-get')
const raceResolveMode = raceMode || query.has('race-resolve')
const fixtureControls: {
  switchProjectRoot?: (root: string) => void
  releaseOldGet?: () => void
  rejectOldGet?: () => void
  releaseOldResolve?: () => void
  rejectOldResolve?: () => void
  releaseTypingResolve?: () => void
  typingGateEntered?: boolean
  bumpHostGlobal?: () => void
  bumpHostAll?: () => void
  setHostUnset?: () => void
  setHostBlank?: () => void
  rootEffect?: string
} = {}
let releaseOldResolve = () => {}
const oldResolveGate = new Promise<void>((resolve) => { releaseOldResolve = resolve })
let rejectOldResolve = false
let rejectOldGet = false
let releaseOldGet = () => {}
const oldGetGate = new Promise<void>((resolve) => { releaseOldGet = resolve })
let releaseTypingResolve = () => {}
const typingResolveGate = new Promise<void>((resolve) => { releaseTypingResolve = resolve })
const initialProjectRoot = raceGetMode || raceResolveMode ? `${baseProjectRoot}-A` : baseProjectRoot
let recovered = false
const hash = (letter: string) => letter.repeat(64)
const longValue = (prefix: string) => `${prefix}_${'長正文'.repeat(180)}`
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
const agentsPath = `${baseProjectRoot}/AGENTS.md`
const includePath = `${baseProjectRoot}/shared-guidance.md`
const baseSources = [
  source({ id: 'global-12', kind: 'global-custom', scope: 'global', effectiveOrder: 1, bytes: globalText.length, applied: true, content: globalText, hash: hash('a') }),
  source({ id: 'personality-12', kind: 'personality', scope: 'global', effectiveOrder: 2, bytes: personalityText.length, applied: true, content: personalityText, hash: hash('b') }),
  source({ id: 'project-12', kind: 'project-root', scope: 'project', path: agentsPath, directoryDepth: 0, effectiveOrder: 3, bytes: projectText.length, applied: true, content: projectText, hash: hash('c') }),
  source({ id: 'include-12', kind: 'include', scope: 'project', path: includePath, parentPath: agentsPath, directoryDepth: 0, includeDepth: 1, effectiveOrder: 4, bytes: includeText.length, applied: true, content: includeText, hash: hash('d') }),
  source({ id: 'shadowed-12', kind: 'project-directory', scope: 'project', path: `${baseProjectRoot}/subdir/AGENTS.md`, directoryDepth: 1, effectiveOrder: null, bytes: 22, applied: false, shadowed: true, content: '', hash: hash('f') }),
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
  projectIdentity: baseProjectRoot,
  workPath: baseProjectRoot,
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

const snapshotForRoot = (root: string) => ({
  ...snapshot,
  id: `ui-snapshot-${currentInstructions.revision}`,
  revision: currentInstructions.revision,
  presence: {
    globalCustomInstructions: currentInstructions.globalCustomInstructionsPresence ?? 'value',
    advancedPersonalityInstructions: currentInstructions.advancedPersonalityInstructionsPresence ?? 'value',
  },
  projectIdentity: root,
  workPath: root,
  sources: snapshot.sources.map((item) => ({
    ...item,
    path: item.path?.replace(baseProjectRoot, root),
    parentPath: item.parentPath?.replace(baseProjectRoot, root),
  })),
  diagnostics: snapshot.diagnostics.map((item) => ({ ...item, path: item.path?.replace(baseProjectRoot, root) })),
})

type FixtureInstructions = {
  schemaVersion: 1
  revision: number
  globalCustomInstructions: string
  advancedPersonalityInstructions: string
  personality?: string
  aboutUser?: string
  responseStyle?: string
  globalCustomInstructionsPresence?: 'unset' | 'blank' | 'value'
  advancedPersonalityInstructionsPresence?: 'unset' | 'blank' | 'value'
  hash: string
  updatedAt: string
}

let currentInstructions: FixtureInstructions = {
  schemaVersion: 1 as const,
  revision: 12,
  globalCustomInstructions: globalText,
  advancedPersonalityInstructions: personalityText,
  personality: 'professional',
  aboutUser: '工程師；偏好繁體中文。',
  responseStyle: '結構清楚，避免冗長寒暄。',
  globalCustomInstructionsPresence: 'value',
  advancedPersonalityInstructionsPresence: 'value',
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
  get: 0,
  resolve: 0,
  open: [] as string[],
  projectRead: 0,
  projectWrite: 0,
}

fixtureControls.releaseOldResolve = () => releaseOldResolve()
fixtureControls.rejectOldResolve = () => { rejectOldResolve = true }
fixtureControls.rejectOldGet = () => { rejectOldGet = true }
fixtureControls.releaseOldGet = () => releaseOldGet()
fixtureControls.releaseTypingResolve = () => releaseTypingResolve()
fixtureControls.bumpHostGlobal = () => {
  currentInstructions = {
    ...currentInstructions,
    revision: currentInstructions.revision + 1,
    globalCustomInstructions: 'HOST_EXTERNAL_GLOBAL',
    globalCustomInstructionsPresence: 'value',
    hash: hash('h'),
  }
  ledger.revision = currentInstructions.revision
}
fixtureControls.bumpHostAll = () => {
  currentInstructions = {
    ...currentInstructions,
    revision: currentInstructions.revision + 1,
    globalCustomInstructions: longValue('HOST_EXTERNAL_GLOBAL_ALL'),
    advancedPersonalityInstructions: longValue('HOST_EXTERNAL_ADVANCED_ALL'),
    globalCustomInstructionsPresence: 'value',
    advancedPersonalityInstructionsPresence: 'value',
    personality: 'candid',
    aboutUser: longValue('HOST_EXTERNAL_ABOUT_ALL'),
    responseStyle: longValue('HOST_EXTERNAL_RESPONSE_ALL'),
    hash: hash('l'),
  }
  ledger.revision = currentInstructions.revision
}
fixtureControls.setHostUnset = () => {
  const { personality: _personality, aboutUser: _aboutUser, responseStyle: _responseStyle, ...withoutOptional } = currentInstructions
  currentInstructions = {
    ...withoutOptional,
    revision: currentInstructions.revision + 1,
    globalCustomInstructions: '',
    advancedPersonalityInstructions: '',
    globalCustomInstructionsPresence: 'unset',
    advancedPersonalityInstructionsPresence: 'unset',
    hash: hash('m'),
  }
  ledger.revision = currentInstructions.revision
}
fixtureControls.setHostBlank = () => {
  currentInstructions = {
    ...currentInstructions,
    revision: currentInstructions.revision + 1,
    globalCustomInstructions: '',
    advancedPersonalityInstructions: '',
    personality: '',
    aboutUser: '',
    responseStyle: '',
    globalCustomInstructionsPresence: 'blank',
    advancedPersonalityInstructionsPresence: 'blank',
    hash: hash('n'),
  }
  ledger.revision = currentInstructions.revision
}

const bridge = {
  get: async () => {
    ledger.get += 1
    if (raceGetMode && ledger.get === 1) {
      await oldGetGate
      if (rejectOldGet) throw new Error('STALE_OLD_ROOT_GET_ERROR')
    }
    return { instructions: currentInstructions }
  },
  resolve: async ({ projectRoot: requestedRoot }: { projectRoot?: string } = {}) => {
    ledger.resolve += 1
    if (new URLSearchParams(window.location.search).has('typing') && ledger.resolve > 1) {
      fixtureControls.typingGateEntered = true
      await typingResolveGate
    }
    if (raceResolveMode && ledger.resolve === 1) {
      await oldResolveGate
      if (rejectOldResolve) throw new Error('STALE_OLD_ROOT_ERROR')
    }
    const root = requestedRoot || baseProjectRoot
    return {
    instructionSnapshot: recovered
      ? {
          ...snapshotForRoot(root),
          diagnostics: [],
          sources: snapshotForRoot(root).sources.map((item) => item.id === unauthorizedSource.id
            ? { ...item, metadataStatus: 'content' as const, openable: true, applied: true, includedBytes: item.bytes, droppedBytes: 0, effectiveOrder: 5, content: 'authorized include body' }
            : item),
          usage: { ...snapshot.usage, projectInstructionBytes: snapshot.usage.projectInstructionBytes + unauthorizedSource.bytes, totalBytes: snapshot.usage.totalBytes + unauthorizedSource.bytes },
        }
      : snapshotForRoot(root),
    }
  },
  openSource: async ({ path }: { path: string }) => { ledger.open.push(path); return { ok: true as const, path } },
  authorizeInclude: async () => { recovered = true; return { ok: true as const } },
  save: async (input: { expectedRevision: number; globalCustomInstructions: string; advancedPersonalityInstructions: string; personality?: string; aboutUser?: string; responseStyle?: string; globalCustomInstructionsPresence?: 'unset' | 'blank' | 'value'; advancedPersonalityInstructionsPresence?: 'unset' | 'blank' | 'value' }) => {
    if (input.expectedRevision !== currentInstructions.revision) throw new Error(`conflict: expected revision ${input.expectedRevision}, current ${currentInstructions.revision}`)
    ledger.save.push({ ...input, expectedRevision: currentInstructions.revision })
    const next: FixtureInstructions = {
      ...currentInstructions,
      revision: currentInstructions.revision + 1,
      hash: hash('j'),
      globalCustomInstructions: input.globalCustomInstructions,
      advancedPersonalityInstructions: input.advancedPersonalityInstructions,
      globalCustomInstructionsPresence: input.globalCustomInstructionsPresence,
      advancedPersonalityInstructionsPresence: input.advancedPersonalityInstructionsPresence,
    }
    if ('personality' in input) next.personality = input.personality
    else delete next.personality
    if ('aboutUser' in input) next.aboutUser = input.aboutUser
    else delete next.aboutUser
    if ('responseStyle' in input) next.responseStyle = input.responseStyle
    else delete next.responseStyle
    currentInstructions = next
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
  projectRead: async ({ target }: { target: string }) => { ledger.projectRead += 1; return { ok: true as const, path: `${baseProjectRoot}/${target}`, content: projectText, hash: hash('c'), bytes: projectText.length, mode: 0o644 } },
  projectWrite: async ({ target }: { target: string }) => { ledger.projectWrite += 1; return { ok: true as const, path: `${baseProjectRoot}/${target}` } },
}

;(window as unknown as { subagents: unknown }).subagents = { piHost: { instructions: bridge } }
;(window as unknown as { __personalizationFixtureControls: typeof fixtureControls }).__personalizationFixtureControls = fixtureControls
;(window as unknown as { __personalizationFixtureLedger: typeof ledger }).__personalizationFixtureLedger = ledger

function FixtureApp() {
  const [projectRoot, setProjectRoot] = React.useState(initialProjectRoot)
  fixtureControls.switchProjectRoot = setProjectRoot
  React.useEffect(() => { fixtureControls.rootEffect = projectRoot }, [projectRoot])
  return <div className="mx-auto w-full max-w-4xl p-4 sm:p-6"><PersonalizationInstructionsSection projectRoot={projectRoot} legacy={{}} /></div>
}

createRoot(document.getElementById('fixture')!).render(<FixtureApp />)
