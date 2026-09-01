import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join, relative, resolve, isAbsolute } from 'node:path'
import { registerPiExtensionPack, type PiPackTool, type PiToolContext } from '../piToolHost.ts'
import { withFileMutationQueue } from '../piVendor.ts'
import {
  createSubDesignBrief,
  normalizeBrief,
  selectSubDesignDirection,
  transitionSubDesignStage,
  updateSubDesignBrief,
} from '../../src/agent/subdesign/brief.ts'
import {
  clampScore,
  critiqueAllowsDeliver,
  normalizeFindings,
  normalizeSubDesignCritique,
} from '../../src/agent/subdesign/critique.ts'
import { validateSubDesignArtifactManifest } from '../../src/agent/subdesign/artifactManifest.ts'
import { validatePinnedPatchOperation, type PinnedPatchScope } from '../../src/agent/subdesign/pinnedPatchScope.ts'
import { jsonOk, structuredFailure } from './packResults.ts'
import { requestPiHostService } from '../piHostServices.ts'

/**
 * SubDesign pack（設計流程包）— brief → direction → build → critique →
 * deliver on the shipped Host.
 *
 * The tools read and write the SAME metadata files the app's SubDesign
 * Studio uses — `.subagents/subdesign/{briefs,critiques,evidence,exports}`
 * and artifact manifests under `.subagents/subdesign/artifacts/<id>/manifest.json`
 * — and every verdict is computed by the SAME shared critique normalizer the
 * Studio answers to. No second store, no second scoring opinion. The
 * fail-closed rules are inherited, not reimplemented: a pass without the
 * required screenshot/dom/lint evidence, without executed gates, or with
 * blocker findings cannot survive normalization, and deliver refuses until
 * `critiqueAllowsDeliver` says yes.
 */

const METADATA_ROOT = '.subagents/subdesign'
const ARTIFACT_ROOT = '.subagents/subdesign/artifacts'

function safeId(value: unknown): string | undefined {
  const id = String(value || '').trim()
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(id) ? id : undefined
}

