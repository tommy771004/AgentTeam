import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Drift guard: the trajectory review must stay reachable and windowed.
 *
 * The original bug shape was silent: a finished, protocol-backed panel that
 * NOTHING mounted — feature-detect returned null and no error ever fired.
 * This guard pins the three facts that make the feature exist, and below it
 * demonstrates each one going red on a mutated copy (the guard must fail on
 * the regression it exists for, not merely pass on today's tree).
 */

const root = fileURLToPath(new URL('../src/', import.meta.url))
const read = (file: string) => readFileSync(`${root}${file}`, 'utf8')

// --- the three predicates -----------------------------------------------------

function assertMounted(container: string): void {
  assert.ok(
    container.includes('<TrajectoryPanel'),
    'InlineRunPanel 必須掛載 <TrajectoryPanel>：軌跡檢視不得再次變成無人掛載的孤兒元件',
  )
}

function assertWindowed(panel: string): void {
  assert.ok(
    panel.includes('computeTrajectoryWindow'),
    'TrajectoryPanel 必須經過 trajectoryWindow 的純函式窗口，不得自行掛載全部列',
  )
  assert.ok(
    !panel.includes('view?.rows.map('),
    '軌跡列必須經切片後渲染；直接 map 全部已載入列是虛擬化的退化',
  )
}

function assertDegrade(panel: string): void {
  // The exact feature-detect expression — substrings like «sessions» and
  // «record» alone would survive deleting the detection itself.
  assert.ok(
    panel.includes('piHost?.sessions?.record'),
    'TrajectoryPanel 必須保留對 piHost sessions.record 的功能偵測（plain-browser 降級）',
  )
}

// --- positive: today's tree ----------------------------------------------------

const container = read('components/InlineRunPanel.tsx')
const panel = read('components/TrajectoryPanel.tsx')
const windowModule = read('agent/trajectoryWindow.ts')

assertMounted(container)
assertWindowed(panel)
assertDegrade(panel)

assert.ok(
  windowModule.includes('export function computeTrajectoryWindow') &&
    windowModule.includes('export function anchorScrollTopAfterPrepend'),
  'trajectoryWindow 模組的兩個純函式不可消失',
)
assert.ok(panel.includes('key={row.seq}'), '列身分必須仍是 record 的 seq')

// --- negative: each regression actually turns red -------------------------------

function expectRed(name: string, run: () => void): void {
  assert.throws(run, `${name}: 移除後 guard 必須轉紅`)
}

expectRed('unmount the panel', () => assertMounted(container.replace('<TrajectoryPanel', '<div data-was-panel')))
expectRed('map every loaded row', () => assertWindowed(panel.replace('mountedRows.map', 'view?.rows.map(')))
expectRed('delete the feature-detect', () => assertDegrade(panel.replace('piHost?.sessions?.record', 'piHost?.sessions')))

console.log('smoke-trajectory-panel-mounted: green')
