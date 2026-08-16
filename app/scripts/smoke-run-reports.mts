/**
 * dod-verified-reports smoke — 系列 4/6 各票的純邏輯契約。
 * 票 01：DoD verdict 逐輪 append 語義 + loopRunner 接線 drift guard。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { appendDodVerdict, dodConvergence, finalDodVerdict } from '../src/agent/dodVerdicts.ts'
import { resolveReportSource } from '../src/agent/reportSource.ts'
import type { ArchiveRecord, DodVerdict as _DV } from '../src/agent/types.ts'
import {
  findJournalEntryByRunId,
  listJournal,
  recordQueueEnqueued,
  recordRunAdmitted,
  recordRunStarted,
  recordRunTerminal,
  resetRunJournalForTests,
} from '../src/agent/runJournal.ts'
import type { DodVerdict } from '../src/agent/types.ts'

class MemoryStorage {
  private values = new Map<string, string>()
  get length() {
    return this.values.size
  }
  clear() {
    this.values.clear()
  }
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
  setItem(key: string, value: string) {
    this.values.set(key, String(value))
  }
}
Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  configurable: true,
})
Object.defineProperty(globalThis, 'window', { value: { subagents: {} }, configurable: true })

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => fs.readFileSync(path.join(appRoot, rel), 'utf8')

// ── 1. append 語義：順序保留、快照隔離、semantic 傳遞 ──
{
  let list = appendDodVerdict(undefined, {
    iteration: 1,
    met: false,
    semantic: true,
    confidence: 0.4,
    missing: ['缺少測試', '文件未更新'],
    evaluatedAt: '2026-08-16T01:00:00Z',
  })
  assert.equal(list.length, 1)
  assert.equal(list[0].missing.length, 2)

  // 快照隔離：append 後改動來源陣列不影響已存快照
  const source: string[] = ['gap-a']
  list = appendDodVerdict(list, {
    iteration: 2,
    met: true,
    semantic: true,
    confidence: 0.92,
    missing: source,
    evaluatedAt: '2026-08-16T01:05:00Z',
  })
  source.push('gap-b')
  assert.equal(list[1].missing.length, 1, 'append 後改 source 不得影響快照')
  assert.equal(list[0].missing.length, 2, '前輪快照不被後輪覆蓋')

  // final = 最後一筆；收斂歷程 = 每輪缺口數
  const final = finalDodVerdict(list) as DodVerdict
  assert.equal(final.iteration, 2)
  assert.equal(final.met, true)
  assert.deepEqual(dodConvergence(list), [2, 1])
  assert.equal(finalDodVerdict(undefined), null)
  assert.deepEqual(dodConvergence(undefined), [])

  // 啟發式輪（semantic=false）也記錄——未驗證是明確狀態不是缺資料
  const heuristic = appendDodVerdict(undefined, {
    iteration: 1,
    met: true,
    semantic: false,
    confidence: 0.8,
    missing: [],
    evaluatedAt: '2026-08-16T02:00:00Z',
  })
  assert.equal(heuristic[0].semantic, false)
}

// ── 2. loopRunner 接線 drift guard ──
{
  const src = read('src/agent/loop/loopRunner.ts')
  assert.ok(src.includes('appendDodVerdict'), 'loopRunner 必須經 appendDodVerdict 記錄逐輪判定')
  assert.ok(src.includes('state.dodVerdicts'), '判定必須落於 state.dodVerdicts')
  assert.ok(/semantic = true/.test(src), '語意驗收成功輪須標 semantic=true')

  const typesSrc = read('src/agent/types.ts')
  assert.ok(typesSrc.includes('interface DodVerdict'), 'DodVerdict 型別須在 types.ts 單一定義')
}

// ── 3. Journal list 查詢（票 03）：kind 過濾、時間排序、runId 查找 ──
{
  resetRunJournalForTests()
  recordRunAdmitted({ runId: 'rep-run-a', objective: 'first', sourceKind: 'composer' })
  recordRunStarted({ runId: 'rep-run-a', threadId: 'rep-thread-a' })
  recordRunAdmitted({ runId: 'rep-run-b', objective: 'second', sourceKind: 'retry' })
  recordRunStarted({ runId: 'rep-run-b', threadId: 'rep-thread-b' })
  recordRunTerminal({ runId: 'rep-run-b', threadId: 'rep-thread-b', status: 'success' })
  recordQueueEnqueued({ queueId: 'rep-q1', runId: 'rep-run-c', objective: 'queued', sourceKind: 'schedule' })

  const runs = listJournal('run')
  assert.ok(runs.length >= 2, 'run kind 至少兩筆')
  assert.ok(runs.every((e) => e.kind === 'run'), 'kind 過濾正確')
  assert.ok(runs.every((e) => e.kind !== 'queue'))
  // updatedAt 新 → 舊（同毫秒並列時保持穩定；檢查單調非遞增）
  for (let i = 1; i < runs.length; i++) {
    assert.ok(runs[i - 1].updatedAt >= runs[i].updatedAt, 'listJournal 依 updatedAt 新→舊')
  }
  assert.ok(runs.some((e) => e.runId === 'rep-run-a') && runs.some((e) => e.runId === 'rep-run-b'))

  const queues = listJournal('queue')
  assert.ok(queues.length >= 1 && queues.every((e) => e.kind === 'queue'))

  const all = listJournal()
  assert.equal(all.length, runs.length + queues.length, '無 kind = 全量')

  // runId 查找：run kind 優先
  assert.equal(findJournalEntryByRunId('rep-run-a')?.threadId, 'rep-thread-a')
  assert.equal(findJournalEntryByRunId('rep-run-c')?.kind, 'queue', '附屬條目可經 runId 找到')
  assert.equal(findJournalEntryByRunId('no-such-run'), undefined)
}

// ── 4. Report source resolver（票 04）：齊件、缺件降級、CLI run、血緣鏈 ──
{
  resetRunJournalForTests()
  recordRunAdmitted({ runId: 'r-main', objective: 'goal run', sourceKind: 'composer' })
  recordRunStarted({ runId: 'r-main', threadId: 't-1' })
  recordRunTerminal({ runId: 'r-main', threadId: 't-1', status: 'failed' })
  recordRunAdmitted({ runId: 'r-retry', objective: 'goal run (retry)', sourceKind: 'retry' })
  recordRunStarted({ runId: 'r-retry', threadId: 't-1' })
  recordRunTerminal({ runId: 'r-retry', threadId: 't-1', status: 'success' })

  const archive: ArchiveRecord[] = [
    {
      id: 'r-retry',
      status: 'success',
      objective: 'goal run (retry)',
      loopType: 'Goal-based',
      confidence: 0.93,
      timestamp: '2026-08-16T01:05:00Z',
      iterations: 2,
      maxIterations: 6,
      steps: [],
      logs: [],
    },
  ]
  const summaries = {
    't-1': { status: 'success' as const, operations: [{ id: 'op1', kind: 'tool', title: '已執行 read' }], files: [] },
  }

  // 齊件：journal + archive + summary；血緣鏈含同 thread 兩筆
  const bundle = resolveReportSource({
    runId: 'r-retry',
    journal: listJournal(),
    archive,
    threadSummaries: summaries,
  })
  assert.equal(bundle.runnerKind, 'builtin')
  assert.equal(bundle.archive?.id, 'r-retry')
  assert.equal(bundle.threadSummary?.status, 'success')
  assert.deepEqual(bundle.degraded, [])
  assert.ok(bundle.lineageRunIds.includes('r-main') && bundle.lineageRunIds.includes('r-retry'), '血緣鏈含重跑前後')

  // 缺件降級：未知 runId → 三項缺件全標
  const empty = resolveReportSource({ runId: 'nope', journal: listJournal(), archive, threadSummaries: summaries })
  assert.deepEqual(empty.degraded.sort(), ['no-archive', 'no-journal', 'no-thread-summary'])
  assert.deepEqual(empty.lineageRunIds, ['nope'])

  // CLI run：externalRun 標記 → runnerKind=external（報告端誠實標章來源）
  const cliBundle = resolveReportSource({
    runId: 'r-cli',
    journal: [
      { id: 'j-cli', kind: 'run', status: 'success', runId: 'r-cli', threadId: 't-2', attempt: 1, startedAt: '2026-08-16T02:00:00Z', updatedAt: '2026-08-16T02:01:00Z' },
    ],
    archive: [
      { id: 'r-cli', status: 'success', objective: 'cli run', loopType: 'Goal-based', confidence: null, timestamp: '2026-08-16T02:01:00Z', iterations: 1, maxIterations: 6, steps: [], logs: [], externalRun: { kind: 'codex', label: 'Codex' } as ArchiveRecord['externalRun'] },
    ],
    threadSummaries: {},
  })
  assert.equal(cliBundle.runnerKind, 'external')
  assert.deepEqual(cliBundle.degraded, ['no-thread-summary'])
}

// ── 5. 報告模型＋Markdown 序列化（票 05）：四種形態＋遮敏 ──
{
  const { buildRunReportModel, renderRunReportMarkdown, redactReportText } = await import(
    '../src/agent/runReport.ts'
  )

  const mkBundle = (overrides: Partial<Parameters<typeof resolveReportSource>[0]> & object = {}) =>
    resolveReportSource({
      runId: 'rr-run',
      journal: [
        { id: 'j1', kind: 'run', status: 'success', runId: 'rr-run', threadId: 'rr-t', attempt: 1, startedAt: '2026-08-16T03:00:00Z', updatedAt: '2026-08-16T03:02:00Z' },
      ],
      archive: [],
      threadSummaries: {},
      ...(overrides as Partial<Parameters<typeof resolveReportSource>[0]>),
    })

  // 成功 run（語意驗收通過）→ 已驗證完成
  const okBundle = mkBundle({
    archive: [
      {
        id: 'rr-run', status: 'success', objective: '完成報告功能', loopType: 'Goal-based',
        confidence: 0.95, timestamp: '2026-08-16T03:02:00Z', iterations: 2, maxIterations: 6,
        steps: [], logs: [], definitionOfDone: '所有測試通過且文件更新',
        dodVerdicts: [
          { iteration: 1, met: false, semantic: true, confidence: 0.4, missing: ['測試未跑'], evaluatedAt: '2026-08-16T03:00:30Z' },
          { iteration: 2, met: true, semantic: true, confidence: 0.95, missing: [], evaluatedAt: '2026-08-16T03:01:30Z' },
        ],
      },
    ],
    threadSummaries: {
      'rr-t': {
        status: 'success',
        operations: [{ id: 'o1', kind: 'tool', title: '已執行 bash', ok: true }],
        files: [{ path: 'src/a.ts', action: 'edit', added: 10, removed: 2 }],
      },
    },
  })
  const okModel = buildRunReportModel(okBundle, { generatedAt: '2026-08-16T04:00:00Z' })
  assert.equal(okModel.verifiedCompletion, true)
  assert.deepEqual(okModel.convergence, [1, 0])
  const okMd = renderRunReportMarkdown(okModel)
  assert.ok(okMd.includes('已驗證完成'))
  assert.ok(okMd.includes('所有測試通過且文件更新'))
  assert.ok(okMd.includes('任務史') === false, '單 run 無血緣節區')
  assert.ok(okMd.includes('src/a.ts'))

  // 部分缺口 run → 缺口清單＋建議
  const gapBundle = mkBundle({
    archive: [
      {
        id: 'rr-run', status: 'failed', objective: '修 bug', loopType: 'Goal-based',
        confidence: 0.5, timestamp: '2026-08-16T03:02:00Z', iterations: 6, maxIterations: 6,
        steps: [], logs: [], definitionOfDone: '測試全綠',
        dodVerdicts: [{ iteration: 6, met: false, semantic: true, confidence: 0.5, missing: ['e2e 未過'], evaluatedAt: '2026-08-16T03:01:30Z' }],
      },
    ],
  })
  const gapMd = renderRunReportMarkdown(buildRunReportModel(gapBundle, { generatedAt: '2026-08-16T04:00:00Z' }))
  assert.ok(gapMd.includes('缺口清單') && gapMd.includes('e2e 未過'))
  assert.ok(gapMd.includes('建議下一步'))

  // CLI run → 誠實標章、不宣稱 DoD 已驗證
  const cliBundle = mkBundle({
    archive: [
      { id: 'rr-run', status: 'success', objective: 'cli 任務', loopType: 'Goal-based', confidence: null, timestamp: '2026-08-16T03:02:00Z', iterations: 1, maxIterations: 6, steps: [], logs: [], externalRun: { kind: 'codex' } as never },
    ],
  })
  const cliMd = renderRunReportMarkdown(buildRunReportModel(cliBundle, { generatedAt: '2026-08-16T04:00:00Z' }))
  assert.ok(cliMd.includes('外部 CLI 執行結束'), 'CLI 誠實標章（EXTERNAL_CLI_DOD_LABEL）')
  assert.ok(!cliMd.includes('已驗證完成'))
  assert.ok(cliMd.includes('外部 CLI run 不經內建 DoD 驗收'))

  // 遮敏：token 形狀不進輸出（objective／操作／檔案路徑）
  const leakBundle = mkBundle({
    archive: [
      { id: 'rr-run', status: 'success', objective: '用 sk-abcdef1234567890 呼叫 API', loopType: 'Turn-based', confidence: 0.9, timestamp: '2026-08-16T03:02:00Z', iterations: 1, maxIterations: 6, steps: [], logs: [] },
    ],
    threadSummaries: {
      'rr-t': {
        status: 'success',
        operations: [{ id: 'o1', kind: 'tool', title: '已執行 fetch with Bearer abcdef123456', ok: true }],
        files: [],
      },
    },
  })
  const leakMd = renderRunReportMarkdown(buildRunReportModel(leakBundle, { generatedAt: '2026-08-16T04:00:00Z' }))
  assert.ok(!leakMd.includes('sk-abcdef1234567890'), 'API key 形狀不得外洩')
  assert.ok(!leakMd.includes('Bearer abcdef123456'), 'Bearer token 不得外洩')
  assert.ok(leakMd.includes('⟦REDACTED⟧'))
  assert.ok(!redactReportText('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456').includes('ghp_'))
}

// ── 6. HTML 同源序列化（票 06）：自包含、離線可讀、內容與 MD 同源 ──
{
  const { buildRunReportModel, renderRunReportHtml, renderRunReportMarkdown } = await import(
    '../src/agent/runReport.ts'
  )
  const bundle = resolveReportSource({
    runId: 'html-run',
    journal: [
      { id: 'j1', kind: 'run', status: 'success', runId: 'html-run', threadId: 'html-t', attempt: 1, startedAt: '2026-08-16T05:00:00Z', updatedAt: '2026-08-16T05:02:00Z' },
    ],
    archive: [
      { id: 'html-run', status: 'success', objective: 'HTML 報告 <script>alert(1)</script>', loopType: 'Goal-based', confidence: 0.9, timestamp: '2026-08-16T05:02:00Z', iterations: 1, maxIterations: 6, steps: [], logs: [], definitionOfDone: '全綠', dodVerdicts: [{ iteration: 1, met: true, semantic: true, confidence: 0.9, missing: [], evaluatedAt: '2026-08-16T05:01:00Z' }] },
    ],
    threadSummaries: { 'html-t': { status: 'success', operations: [], files: [] } },
  })
  const model = buildRunReportModel(bundle, { generatedAt: '2026-08-16T06:00:00Z' })
  const html = renderRunReportHtml(model)

  // 自包含：無外部資源引用
  assert.ok(!/src=|href=|@import|url\(/i.test(html), 'HTML 須自包含（無外部資源）')
  assert.ok(html.startsWith('<!DOCTYPE html>') && html.includes('<style>'))
  // 與 MD 同源：關鍵內容兩端皆在
  const md = renderRunReportMarkdown(model)
  for (const key of ['已驗證完成', 'HTML 報告', '全綠', 'html-run']) {
    assert.ok(html.includes(key) && md.includes(key), `兩端皆應含：${key}`)
  }
  // 不可注入：objective 內的 script 標籤被轉義
  assert.ok(!html.includes('<script>alert'), 'HTML 須轉義內容（不可注入）')
  assert.ok(html.includes('&lt;script&gt;'))
}

console.log('Run reports smoke: 6 groups passed (verdicts + journal + resolver + MD + HTML)')
