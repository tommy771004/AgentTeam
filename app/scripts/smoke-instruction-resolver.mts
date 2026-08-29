import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveInstructionSnapshot, writeProjectInstruction } from '../electron/instructionResolver.ts'
import { ProjectInstructionWriteError } from '../electron/projectInstructionWriter.ts'

const root = await mkdtemp(join(tmpdir(), 'agentstudio-resolver-'))
const project = join(root, '專案')
const work = join(project, 'src', 'feature')
const outside = join(root, 'outside.md')
try {
  await mkdir(work, { recursive: true })
  await writeFile(join(project, 'AGENTS.md'), 'root rule\n@shared.md\n')
  await writeFile(join(project, 'shared.md'), '共用規則')
  await writeFile(join(project, 'src', 'AGENTS.md'), 'src normal should be shadowed')
  await writeFile(join(project, 'src', 'AGENTS.override.md'), 'near override')
  await writeFile(outside, 'secret outside')
  await symlink(outside, join(project, 'escape.md'))

  const resolved = await resolveInstructionSnapshot({
    globalRevision: 7,
    globalCustomInstructions: 'global first',
    advancedPersonalityInstructions: 'stable voice',
    personality: 'friendly',
    aboutUser: '偏好繁體中文',
    responseStyle: '先給結論',
    projectRoot: project,
    workPath: work,
  })
  assert.equal(resolved.revision, 7)
  assert.deepEqual(resolved.sources.filter((source) => source.applied).map((source) => source.kind), [
    'global-custom', 'personality', 'personality', 'personality', 'personality', 'project-root', 'include', 'project-override',
  ])
  assert.match(resolved.effectiveText, /偏好繁體中文/)
  assert.match(resolved.effectiveText, /先給結論/)
  assert.ok(resolved.effectiveText.indexOf('global first') < resolved.effectiveText.indexOf('root rule'))
  assert.ok(resolved.effectiveText.indexOf('root rule') < resolved.effectiveText.indexOf('near override'))
  assert.ok(!resolved.effectiveText.includes('shadowed'))
  const resolvedInclude = resolved.sources.find((source) => source.kind === 'include')
  assert.equal(resolvedInclude?.includeDepth, 1)
  assert.equal(resolvedInclude?.parentPath?.endsWith('/AGENTS.md'), true)
  assert.equal(resolvedInclude?.bytes, Buffer.byteLength('共用規則'))
  assert.equal(resolvedInclude?.hash, createHash('sha256').update('共用規則').digest('hex'))
  assert.equal(resolvedInclude?.applied, true)

  await writeFile(join(project, 'AGENTS.md'), 'root rule\n@escape.md\n')
  const escaped = await resolveInstructionSnapshot({ globalRevision: 8, globalCustomInstructions: '', projectRoot: project, workPath: work })
  assert.ok(escaped.diagnostics.some((item) => item.code === 'unauthorized'))
  assert.ok(!escaped.effectiveText.includes('secret outside'))
  const authorizedEscape = await resolveInstructionSnapshot({
    globalRevision: 8,
    globalCustomInstructions: '',
    projectRoot: project,
    workPath: work,
    authorizedIncludeTargets: [await realpath(outside)],
  })
  assert.ok(authorizedEscape.effectiveText.includes('secret outside'))

  await writeFile(join(project, 'AGENTS.md'), '@a.md')
  await writeFile(join(project, 'a.md'), '@b.md')
  await writeFile(join(project, 'b.md'), '@a.md')
  const cycle = await resolveInstructionSnapshot({ globalRevision: 9, globalCustomInstructions: '', projectRoot: project, workPath: work })
  assert.ok(cycle.diagnostics.some((item) => item.code === 'cycle'))

  // Every supported include failure remains independently typed, while the
  // resolver still keeps bounded source metadata for missing/oversized/deep
  // targets instead of silently presenting an empty applied body.
  const missingInclude = join(root, 'missing-include.md')
  const oversizedInclude = join(root, 'oversized-include.md')
  const deepOne = join(root, 'deep-one.md')
  const deepTwo = join(root, 'deep-two.md')
  await writeFile(oversizedInclude, 'OVERSIZED-INCLUDE-'.repeat(40))
  await writeFile(deepOne, `DEEP-ONE\n@${deepTwo}`)
  await writeFile(deepTwo, 'DEEP-TWO')
  const typedIncludes = await resolveInstructionSnapshot({
    globalRevision: 9,
    globalCustomInstructions: `@${missingInclude}\n@https://example.invalid/rules.md\n@${oversizedInclude}\n@${deepOne}`,
    limits: { perFileBytes: 512, totalBytes: 4_096, maxDepth: 1 },
  })
  const typedProject = join(root, 'typed-project')
  await mkdir(typedProject, { recursive: true })
  await writeFile(join(typedProject, 'AGENTS.md'), `@${outside}`)
  const typedProjectIncludes = await resolveInstructionSnapshot({
    globalRevision: 9,
    globalCustomInstructions: '',
    projectRoot: typedProject,
    workPath: typedProject,
  })
  const typedCodes = new Set(typedIncludes.diagnostics.map((diagnostic) => diagnostic.code))
  assert.ok(typedCodes.has('missing'))
  assert.ok(typedCodes.has('unsupported-target'))
  assert.ok(typedCodes.has('source-too-large'))
  assert.ok(typedCodes.has('depth-limit'))
  assert.ok(typedProjectIncludes.diagnostics.some((diagnostic) => diagnostic.code === 'unauthorized'))
  const missingSource = typedIncludes.sources.find((source) => source.path === missingInclude)
  assert.equal(missingSource?.applied, false)
  assert.equal(missingSource?.bytesKnown, false)
  assert.equal(missingSource?.parentPath, undefined)
  assert.equal(typedIncludes.sources.some((source) => source.path === deepTwo && source.applied), false)
  const depthBoundary = await resolveInstructionSnapshot({
    globalRevision: 9,
    globalCustomInstructions: `@${deepOne}`,
    limits: { maxDepth: 2, perFileBytes: 512, totalBytes: 4_096 },
  })
  const canonicalDeepTwo = await realpath(deepTwo)
  assert.equal(depthBoundary.sources.find((source) => source.path === canonicalDeepTwo)?.applied, true, 'depth exact boundary applies')

  const unreadableProject = join(root, 'unreadable-project')
  const unreadableTarget = join(unreadableProject, 'unreadable-target')
  await mkdir(unreadableTarget, { recursive: true })
  await mkdir(unreadableProject, { recursive: true })
  await writeFile(join(unreadableProject, 'AGENTS.md'), `@${unreadableTarget}`)
  const unreadableSnapshot = await resolveInstructionSnapshot({
    globalRevision: 9,
    globalCustomInstructions: '',
    projectRoot: unreadableProject,
    workPath: unreadableProject,
  })
  assert.ok(unreadableSnapshot.diagnostics.some((item) => item.code === 'unreadable'))
  const canonicalUnreadableTarget = await realpath(unreadableTarget)
  const unreadableSource = unreadableSnapshot.sources.find((source) => source.path === canonicalUnreadableTarget)
  assert.equal(unreadableSource?.applied, false)
  assert.equal(unreadableSource?.bytesKnown, true)
  assert.equal(unreadableSource?.metadataStatus, 'metadata')

  const original = await readFile(join(project, 'AGENTS.md'), 'utf8')
  const saved = await writeProjectInstruction({ projectRoot: project, target: 'AGENTS.md', expectedHash: cycle.sources.find((source) => source.path?.endsWith('AGENTS.md'))?.hash || '', content: 'atomic next' })
  assert.match(saved.hash, /^[a-f0-9]{64}$/)
  await assert.rejects(
    writeProjectInstruction({ projectRoot: project, target: 'AGENTS.md', expectedHash: saved.hash.slice(1), content: original }),
    (error: unknown) => error instanceof ProjectInstructionWriteError && error.code === 'conflict',
  )
  assert.equal(await readFile(join(project, 'AGENTS.md'), 'utf8'), 'atomic next')

  await assert.rejects(
    writeProjectInstruction({ projectRoot: project, target: 'AGENTS.md', expectedHash: undefined as never, content: 'bypass' }),
    (error: unknown) => error instanceof ProjectInstructionWriteError && error.code === 'conflict',
  )
  assert.equal(await readFile(join(project, 'AGENTS.md'), 'utf8'), 'atomic next')

  await writeFile(join(project, 'AGENTS.md'), 'PROJECT-MUST-SURVIVE')
  const authorityBudget = await resolveInstructionSnapshot({
    globalRevision: 10,
    globalCustomInstructions: 'g'.repeat(4_000),
    projectRoot: project,
    workPath: project,
    limits: { totalBytes: 256, perFileBytes: 4_096 },
  })
  assert.match(authorityBudget.effectiveText, /PROJECT-MUST-SURVIVE/)
  assert.ok(authorityBudget.usage.totalBytes <= authorityBudget.usage.budgetBytes)

  const bounded = await resolveInstructionSnapshot({
    globalRevision: 11,
    globalCustomInstructions: 'global',
    advancedPersonalityInstructions: 'voice',
    personality: 'friendly',
    aboutUser: 'about',
    responseStyle: 'style',
    projectRoot: project,
    workPath: work,
    limits: { maxSources: 3 },
  })
  assert.ok(bounded.sources.length <= 3)
  assert.ok(bounded.diagnostics.some((item) => item.code === 'source-count-limit'))

  await writeFile(join(project, 'AGENTS.md'), 'ROOT-LOWER-AUTHORITY-'.repeat(200))
  await writeFile(join(project, 'src', 'AGENTS.override.md'), 'NEAREST-MUST-SURVIVE')
  const nearestBudget = await resolveInstructionSnapshot({
    globalRevision: 12,
    globalCustomInstructions: 'GLOBAL-LOWER-AUTHORITY-'.repeat(200),
    projectRoot: project,
    workPath: work,
    limits: { totalBytes: 280, perFileBytes: 4_096 },
  })
  assert.match(nearestBudget.effectiveText, /NEAREST-MUST-SURVIVE/)
  assert.ok(nearestBudget.usage.totalBytes <= nearestBudget.usage.budgetBytes)

  const sourceCapAuthority = await resolveInstructionSnapshot({
    globalRevision: 13,
    globalCustomInstructions: '',
    projectRoot: project,
    workPath: work,
    limits: { maxSources: 1 },
  })
  assert.equal(sourceCapAuthority.sources[0]?.kind, 'project-override')
  assert.equal(sourceCapAuthority.sources[0]?.applied, true)

  const deduplicated = await resolveInstructionSnapshot({
    globalRevision: 14,
    globalCustomInstructions: 'ONE-COPY',
    advancedPersonalityInstructions: 'ONE-COPY',
  })
  assert.equal(deduplicated.effectiveText.match(/ONE-COPY/g)?.length, 1)
  assert.ok(deduplicated.diagnostics.some((item) => item.code === 'duplicate'))

  // Heading/newline accounting is exact at the single global block edge:
  // exact bytes apply, while one byte less fails closed.
  const exactGlobalText = '## 全域自訂指令\nx'
  const exactGlobal = await resolveInstructionSnapshot({
    globalRevision: 14,
    globalCustomInstructions: 'x',
    limits: { totalBytes: Buffer.byteLength(exactGlobalText) },
  })
  assert.equal(exactGlobal.usage.totalBytes, Buffer.byteLength(exactGlobalText))
  assert.equal(exactGlobal.effectiveText, exactGlobalText)
  const underGlobal = await resolveInstructionSnapshot({
    globalRevision: 14,
    globalCustomInstructions: 'x',
    limits: { totalBytes: Buffer.byteLength(exactGlobalText) - 1 },
  })
  assert.equal(underGlobal.effectiveText, '')

  const exactIncludePath = join(root, 'exact-include.md')
  const exactIncludeContent = 'A'.repeat(128)
  await writeFile(exactIncludePath, exactIncludeContent)
  const exactInclude = await resolveInstructionSnapshot({
    globalRevision: 14,
    globalCustomInstructions: `@${exactIncludePath}`,
    limits: { perFileBytes: 128, totalBytes: 512 },
  })
  const canonicalExactIncludePath = await realpath(exactIncludePath)
  assert.equal(exactInclude.sources.find((source) => source.path === canonicalExactIncludePath)?.applied, true)
  assert.equal(exactInclude.sources.find((source) => source.path === canonicalExactIncludePath)?.includedBytes, 128)
  await writeFile(exactIncludePath, `${exactIncludeContent}B`)
  const overInclude = await resolveInstructionSnapshot({
    globalRevision: 14,
    globalCustomInstructions: `@${exactIncludePath}`,
    limits: { perFileBytes: 128, totalBytes: 512 },
  })
  const overSource = overInclude.sources.find((source) => source.path === canonicalExactIncludePath)
  assert.equal(overSource?.applied, false)
  assert.equal(overSource?.includedBytes, 0)
  assert.equal(overSource?.content, '')
  assert.ok(!overInclude.effectiveText.includes('ABCDE'))

  // A sole project block must consume only its actual heading/body bytes;
  // one byte less fails closed without a phantom separator reservation.
  const exactProjectRoot = join(root, 'exact-project')
  await mkdir(exactProjectRoot, { recursive: true })
  await writeFile(join(exactProjectRoot, 'AGENTS.md'), 'PROJECT-EXACT')
  const canonicalExactProjectRoot = await realpath(exactProjectRoot)
  const exactProjectText = `## 專案指令：${canonicalExactProjectRoot}/AGENTS.md\nPROJECT-EXACT`
  const exactProject = await resolveInstructionSnapshot({
    globalRevision: 14,
    globalCustomInstructions: '',
    projectRoot: exactProjectRoot,
    workPath: exactProjectRoot,
    limits: { totalBytes: Buffer.byteLength(exactProjectText) },
  })
  assert.equal(exactProject.effectiveText, exactProjectText)
  const underProject = await resolveInstructionSnapshot({
    globalRevision: 14,
    globalCustomInstructions: '',
    projectRoot: exactProjectRoot,
    workPath: exactProjectRoot,
    limits: { totalBytes: Buffer.byteLength(exactProjectText) - 1 },
  })
  assert.equal(underProject.effectiveText, '')

  // Deduplication must compare complete normalized source bodies, not equal
  // clipped prefixes. Otherwise two long instructions can lose distinct
  // suffixes before the include/cycle diagnostics are even considered.
  const prefixCollision = await resolveInstructionSnapshot({
    globalRevision: 15,
    globalCustomInstructions: `${'P'.repeat(128)}X`,
    advancedPersonalityInstructions: `${'P'.repeat(128)}Y`,
    limits: { perFileBytes: 128, totalBytes: 512 },
  })
  assert.equal(prefixCollision.sources.filter((source) => source.applied).length, 0)
  assert.equal(prefixCollision.sources.filter((source) => source.bytes > 128).length, 2)
  assert.ok(!prefixCollision.diagnostics.some((item) => item.code === 'duplicate'))

  // A duplicate include still has to be traversed so a cycle is never hidden
  // by provenance deduplication.
  const cycleInclude = join(root, 'cycle-include.md')
  await writeFile(cycleInclude, `@${cycleInclude}`)
  const duplicateCycle = await resolveInstructionSnapshot({
    globalRevision: 16,
    globalCustomInstructions: `@${cycleInclude}\n@${cycleInclude}`,
  })
  assert.ok(duplicateCycle.diagnostics.some((item) => item.code === 'duplicate'))
  assert.ok(duplicateCycle.diagnostics.some((item) => item.code === 'cycle'))

  // Hierarchy corpus: parent guidance is bounded by the nearest Git marker,
  // then project root and the active work directory are resolved from broad
  // to narrow. Same-directory override/normal/fallback remains exclusive.
  const hierarchyRepo = join(root, 'hierarchy-repo')
  const hierarchyProject = join(hierarchyRepo, 'project')
  const hierarchyWork = join(hierarchyProject, 'src', 'feature')
  await mkdir(join(hierarchyRepo, '.git'), { recursive: true })
  await mkdir(hierarchyWork, { recursive: true })
  await writeFile(join(hierarchyRepo, 'AGENTS.md'), 'PARENT-RULE')
  await writeFile(join(hierarchyProject, 'AGENTS.md'), 'ROOT-RULE')
  await writeFile(join(hierarchyProject, 'CLAUDE.md'), 'ROOT-CLAUDE-SHADOW')
  await writeFile(join(hierarchyWork, 'AGENTS.md'), 'WORK-NORMAL-SHADOW')
  await writeFile(join(hierarchyWork, 'AGENTS.override.md'), 'WORK-OVERRIDE')
  await writeFile(join(hierarchyWork, 'CUSTOM.md'), 'WORK-FALLBACK-SHADOW')
  const hierarchy = await resolveInstructionSnapshot({
    globalRevision: 17,
    globalCustomInstructions: '',
    globalCustomInstructionsPresence: 'unset',
    projectRoot: hierarchyProject,
    workPath: hierarchyWork,
    fallbackFilenames: ['CUSTOM.md', '../unsafe.md', 'CUSTOM.md', '', 'Ａ.md', 'café.md', 'cafe\u0301.md', '*.md'],
  })
  assert.deepEqual(hierarchy.sources.filter((source) => source.applied).map((source) => source.kind), [
    'project-parent', 'project-root', 'project-override',
  ])
  assert.ok(hierarchy.effectiveText.indexOf('PARENT-RULE') < hierarchy.effectiveText.indexOf('ROOT-RULE'))
  assert.ok(hierarchy.effectiveText.indexOf('ROOT-RULE') < hierarchy.effectiveText.indexOf('WORK-OVERRIDE'))
  assert.ok(!hierarchy.effectiveText.includes('WORK-NORMAL-SHADOW'))
  assert.ok(!hierarchy.effectiveText.includes('ROOT-CLAUDE-SHADOW'))
  assert.equal(hierarchy.sources.filter((source) => source.kind === 'fallback' && source.applied).length, 0, 'fallback is not applied when a same-directory override exists')
  assert.equal(hierarchy.sources.find((source) => source.kind === 'project-parent')?.directoryDepth, -1)

  // A project include may not reach a sibling inside the repository boundary
  // merely because discovery can see it. It needs an exact explicit grant.
  const repoSiblingProject = join(hierarchyRepo, 'repo-sibling-project')
  const repoSiblingTarget = join(hierarchyRepo, 'repo-sibling.md')
  await mkdir(repoSiblingProject, { recursive: true })
  await writeFile(repoSiblingTarget, 'REPO-SIBLING-MUST-NOT-APPLY')
  await writeFile(join(repoSiblingProject, 'AGENTS.md'), `@${repoSiblingTarget}`)
  const repoSiblingSnapshot = await resolveInstructionSnapshot({
    globalRevision: 17,
    globalCustomInstructions: '',
    projectRoot: repoSiblingProject,
    workPath: repoSiblingProject,
  })
  assert.ok(repoSiblingSnapshot.diagnostics.some((item) => item.code === 'unauthorized'))
  assert.ok(!repoSiblingSnapshot.effectiveText.includes('REPO-SIBLING-MUST-NOT-APPLY'))
  const canonicalRepoSiblingTarget = await realpath(repoSiblingTarget)
  assert.equal(repoSiblingSnapshot.sources.find((source) => source.path === canonicalRepoSiblingTarget)?.metadataStatus, 'unauthorized')

  const fallbackProject = join(hierarchyRepo, 'fallback-project')
  await mkdir(fallbackProject, { recursive: true })
  await writeFile(join(fallbackProject, 'CUSTOM.md'), 'FALLBACK-RULE')
  const fallback = await resolveInstructionSnapshot({
    globalRevision: 18,
    globalCustomInstructions: '',
    projectRoot: fallbackProject,
    workPath: fallbackProject,
    fallbackFilenames: ['agents.md', 'AGENTS.md', 'CUSTOM.md', 'custom.md', 'CUSTOM.md', 'dir/CUSTOM.md', '*', '.', '..', 'Ａ.md', 'café.md', 'cafe\u0301.md'],
  })
  assert.equal(fallback.sources.filter((source) => source.kind === 'fallback' && source.applied).length, 1)
  assert.match(fallback.effectiveText, /FALLBACK-RULE/)
  assert.equal(fallback.sources.filter((source) => source.kind === 'fallback').length, 1, 'reserved, invalid and case-duplicate fallback names are rejected')

  // Unicode fallback basenames are valid after NFC normalization. An NFD
  // spelling must collide with its NFC twin, while distinct Unicode names keep
  // stable first-seen order and can be discovered on a later run.
  const unicodeProject = join(hierarchyRepo, 'unicode-fallback-project')
  await mkdir(unicodeProject, { recursive: true })
  await writeFile(join(unicodeProject, 'café.md'), 'UNICODE-CAFE')
  const unicodeNfc = await resolveInstructionSnapshot({
    globalRevision: 20,
    globalCustomInstructions: '',
    projectRoot: unicodeProject,
    workPath: unicodeProject,
    fallbackFilenames: ['cafe\u0301.md', 'café.md', 'café.md'],
  })
  const unicodeCafeSources = unicodeNfc.sources.filter((source) => source.kind === 'fallback')
  assert.equal(unicodeCafeSources.length, 1, 'NFC/NFD fallback spellings resolve as one candidate')
  assert.equal(unicodeCafeSources[0]?.applied, true)
  assert.equal(unicodeCafeSources[0]?.path?.endsWith('café.md'), true)

  await writeFile(join(unicodeProject, '規範.md'), 'UNICODE-RULE')
  const unicodeDistinct = await resolveInstructionSnapshot({
    globalRevision: 21,
    globalCustomInstructions: '',
    projectRoot: unicodeProject,
    workPath: unicodeProject,
    fallbackFilenames: ['規範.md', 'café.md'],
  })
  assert.equal(unicodeDistinct.sources.find((source) => source.kind === 'fallback' && source.applied)?.path?.endsWith('規範.md'), true)
  assert.match(unicodeDistinct.effectiveText, /UNICODE-RULE/)

  // The bounded basename limit is measured after normalization. Exactly 128
  // code units remains valid; overlong names and all C0/C1/line-separator
  // controls are rejected before filesystem discovery.
  const boundedProject = join(hierarchyRepo, 'bounded-fallback-project')
  await mkdir(boundedProject, { recursive: true })
  const maxFallbackName = `${'m'.repeat(125)}.md`
  const overlongFallbackName = `${'o'.repeat(126)}.md`
  const c0FallbackName = 'bad\u0001.md'
  const c1FallbackName = 'bad\u0085.md'
  const lineSeparatorFallbackName = 'bad\u2028.md'
  await writeFile(join(boundedProject, maxFallbackName), 'MAX-BOUNDARY-FALLBACK')
  await writeFile(join(boundedProject, overlongFallbackName), 'OVERLONG-MUST-NOT-APPLY')
  await writeFile(join(boundedProject, c0FallbackName), 'C0-MUST-NOT-APPLY')
  await writeFile(join(boundedProject, c1FallbackName), 'C1-MUST-NOT-APPLY')
  await writeFile(join(boundedProject, lineSeparatorFallbackName), 'LINE-SEPARATOR-MUST-NOT-APPLY')
  const boundedFallback = await resolveInstructionSnapshot({
    globalRevision: 22,
    globalCustomInstructions: '',
    projectRoot: boundedProject,
    workPath: boundedProject,
    fallbackFilenames: [overlongFallbackName, c0FallbackName, c1FallbackName, lineSeparatorFallbackName, maxFallbackName],
  })
  assert.equal(boundedFallback.sources.find((source) => source.kind === 'fallback' && source.applied)?.path?.endsWith(maxFallbackName), true)
  assert.ok(!boundedFallback.effectiveText.includes('MUST-NOT-APPLY'))

  // A worktree has its own .git marker and must not inherit the parent repo's
  // source across that boundary.
  const worktree = join(hierarchyRepo, 'worktree')
  await mkdir(join(worktree, '.git'), { recursive: true })
  await writeFile(join(worktree, 'AGENTS.md'), 'WORKTREE-RULE')
  const worktreeSnapshot = await resolveInstructionSnapshot({
    globalRevision: 19,
    globalCustomInstructions: '',
    projectRoot: worktree,
    workPath: worktree,
  })
  assert.ok(worktreeSnapshot.effectiveText.includes('WORKTREE-RULE'))
  assert.ok(!worktreeSnapshot.effectiveText.includes('PARENT-RULE'))
  assert.equal(worktreeSnapshot.sources.some((source) => source.kind === 'project-parent'), false)
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('instruction resolver smoke: ok')
