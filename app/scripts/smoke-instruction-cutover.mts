import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [learningPage, learningStore, piRuntime, piProtocol, runDispatch, coordinator, agentStore, personalization, projectionCursor, projectionUpdate, packageSource] = await Promise.all([
  readFile(new URL('../src/pages/LearningPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/store/learningStore.ts', import.meta.url), 'utf8'),
  readFile(new URL('../electron/piCoreRuntime.ts', import.meta.url), 'utf8'),
  readFile(new URL('../electron/piHostProtocol.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/agent/runDispatch.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/agent/taskRunCoordinator.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/store/agentStore.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/settings/PersonalizationInstructionsSection.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/agent/instructionProjectionCursor.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/agent/instructionProjectionUpdate.ts', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8'),
])

assert.doesNotMatch(learningPage, /setSoul|setAgents|SOUL\.md|internal AGENTS/i, 'Learning must not revive a second instruction editor')
assert.doesNotMatch(learningStore, /\n\s*setSoul:\s*async|\n\s*setAgents:\s*async/, 'legacy instruction write actions must stay removed')
assert.match(piRuntime, /noContextFiles:\s*true/, 'Pi native context discovery would duplicate the Host-frozen instruction snapshot')
assert.match(piProtocol, /import \{ resolveInstructionSnapshot,[^\n]+\} from '\.\/instructionResolver\.ts'/, 'Pi Host protocol remains the production instruction resolver owner')
assert.ok(runDispatch.indexOf('snapshot.overrides.extraSystemContext') < runDispatch.indexOf('agent.startLocalCliExecution'), 'external instruction wrapper must enter the actual CLI prompt before dispatch')
assert.match(runDispatch, /'## 近期對話歷史（Reference chat history）',[\s\S]*history,[\s\S]*cliPrompt,/, 'external history must precede the current request')
assert.match(coordinator, /delivery\.mode === 'native'[\s\S]*projection\.globalEffectiveText/, 'native CLI must receive expanded global text, never raw provenance bodies')
assert.doesNotMatch(coordinator, /projection\.sources\.filter\([^\n]+scope === 'global'/, 'native delivery must not reconstruct instructions from raw source content')
assert.doesNotMatch(agentStore, /deliveredInstructionSnapshot\s*\?\?\s*opts\.instructionSnapshot/, 'failed pre-dispatch gates must not record an admitted snapshot as delivered')
const coordinatorStart = coordinator.indexOf('async function coordinateTaskRun(')
const coordinatorEnd = coordinator.indexOf('/** Canonical API for new code. */', coordinatorStart)
assert.ok(coordinatorStart >= 0 && coordinatorEnd > coordinatorStart, 'Task coordinator owner must remain discoverable')
const coordinatorBody = coordinator.slice(coordinatorStart, coordinatorEnd)
assert.ok(coordinatorBody.indexOf('ensureHostInstructionMigration(settings)') < coordinatorBody.indexOf('admitTaskInstructions({'), 'legacy cutover must complete at Task admission before provider resolution')
assert.match(coordinator, /async function admitTaskInstructions\([\s\S]*?await admitExternalInstructions\(input\)/, 'Task admission owner must delegate external instruction resolution through the canonical adapter')
assert.match(personalization, /bridge\.save\(/, 'Personalization saves through the Host bridge')
assert.match(personalization, /已由 Host transaction commit/, 'save acknowledgement is Host-commit wording')
assert.match(personalization, /projection 刷新失敗/, 'projection refresh failure stays distinct from commit success')
assert.match(personalization, /requestInstructionProjection\(/, 'Personalization applies Host projections through the shared async after-cursor owner')
assert.match(projectionUpdate, /acceptInstructionProjection\(cursor, request, snapshot\.revision\)/, 'shared projection owner applies only current Host responses')
assert.match(projectionUpdate, /observeInstructionRevision\(cursor, revision\)/, 'shared projection owner advances from Host invalidation events')
assert.match(projectionCursor, /request\.sequence !== cursor\.latestRequestSequence/, 'stale in-flight Host responses cannot replace newer UI state')
assert.match(projectionCursor, /responseRevision < cursor\.requiredRevision/, 'a response must catch up with every observed Host revision event')
assert.match(personalization, /projectRootRef/, 'project switches clear the previous filesystem projection')
assert.match(personalization, /source\.bytes/, 'Personalization exposes Host source byte metadata')
assert.match(personalization, /source\.truncated/, 'Personalization exposes Host truncation metadata')
assert.match(personalization, /openSource/, 'source rows use the Host canonical-file open contract')
assert.match(personalization, /project-parent/, 'source labels preserve the Host discovery kind')
assert.match(personalization, /source\.effectiveOrder/, 'effective order is rendered from Host projection facts')
assert.match(personalization, /source\.openable/, 'open controls follow Host openability facts')
assert.doesNotMatch(personalization, /effective order \$\{index \+ 1\}/, 'renderer must not fake effective order with row index')
assert.doesNotMatch(personalization, /localStorage\.(get|set|remove)Item/, 'Personalization editor has no localStorage authority')
assert.match(personalization, /if \(!exportArmed\)[\s\S]*plaintext JSON[\s\S]*return[\s\S]*bridge\.exportBundle\(\)/, 'plaintext export requires an explicit confirmation step before bundle generation')
assert.ok(personalization.indexOf('bridge.previewImport(bundle)') < personalization.indexOf('bridge.applyImport(importCandidate.bundle'), 'import preview must happen before the separately confirmed apply action')
assert.match(personalization, /!\['invalid', 'conflict'\]\.includes\(importCandidate\.preview\.status\)/, 'invalid and older-conflict previews must not expose an apply action')
assert.match(personalization, /Project instruction bodies \u4e0d\u6703\u9032\u5165\u532f\u51fa\u6a94/, 'export confirmation discloses filesystem body exclusion')
const packageJson = JSON.parse(packageSource) as { scripts?: Record<string, string> }
assert.match(packageJson.scripts?.smoke || '', /npm run smoke:instruction-release/, 'instruction release aggregator stays on the formal npm smoke lifecycle')
assert.match(packageJson.scripts?.['smoke:instruction-release'] || '', /npm run smoke:instructions/, 'instruction contract smoke stays in the release aggregator')
assert.match(packageJson.scripts?.['smoke:instruction-release'] || '', /smoke-instruction-migration\.mts/, 'legacy migration regression stays in the release aggregator')
assert.doesNotMatch(packageJson.scripts?.presmoke || '', /smoke:instructions|smoke-instruction-migration\.mts/, 'presmoke must not duplicate the instruction release aggregator')
assert.match(packageJson.scripts?.['smoke:instructions'] || '', /smoke-instruction-run-snapshot\.mts/, 'run snapshot regression stays on the instruction smoke chain')
assert.match(packageJson.scripts?.['smoke:instructions'] || '', /smoke:instruction-run-task-host-queue/, 'production runTask/Host queue regression stays on the instruction smoke chain')

console.log('instruction cutover smoke: ok')