function insideRoot(root: string, target: string): string | undefined {
  if (!target.trim()) return undefined
  const full = resolve(root, target)
  const rel = relative(root, full)
  if (rel.startsWith('..') || isAbsolute(rel)) return undefined
  return full
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return undefined
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function mergeCritiqueEvidence(
  root: string,
  artifactId: string,
  revision: number,
  incoming: Record<string, unknown>[],
): Promise<void> {
  const draftPath = insideRoot(root, `${METADATA_ROOT}/critiques/${artifactId}-r${revision}.json`)!
  const draft = (await readJson(draftPath) || {}) as Record<string, unknown>
  const replacements = new Set(incoming.map((item) => `${String(item.kind || '')}:${String(item.gateId || '')}`))
  const existing = Array.isArray(draft.evidence)
    ? draft.evidence.filter((entry) => {
      if (!entry || typeof entry !== 'object') return false
      const item = entry as Record<string, unknown>
      return !replacements.has(`${String(item.kind || '')}:${String(item.gateId || '')}`)
    })
    : []
  draft.evidence = [...existing, ...incoming]
  await writeJson(draftPath, draft)
}

async function loadManifest(ctx: PiToolContext, artifactId: string) {
  const validation = validateSubDesignArtifactManifest(await readJson(insideRoot(ctx.cwd, `${ARTIFACT_ROOT}/${artifactId}/manifest.json`)!))
  if (!validation.ok) return validation
  return validation
}



/* ── Brief / direction / stage ─────────────────────────────────────────── */

const designBriefUpdate: PiPackTool = {
  name: 'design_brief_update',
  label: 'Design Brief Update',
  description: 'Create or update the SubDesign brief for this project',
  promptSnippet: 'create or update the SubDesign design brief',
  parameters: {
    type: 'object',
    properties: {
      briefId: { type: 'string', description: 'Existing brief id; omit to create' },
      objective: { type: 'string' },
      surface: { type: 'string', description: 'Surface when creating, e.g. web-page' },
      audience: { type: 'string' },
      constraints: { type: 'array', items: { type: 'string' } },
      acceptanceCriteria: { type: 'array', items: { type: 'string' } },
      nextStage: { type: 'string', enum: ['brief', 'direction', 'build', 'critique', 'deliver'] },
    },
  },
  execute: async (args, ctx) => {
    let brief = args.briefId ? normalizeBrief(await readJson(insideRoot(ctx.cwd, `${METADATA_ROOT}/briefs/${String(args.briefId)}.json`)!)) : null
    if (!brief) {
      if (!String(args.objective || '').trim()) return structuredFailure('建立 brief 需要 objective')
      brief = createSubDesignBrief({
        threadId: ctx.sessionId,
        // The surface union validates downstream; an unknown value fails the
        // write instead of being coerced.
        surface: String(args.surface || 'web-page') as never,
        objective: String(args.objective || ''),
        constraints: Array.isArray(args.constraints) ? args.constraints.map(String) : [],
        acceptanceCriteria: Array.isArray(args.acceptanceCriteria) ? args.acceptanceCriteria.map(String) : [],
      })
    }
    let next = updateSubDesignBrief(brief, {
      ...(args.objective !== undefined ? { objective: String(args.objective) } : {}),
      ...(args.audience !== undefined ? { audience: String(args.audience) } : {}),
      ...(Array.isArray(args.constraints) ? { constraints: args.constraints.map(String) } : {}),
      ...(Array.isArray(args.acceptanceCriteria) ? { acceptanceCriteria: args.acceptanceCriteria.map(String) } : {}),
    })
    if (args.nextStage) {
      const moved = transitionSubDesignStage(next, String(args.nextStage) as never)
      if (!moved.ok) return structuredFailure(moved.error)
      next = moved.brief
    }
    await writeJson(insideRoot(ctx.cwd, `${METADATA_ROOT}/briefs/${next.id}.json`)!, next)
    return jsonOk({ briefId: next.id, stage: next.stage, selectedDirectionId: next.selectedDirectionId ?? null })
  },
}

const designDirectionSelect: PiPackTool = {
  name: 'design_direction_select',
  label: 'Design Direction Select',
  description: 'Pick the design direction a build will follow',
  promptSnippet: 'select the design direction to build against',
  parameters: {
    type: 'object',
    properties: {
      briefId: { type: 'string' },
      directionId: { type: 'string', description: 'Direction to select' },
      title: { type: 'string', description: 'New direction title when introducing one' },
      summary: { type: 'string', description: 'New direction summary when introducing one' },
    },
    required: ['briefId', 'directionId'],
  },
  execute: async (args, ctx) => {
    const briefId = safeId(args.briefId)
    if (!briefId) return structuredFailure('不安全的 briefId')
    const brief = normalizeBrief(await readJson(insideRoot(ctx.cwd, `${METADATA_ROOT}/briefs/${briefId}.json`)!))
    if (!brief) return structuredFailure(`找不到 brief：${briefId}`)
    const result = selectSubDesignDirection(brief, String(args.directionId || ''), {
      title: typeof args.title === 'string' ? args.title : undefined,
      summary: typeof args.summary === 'string' ? args.summary : undefined,
    })
    if (!result.ok) return structuredFailure(result.error)
    await writeJson(insideRoot(ctx.cwd, `${METADATA_ROOT}/briefs/${briefId}.json`)!, result.brief)
    return jsonOk({ briefId, selectedDirectionId: result.brief.selectedDirectionId ?? null, stage: result.brief.stage })
  },
}

/* ── Artifacts ──────────────────────────────────────────────────────────── */

const designArtifactRegister: PiPackTool = {
  name: 'design_artifact_register',
  label: 'Design Artifact Register',
  description: 'Register a build artifact manifest',
  promptSnippet: 'register a design artifact manifest',
  parameters: {
    type: 'object',
    properties: { manifest: { type: 'object', description: 'Full artifact manifest object' } },
    required: ['manifest'],
  },
  approval: () => ({ need: true, reason: 'design_artifact_register 寫入專案 artifact store' }),
  execute: async (args, ctx) => {
    const validation = validateSubDesignArtifactManifest(args.manifest)
    if (!validation.ok) return structuredFailure(`artifact manifest invalid：${validation.errors.join('；')}`)
    const manifestPath = insideRoot(ctx.cwd, `${ARTIFACT_ROOT}/${validation.manifest.id}/manifest.json`)!
    await withFileMutationQueue(manifestPath, () =>
      mkdir(join(manifestPath, '..'), { recursive: true }).then(() => writeFile(manifestPath, `${JSON.stringify(validation.manifest, null, 2)}\n`, 'utf8')))
    return jsonOk({ artifactId: validation.manifest.id, revision: validation.manifest.revision, entry: validation.manifest.entry })
  },
}

const designArtifactCapture: PiPackTool = {
  name: 'design_artifact_capture',
  label: 'Design Artifact Capture',
  description: 'Read the current state of a registered artifact',
  promptSnippet: 'read back a registered design artifact',
  parameters: {
    type: 'object',
    properties: { artifactId: { type: 'string' } },
    required: ['artifactId'],
  },
  execute: async (args, ctx) => {
    const artifactId = safeId(args.artifactId)
    if (!artifactId) return structuredFailure('不安全的 artifactId')
    const validation = await loadManifest(ctx, artifactId)
    if (!validation.ok) return structuredFailure(`artifact manifest invalid：${validation.errors.join('；')}`)
    const captured: Record<string, unknown>[] = []
    for (const kind of ['screenshot', 'dom'] as const) {
      const result = await requestPiHostService<{ ok: boolean; error?: string } & Record<string, unknown>>(
        'subdesign/capture-evidence',
        { artifact: validation.manifest, projectRoot: ctx.cwd, kind },
      )
      if (!result.ok) return structuredFailure(result.error || `${kind} evidence capture 失敗`)
      captured.push({ kind, summary: `Host 已擷取 ${kind} evidence。`, ...result })
    }
    await mergeCritiqueEvidence(ctx.cwd, artifactId, validation.manifest.revision, captured)
    return jsonOk({ artifactId, revision: validation.manifest.revision, evidenceKinds: captured.map((item) => item.kind) })
  },
}

/** Exact-replacement patch over artifact files, mirroring main's patcher rules. */
async function patchManifestFiles(
  root: string,
  manifest: { entry: string; supportingFiles: string[] },
  operations: Array<{ path?: unknown; find?: unknown; replace?: unknown; expectedMatches?: unknown }>,
  scope?: PinnedPatchScope,
): Promise<{ ok: true; paths: string[] } | { ok: false; error: string }> {
  const allowedPaths = new Set([manifest.entry, ...manifest.supportingFiles])
  const nextByPath = new Map<string, string>()
  for (const operation of operations.slice(0, 12)) {
    const relativePath = String(operation.path || '').trim().replaceAll('\\', '/')
    const find = String(operation.find || '')
    const replace = String(operation.replace ?? '')
    const expectedMatches = Math.max(1, Math.min(12, Math.floor(Number(operation.expectedMatches) || 1)))
    if (!allowedPaths.has(relativePath)) return { ok: false, error: `patch path 不是 artifact entry/supporting file：${relativePath}` }
    if (!find || find.length > 12_000 || replace.length > 12_000) return { ok: false, error: 'patch find/replace 不合法或超過 12KB。' }
    const file = insideRoot(root, relativePath)
    if (!file) return { ok: false, error: `patch path 逃出專案範圍：${relativePath}` }
    let content = nextByPath.get(relativePath)
    if (content == null) {
      const bytes = await readFile(file)
      if (bytes.includes(0)) return { ok: false, error: `patch 只支援文字 artifact file：${relativePath}` }
      content = bytes.toString('utf8')
    }
    if (scope) {
      if (relativePath !== scope.path) return { ok: false, error: `pinned patch 只允許修改 ${scope.path}。` }
      const scoped = validatePinnedPatchOperation({
        content,
        selectors: scope.selectors,
        find,
        expectedMatches,
      })
      if (!scoped.ok) return { ok: false, error: scoped.reason }
    }
    const matches = content.split(find).length - 1
    if (matches !== expectedMatches) return { ok: false, error: `patch ${relativePath} 找到 ${matches} 個匹配，預期 ${expectedMatches} 個；為避免誤改已停止。` }
    nextByPath.set(relativePath, content.split(find).join(replace))
  }
  for (const [relativePath, content] of nextByPath) {
    const file = insideRoot(root, relativePath)!
    await withFileMutationQueue(file, () => writeFile(file, content, 'utf8'))
  }
  return { ok: true, paths: [...nextByPath.keys()] }
}

const designArtifactPatch: PiPackTool = {
  name: 'design_artifact_patch',
  label: 'Design Artifact Patch',
  description: 'Apply exact-replacement edits to artifact files',
  promptSnippet: 'apply exact-match patches to artifact files',
  parameters: {
    type: 'object',
    properties: {
      artifactId: { type: 'string' },
      scopeId: { type: 'string', description: 'Pinned-comment run 提供的 Host patch scope id' },
      operations: { type: 'array', description: 'Each: {path, find, replace, expectedMatches}', items: { type: 'object' } },
    },
    required: ['artifactId', 'operations'],
  },
  approval: () => ({ need: true, reason: 'design_artifact_patch 會修改專案檔案' }),
  execute: async (args, ctx) => {
    const artifactId = safeId(args.artifactId)
    if (!artifactId) return structuredFailure('不安全的 artifactId')
    const validation = await loadManifest(ctx, artifactId)
    if (!validation.ok) return structuredFailure(`artifact manifest invalid：${validation.errors.join('；')}`)
    if (!Array.isArray(args.operations) || !args.operations.length) return structuredFailure('operations 必須至少包含一個 exact replacement。')
    const scopePath = insideRoot(ctx.cwd, `${METADATA_ROOT}/pin-scopes/${artifactId}.json`)!
    const rawScope = await readJson(scopePath) as Partial<PinnedPatchScope> | undefined
    let scope: PinnedPatchScope | undefined
    if (rawScope) {
      if (rawScope.schemaVersion !== 1 || typeof rawScope.runId !== 'string' || rawScope.artifactId !== artifactId || rawScope.revision !== validation.manifest.revision || !Array.isArray(rawScope.selectors)) {
        await unlink(scopePath).catch(() => undefined)
        return structuredFailure('pinned patch scope 與目前 artifact revision 不一致；請重新選取 pin。')
      }
      if (Date.parse(String(rawScope.expiresAt || '')) <= Date.now()) {
        await unlink(scopePath).catch(() => undefined)
        if (args.scopeId) return structuredFailure('pinned patch scope 已過期；請重新選取 pin。')
      } else {
        if (rawScope.runId !== ctx.runId) {
          return structuredFailure('pinned patch scope 不屬於目前 run。')
        }
        if (!args.scopeId || args.scopeId !== rawScope.scopeId) {
          return structuredFailure('此 artifact 有啟用中的 pinned patch scope；scopeId 缺少或不一致。')
        }
        scope = rawScope as PinnedPatchScope
      }
    }
    const patched = await patchManifestFiles(ctx.cwd, validation.manifest, args.operations as never, scope)
    if (!patched.ok) return structuredFailure(patched.error)
    const next = { ...validation.manifest, revision: validation.manifest.revision + 1, updatedAt: new Date().toISOString() }
    const manifestPath = insideRoot(ctx.cwd, `${ARTIFACT_ROOT}/${artifactId}/manifest.json`)!
    await withFileMutationQueue(manifestPath, () => writeFile(manifestPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8'))
    if (scope) await unlink(scopePath).catch(() => undefined)
    return jsonOk({ artifactId, revision: next.revision, paths: patched.paths })
  },
}

const designArtifactTweak: PiPackTool = {
  name: 'design_artifact_tweak',
  label: 'Design Artifact Tweak',
  description: 'Apply one named single-marker tweak to an artifact entry',
  promptSnippet: 'apply one named tweak marker replacement',
  parameters: {
    type: 'object',
    properties: {
      artifactId: { type: 'string' },
      tweakId: { type: 'string', description: 'Marker name in the entry, e.g. ACCENT' },
      value: { type: 'string', description: 'Replacement value' },
    },
    required: ['artifactId', 'tweakId', 'value'],
  },
  approval: () => ({ need: true, reason: 'design_artifact_tweak 會修改專案檔案' }),
  execute: async (args, ctx) => {
    const artifactId = safeId(args.artifactId)
    if (!artifactId) return structuredFailure('不安全的 artifactId')
    const validation = await loadManifest(ctx, artifactId)
    if (!validation.ok) return structuredFailure(`artifact manifest invalid：${validation.errors.join('；')}`)
    const tweakId = String(args.tweakId || '').trim().toUpperCase()
    if (!/^[A-Z0-9_]{1,60}$/.test(tweakId)) return structuredFailure('不安全的 tweakId')
    const patched = await patchManifestFiles(ctx.cwd, validation.manifest, [{
      path: validation.manifest.entry,
      find: `{{${tweakId}}}`,
      replace: String(args.value ?? ''),
      expectedMatches: 1,
    }])
    if (!patched.ok) return structuredFailure(patched.error.replaceAll('{{', '').replaceAll('}}', ''))
    const next = { ...validation.manifest, revision: validation.manifest.revision + 1, updatedAt: new Date().toISOString() }
    const manifestPath = insideRoot(ctx.cwd, `${ARTIFACT_ROOT}/${artifactId}/manifest.json`)!
    await withFileMutationQueue(manifestPath, () => writeFile(manifestPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8'))
    return jsonOk({ artifactId, revision: next.revision, tweaked: tweakId })
  },
}

const designArtifactLint: PiPackTool = {
  name: 'design_artifact_lint',
  label: 'Design Artifact Lint',
  description: 'Lint a registered artifact manifest and its files',
  promptSnippet: 'lint a registered artifact for structural problems',
  parameters: {
    type: 'object',
    properties: { artifactId: { type: 'string' } },
    required: ['artifactId'],
  },
  execute: async (args, ctx) => {
    const artifactId = safeId(args.artifactId)
    if (!artifactId) return structuredFailure('不安全的 artifactId')
    const validation = await loadManifest(ctx, artifactId)
    if (!validation.ok) return structuredFailure(`artifact manifest invalid：${validation.errors.join('；')}`)
    const result = await requestPiHostService<{ ok: boolean; evidence?: Record<string, unknown>; findings?: unknown[]; error?: string }>(
      'subdesign/lint-evidence',
      { artifact: validation.manifest, projectRoot: ctx.cwd },
    )
    if (!result.ok || !result.evidence) return structuredFailure(result.error || 'lint evidence 產生失敗')
    await mergeCritiqueEvidence(ctx.cwd, artifactId, validation.manifest.revision, [{ kind: 'lint', ...result.evidence }])
    return jsonOk({ artifactId, revision: validation.manifest.revision, lint: 'measured', findings: result.findings?.length || 0 })
  },
}

/* ── Critique and gates ─────────────────────────────────────────────── */

const SEVERITY_MAP: Record<string, 'blocker' | 'warning' | 'note'> = { blocker: 'blocker', warn: 'warning', warning: 'warning', info: 'note', note: 'note' }

const designCritiqueNote: PiPackTool = {
  name: 'design_critique_note',
  label: 'Design Critique Note',
  description: 'Add one finding to the working critique of the current revision',
  promptSnippet: 'record one critique finding for the current revision',
  parameters: {
    type: 'object',
    properties: {
      artifactId: { type: 'string' },
      severity: { type: 'string', enum: ['info', 'warn', 'blocker'] },
      finding: { type: 'string' },
    },
    required: ['artifactId', 'finding'],
  },
  execute: async (args, ctx) => {
    const artifactId = safeId(args.artifactId)
    if (!artifactId) return structuredFailure('不安全的 artifactId')
    const validation = await loadManifest(ctx, artifactId)
    if (!validation.ok) return structuredFailure(`artifact manifest invalid：${validation.errors.join('；')}`)
    const revision = validation.manifest.revision
    const draftPath = insideRoot(ctx.cwd, `${METADATA_ROOT}/critiques/${artifactId}-r${revision}.json`)!
    const draft = (await readJson(draftPath) || {}) as Record<string, unknown>
    const severity = SEVERITY_MAP[String(args.severity || 'info')] || 'note'
    const finding = { severity, message: String(args.finding || '') }
    draft.findings = [...normalizeFindings([...(Array.isArray(draft.findings) ? draft.findings : []), finding])]
    await writeJson(draftPath, draft)
    return jsonOk({ artifactId, revision, findings: (draft.findings as unknown[]).length })
  },
}

/**
 * One gate run becomes an ATTESTED evidence record: the referenced evidence
 * file must exist, its sha256 travels with the record, and the record lands
 * in `.subagents/subdesign/evidence/`. The model cannot manufacture a pass —
 * there is no parameter that asserts one without a file behind it.
 */
type GateSpec = { id: string; label: string }

function gateTool(spec: GateSpec): PiPackTool {
  return {
    name: `design_gate_${spec.id.replace(/-/g, '_')}`,
    label: spec.label,
    description: `Run the ${spec.id} verification gate in Electron main and return Host-attested evidence`,
    promptSnippet: `run ${spec.id} gate measurement (Host-owned, fail-closed)`,
    parameters: {
      type: 'object',
      properties: {
        artifactId: { type: 'string' },
      },
      required: ['artifactId'],
    },
    execute: async (args, ctx) => {
      const artifactId = safeId(args.artifactId)
      if (!artifactId) return structuredFailure('不安全的 artifactId')
      const validation = await loadManifest(ctx, artifactId)
      if (!validation.ok) return structuredFailure(`artifact manifest invalid：${validation.errors.join('；')}`)
      const brief = normalizeBrief(await readJson(insideRoot(ctx.cwd, `${METADATA_ROOT}/briefs/${validation.manifest.briefId}.json`)!))
      if (!brief) return structuredFailure(`找不到 artifact 對應的 brief：${validation.manifest.briefId}`)
      if (brief.stage !== 'critique') {
        return structuredFailure(`design gate 只允許在 Critique stage 執行；目前 stage：${brief.stage}`)
      }
      const measured = await requestPiHostService<{ ok: boolean; evidence?: Record<string, unknown>; error?: string }>(
        'subdesign/run-gate',
        { gateId: spec.id, artifact: validation.manifest, projectRoot: ctx.cwd },
      )
      if (!measured.ok || !measured.evidence) return structuredFailure(measured.error || `${spec.id} gate 量測失敗`)
      // The gate evidence merges into the working critique draft immediately,
      // so the eventual normalization sees it.
      const revision = validation.manifest.revision
      const draftPath = insideRoot(ctx.cwd, `${METADATA_ROOT}/critiques/${artifactId}-r${revision}.json`)!
      const draft = (await readJson(draftPath) || {}) as Record<string, unknown>
      const existing = Array.isArray(draft.evidence) ? draft.evidence.filter((entry) => !((entry as Record<string, unknown>).gateId === spec.id && (entry as Record<string, unknown>).kind === 'gate')) : []
      draft.evidence = [...existing, measured.evidence]
      await writeJson(draftPath, draft)
      return jsonOk({ gate: spec.id, passed: (measured.evidence as { passed: boolean }).passed, artifactId, revision })
    },
  }
}

const designCritique: PiPackTool = {
  name: 'design_critique',
  label: 'Design Critique',
  description: 'Finalize the revision critique; the shared normalizer decides the verdict',
  promptSnippet: 'finalize the critique; verdict is computed fail-closed',
  parameters: {
    type: 'object',
    properties: {
      artifactId: { type: 'string' },
      requestedVerdict: { type: 'string', enum: ['pass', 'fail'], description: 'What the model believes; the normalized verdict may differ' },
      briefCoverage: { type: 'number' },
      brandConformance: { type: 'number' },
      accessibility: { type: 'number' },
      implementationReadiness: { type: 'number' },
    },
    required: ['artifactId'],
  },
  execute: async (args, ctx) => {
    if (Object.hasOwn(args, 'evidence')) {
      return structuredFailure('design_critique 拒絕模型提供 evidence；請先執行 Host capture、lint 與 gate tools。')
    }
    const artifactId = safeId(args.artifactId)
    if (!artifactId) return structuredFailure('不安全的 artifactId')
    const validation = await loadManifest(ctx, artifactId)
    if (!validation.ok) return structuredFailure(`artifact manifest invalid：${validation.errors.join('；')}`)
    const revision = validation.manifest.revision
    const draftPath = insideRoot(ctx.cwd, `${METADATA_ROOT}/critiques/${artifactId}-r${revision}.json`)!
    const draft = (await readJson(draftPath) || {}) as Record<string, unknown>
    const evidenceCheck = await requestPiHostService<{
      ok: boolean
      verifiedEvidence?: unknown[]
      errors?: string[]
    }>('subdesign/verify-critique-evidence', {
      artifact: validation.manifest,
      evidence: Array.isArray(draft.evidence) ? draft.evidence : [],
      projectRoot: ctx.cwd,
    })
    if (!evidenceCheck.ok) {
      return structuredFailure(`Critique evidence 驗證失敗：${(evidenceCheck.errors || ['Host verifier 拒絕 evidence']).join('；')}`)
    }
    const input = {
      artifactId,
      briefId: typeof draft.briefId === 'string' ? draft.briefId : undefined,
      revision,
      findings: draft.findings,
      evidence: evidenceCheck.verifiedEvidence || [],
      briefCoverage: typeof args.briefCoverage === 'number' ? clampScore(args.briefCoverage) : undefined,
      brandConformance: typeof args.brandConformance === 'number' ? clampScore(args.brandConformance) : undefined,
      accessibility: typeof args.accessibility === 'number' ? clampScore(args.accessibility) : undefined,
      implementationReadiness: typeof args.implementationReadiness === 'number' ? clampScore(args.implementationReadiness) : undefined,
      verdict: args.requestedVerdict === 'pass' ? 'pass' : 'needs-revision',
    }
    // THE shared normalizer computes the verdict: a requested pass with
    // unexecuted gates is rejected; other unmet evidence downgrades to
    // needs-revision regardless of what was requested.
    const normalized = normalizeSubDesignCritique(input)
    if (!normalized.ok) return structuredFailure(normalized.errors.join('；'))
    await writeJson(draftPath, normalized.critique)
    return jsonOk({
      artifactId,
      revision,
      verdict: normalized.critique.verdict,
      allowsDeliver: critiqueAllowsDeliver(normalized.critique),
      findings: normalized.critique.findings.map((finding) => ({ severity: finding.severity, message: finding.message })),
    })
  },
}

const designArtifactExport: PiPackTool = {
  name: 'design_artifact_export',
  label: 'Design Artifact Export',
  description: 'Export an artifact after its critique allows delivery',
  promptSnippet: 'export a finished artifact for delivery',
  parameters: {
    type: 'object',
    properties: { artifactId: { type: 'string' } },
    required: ['artifactId'],
  },
  approval: () => ({ need: true, reason: 'design_artifact_export 寫出交付記錄' }),
  execute: async (args, ctx) => {
    const artifactId = safeId(args.artifactId)
    if (!artifactId) return structuredFailure('不安全的 artifactId')
    const validation = await loadManifest(ctx, artifactId)
    if (!validation.ok) return structuredFailure(`artifact manifest invalid：${validation.errors.join('；')}`)
    const revision = validation.manifest.revision
    const critiqueInput = await readJson(insideRoot(ctx.cwd, `${METADATA_ROOT}/critiques/${artifactId}-r${revision}.json`)!)
    const normalized = normalizeSubDesignCritique(critiqueInput)
    // Deliver fails closed unless the PERSISTED critique still normalizes to
    // a passing verdict — re-reading from disk, not trusting the model's claim.
    if (!normalized.ok) return structuredFailure(`critique 無法讀取：${normalized.errors.join('；')}`)
    const evidenceCheck = await requestPiHostService<{ ok: boolean; verifiedEvidence?: unknown[]; errors?: string[] }>(
      'subdesign/verify-critique-evidence',
      { artifact: validation.manifest, evidence: normalized.critique.evidence, projectRoot: ctx.cwd },
    )
    if (!evidenceCheck.ok) return structuredFailure(`critique evidence 無法驗證：${(evidenceCheck.errors || []).join('；')}`)
    const verified = normalizeSubDesignCritique({ ...normalized.critique, evidence: evidenceCheck.verifiedEvidence || [] })
    if (!verified.ok || !critiqueAllowsDeliver(verified.critique)) return structuredFailure('critique 尚未允許 deliver：verdict 或證據不足')
    const exportRecord = { artifactId, revision, exportedAt: new Date().toISOString(), by: ctx.runId || ctx.sessionId }
    await writeJson(insideRoot(ctx.cwd, `${METADATA_ROOT}/exports/${artifactId}-r${revision}.json`)!, exportRecord)
    return jsonOk({ artifactId, revision, exported: true })
  },
}

const GATES: GateSpec[] = [
  { id: 'contrast', label: 'Design Gate Contrast' },
  { id: 'console-error', label: 'Design Gate Console Error' },
  { id: 'build-success', label: 'Design Gate Build Success' },
  { id: 'responsive-overflow', label: 'Design Gate Responsive Overflow' },
  { id: 'token-consistency', label: 'Design Gate Token Consistency' },
]

export function buildSubDesignPack() {
  return {
    id: 'subdesign-pack',
    name: 'SubDesign Workflow',
    description: 'The brief → direction → build → critique → deliver workflow',
    capability: 'subdesign-workflow',
    tools: [
      designBriefUpdate,
      designDirectionSelect,
      designArtifactRegister,
      designArtifactCapture,
      designArtifactPatch,
      designArtifactTweak,
      designArtifactLint,
      designCritiqueNote,
      ...GATES.map(gateTool),
      designCritique,
      designArtifactExport,
    ],
  }
}

let registered = false
export function ensureSubDesignPackRegistered(): void {
  if (registered) return
  registered = true
  registerPiExtensionPack(buildSubDesignPack())
}
