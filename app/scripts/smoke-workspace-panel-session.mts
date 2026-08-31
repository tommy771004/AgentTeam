import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const memory = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { value: {
  getItem: (key: string) => memory.get(key) || null,
  setItem: (key: string, value: string) => { memory.set(key, value) },
  removeItem: (key: string) => { memory.delete(key) },
} })

const { useWorkspacePanelSessionStore, workspacePanelTabId } = await import('../src/store/workspacePanelSessionStore.ts')
const store = useWorkspacePanelSessionStore.getState()
store.resetPresentation()
const summary = { kind: 'summary' as const, runId: 'run_1', threadId: 'thread_1' }
const summaryId = store.openTab(summary)
assert.equal(summaryId, workspacePanelTabId(summary))
assert.equal(useWorkspacePanelSessionStore.getState().tabs.length, 1)
store.openTab(summary)
assert.equal(useWorkspacePanelSessionStore.getState().tabs.length, 1, 'open-or-focus never duplicates the same target')
const review = { kind: 'review' as const, target: { kind: 'run-snapshot' as const, snapshotId: 'snapshot_1' } }
const reviewId = store.openTab(review)
store.selectPath(reviewId, 'src/a.ts')
store.setReviewWidth(200)
assert.equal(useWorkspacePanelSessionStore.getState().reviewWidth, 420)
store.setReviewWidth(2_000)
assert.equal(useWorkspacePanelSessionStore.getState().reviewWidth, 960)
store.setDock('bottom')
store.setMaximized(true)
assert.equal(useWorkspacePanelSessionStore.getState().tabs.find((tab) => tab.id === reviewId)?.selectedPath, 'src/a.ts')
const persisted = memory.get('agentstudio.workspace-panel-session.v1')
assert.ok(persisted)
useWorkspacePanelSessionStore.setState({ tabs: [], activeTabId: undefined, dock: 'right', reviewWidth: 640, maximized: false })
useWorkspacePanelSessionStore.getState().restore()
assert.equal(useWorkspacePanelSessionStore.getState().activeTabId, reviewId)
assert.equal(useWorkspacePanelSessionStore.getState().dock, 'bottom')
assert.equal(useWorkspacePanelSessionStore.getState().maximized, true)
useWorkspacePanelSessionStore.getState().closeTab(reviewId)
assert.equal(useWorkspacePanelSessionStore.getState().activeTabId, summaryId)

const component = await readFile(new URL('../src/components/WorkspacePanelSession.tsx', import.meta.url), 'utf8')
assert.match(component, /role="tablist"/)
assert.match(component, /role="tab"/)
assert.match(component, /ArrowRight[\s\S]*ArrowLeft[\s\S]*Home[\s\S]*End[\s\S]*Delete/)
assert.match(component, /event\.metaKey \|\| event\.ctrlKey[\s\S]*key\.toLowerCase\(\) !== 'w'/)
assert.match(component, /focus-visible:ring-2/)
assert.match(component, /role="separator"[\s\S]*setReviewWidth/)
assert.match(component, /fixed inset-0 z-\[70\] w-full sm:relative[\s\S]*sm:w-\[var\(--panel-width\)\]/, 'narrow viewport is fixed above sidebar; desktop uses the measured width')
assert.match(component, /narrow \|\| maximized \? createPortal\(panel, document\.body\)/, 'viewport overlays escape the content stacking context')
assert.match(component, /active\?\.target\.kind === 'summary' \? 360 : reviewWidth/)
assert.match(component, /尚未載入或已遺失/, 'restored missing targets retain a recovery state')
assert.doesNotMatch(component, /stopExecution|kill\(|deleteArtifact|workspaceDiff|git /, 'closing a workspace tab has no run, PTY, artifact, or Git side effect')

const page = await readFile(new URL('../src/pages/ProtocolsPage.tsx', import.meta.url), 'utf8')
assert.match(page, /<WorkspacePanelSession/)
assert.match(page, /panel\.restore\(\)[\s\S]*tabs\.length > 0[\s\S]*setShowRunPanel\(true\)/, 'renderer reload remounts persisted workspace tabs before the panel can restore itself')
assert.doesNotMatch(page, /<InlineRunPanel|<TerminalPanel/, 'the right rail has one browser-tab-like session owner')
const runPanel = await readFile(new URL('../src/components/InlineRunPanel.tsx', import.meta.url), 'utf8')
const projectContext = await readFile(new URL('../src/components/ProjectContextBar.tsx', import.meta.url), 'utf8')
assert.match(runPanel, /<RunWorktreeSummary projectRoot=\{projectRoot\} \/>/, 'the run summary owns the worktree projection')
assert.doesNotMatch(projectContext.slice(projectContext.indexOf('export function ProjectContextBar'), projectContext.indexOf('function pathName')), /agent-project-source|agent-project-branch/, 'the conversation project picker no longer repeats provider and branch chips')
console.log('smoke-workspace-panel-session passed')
