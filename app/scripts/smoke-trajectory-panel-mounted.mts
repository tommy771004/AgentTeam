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
    'InlineRunPanel 必須掛載 <TrajectoryPanel>：軌跡檢視不得再次變成無人掛載的孤兒元件（owner: .scratch/trajectory-review-closure；guard/smokes: app/scripts/smoke-trajectory-*.mts）',
  )
}

function assertWindowed(panel: string): void {
  assert.ok(
    panel.includes('computeTrajectoryWindow'),
    'TrajectoryPanel 必須經過 trajectoryWindow 的純函式窗口，不得自行掛載全部列（owner: .scratch/trajectory-review-closure/issues/01）',
  )
  assert.ok(
    !panel.includes('view?.rows.map('),
    '軌跡列必須經切片後渲染；直接 map 全部已載入列是虛擬化的退化（owner: .scratch/trajectory-review-closure）',
  )
}

function assertDegrade(panel: string): void {
  // The exact feature-detect expression — substrings like «sessions» and
  // «record» alone would survive deleting the detection itself.
  assert.ok(
    panel.includes('piHost?.sessions?.record'),
    'TrajectoryPanel 必須保留對 piHost sessions.record 的功能偵測（plain-browser 降級；owner: .scratch/trajectory-review-closure/issues/02）',
  )
}

function assertMeasurementRouteIsDevOnly(app: string): void {
  assert.ok(
    app.includes("const DevTrajectoryMeasurement = import.meta.env.DEV"),
    'trajectory measurement 元件必須由 DEV 條件控制的 lazy import 載入',
  )
  assert.ok(
    app.includes("import.meta.env.DEV &&\n    window.location.hash === '#/trajectory-measurement'"),
    'trajectory measurement route 必須在 production fail closed',
  )
  assert.ok(
    !app.includes("import { DevTrajectoryMeasurement } from './DevTrajectoryMeasurement'"),
    'production bundle 不得透過 static import 帶入量測 fixture',
  )
}

// --- positive: today's tree ----------------------------------------------------

const container = read('components/InlineRunPanel.tsx')
const panel = read('components/TrajectoryPanel.tsx')
const windowModule = read('agent/trajectoryWindow.ts')
const app = read('App.tsx')

assertMounted(container)
assertWindowed(panel)
assertDegrade(panel)
assertMeasurementRouteIsDevOnly(app)

assert.ok(
  windowModule.includes('export function computeTrajectoryWindow') &&
    windowModule.includes('export function anchorScrollTopAfterPrepend'),
  'trajectoryWindow 模組的兩個純函式不可消失',
)
assert.ok(panel.includes('key={row.seq}'), '列身分必須仍是 record 的 seq')
assert.ok(
  panel.includes('trajectory-panel flex h-full min-h-0'),
  'TrajectoryPanel 必須採用父層固定高度，否則 scroller 會被內容撐開並使虛擬化失效',
)
assert.equal(
  (panel.match(/className="shrink-0" style=\{\{ height: range\.(?:top|bottom)SpacerHeight \}\}/g) || []).length,
  2,
  '上下 spacer 都不得被 flex shrink 壓縮，否則長列表的可捲動高度會消失',
)

// --- negative: each regression actually turns red -------------------------------

function expectRed(name: string, run: () => void): void {
  assert.throws(run, `${name}: 移除後 guard 必須轉紅`)
}

expectRed('unmount the panel', () => assertMounted(container.replace('<TrajectoryPanel', '<div data-was-panel')))
expectRed('map every loaded row', () => assertWindowed(panel.replace('mountedRows.map', 'view?.rows.map(')))
expectRed('delete the feature-detect', () => assertDegrade(panel.replace('piHost?.sessions?.record', 'piHost?.sessions')))
expectRed('expose measurement route in production', () => assertMeasurementRouteIsDevOnly(
  app.replace("import.meta.env.DEV &&\n    window.location.hash === '#/trajectory-measurement'", "window.location.hash === '#/trajectory-measurement'"),
))

console.log('smoke-trajectory-panel-mounted: green')
