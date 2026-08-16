/**
 * Run report 產製核心（dod-verified-reports 票 05）。
 *
 * ReportSourceBundle → RunReportModel（結構化）→ Markdown。
 * 純函數：不讀 store、不觸 IPC、輸出先遮敏。
 * HTML 端（票 06）與 transcript（票 10）共用同一模型。
 */
import { dodConvergence, finalDodVerdict } from './dodVerdicts.ts'
import type { ReportSourceBundle } from './reportSource.ts'
import { EXTERNAL_CLI_DOD_LABEL } from './runners/types.ts'
import type { DodVerdict } from './types'

export interface RunReportModel {
  title: string
  runId: string
  threadId?: string
  generatedAt: string
  objective: string
  runnerKind: 'builtin' | 'external'
  simulated: boolean
  status: string
  dodText?: string
  verdicts: DodVerdict[]
  convergence: number[]
  confidence: number | null
  iterations: number | null
  maxIterations: number | null
  /** 未達成缺口（最後一筆 verdict 的 missing；無 verdict 時為空） */
  gaps: string[]
  verifiedCompletion: boolean
  operations: Array<{ kind: string; title: string; detail?: string; path?: string; ok?: boolean }>
  files: Array<{ path: string; action: string; added?: number; removed?: number }>
  agents: Array<{ name: string; role: string; status: string; model?: string }>
  lineageRunIds: string[]
  degraded: string[]
  tokensUsed?: number
}

/** 報告端遮敏（最低防線）：常見 token／金鑰形狀不出現於輸出 */
const REPORT_REDACTIONS: Array<[RegExp, string]> = [
  [/sk-[A-Za-z0-9_-]{8,}/g, '⟦REDACTED⟧'],
  [/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer ⟦REDACTED⟧'],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, '⟦REDACTED⟧'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/g, '⟦REDACTED⟧'],
  [/AKIA[0-9A-Z]{16}/g, '⟦REDACTED⟧'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '⟦REDACTED⟧'],
]

export function redactReportText(text: string): string {
  return REPORT_REDACTIONS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text)
}

export function buildRunReportModel(
  bundle: ReportSourceBundle,
  opts: { generatedAt: string },
): RunReportModel {
  const archive = bundle.archive
  const summary = bundle.threadSummary
  const verdicts = archive?.dodVerdicts?.length ? archive.dodVerdicts : summary?.dodVerdicts || []
  const final = finalDodVerdict(verdicts)
  const rawObjective = archive?.objective || bundle.lifecycle?.objective || '(目標不可得)'
  // 模型層即遮敏（title 含 objective）；序列化層再遮一次作縱深
  const objective = redactReportText(rawObjective)
  return {
    title: `驗證執行報告 · ${objective.slice(0, 60)}`,
    runId: bundle.runId,
    threadId: bundle.threadId,
    generatedAt: opts.generatedAt,
    objective,
    runnerKind: bundle.runnerKind,
    simulated: archive?.simulated === true || summary?.simulated === true,
    status: archive?.status || bundle.lifecycle?.status || 'unknown',
    dodText: archive?.definitionOfDone || summary?.definitionOfDone,
    verdicts,
    convergence: dodConvergence(verdicts),
    confidence: archive?.confidence ?? null,
    iterations: archive?.iterations ?? null,
    maxIterations: archive?.maxIterations ?? null,
    gaps: final && !final.met ? final.missing : [],
    verifiedCompletion: final?.met === true && final.semantic === true,
    operations: (summary?.operations || []).slice(0, 40),
    files: summary?.files || [],
    agents: (summary?.agents || []).map((agent) => ({
      name: agent.name,
      role: agent.role,
      status: agent.status,
      model: agent.model,
    })),
    lineageRunIds: bundle.lineageRunIds,
    degraded: bundle.degraded,
    tokensUsed: archive?.tokensUsed,
  }
}

export function renderRunReportMarkdown(model: RunReportModel): string {
  const lines: string[] = []
  const push = (...rows: string[]) => lines.push(...rows)

  push(`# ${model.title}`, '')
  push(
    `- **Run**：\`${model.runId}\`${model.threadId ? ` · Thread：\`${model.threadId}\`` : ''}`,
    `- **狀態**：${model.status}${model.simulated ? ' · ⚠ 模擬執行（未使用語言模型）' : ''}`,
    `- **產出時間**：${model.generatedAt}`,
    `- **迭代**：${model.iterations ?? '—'} / ${model.maxIterations ?? '—'} · **信心度**：${
      model.confidence != null ? model.confidence.toFixed(2) : '—'
    }${model.tokensUsed != null ? ` · ${model.tokensUsed} tokens` : ''}`,
    '',
  )

  if (model.runnerKind === 'external') {
    push(`> ⚠ ${EXTERNAL_CLI_DOD_LABEL}`, '')
  }

  push('## 目標', '', redactReportText(model.objective), '')

  push('## DoD 驗收', '')
  if (model.dodText) {
    push('> ' + redactReportText(model.dodText).replace(/\n/g, '\n> '), '')
  } else {
    push('（本 run 無 DoD 文本記錄）', '')
  }
  if (model.verdicts.length) {
    push('| 輪次 | 判定 | 驗收方式 | 信心度 | 剩餘缺口 |', '|---:|---|---|---:|---|')
    for (const verdict of model.verdicts) {
      push(
        `| ${verdict.iteration} | ${verdict.met ? '✅ 通過' : '❌ 未達'} | ${
          verdict.semantic ? '語意驗收' : '啟發式（未驗證）'
        } | ${verdict.confidence.toFixed(2)} | ${verdict.missing.length} |`,
      )
    }
    push('')
    push(
      model.verifiedCompletion
        ? '**已驗證完成**：最終一輪語意驗收通過。'
        : finalDodVerdict(model.verdicts)?.met
          ? '**執行完畢（未驗證）**：最終輪僅啟發式判定，未經語意驗收。'
          : '**未達成**：以下缺口尚未補齊。',
      '',
    )
    if (model.gaps.length) {
      push('### 缺口清單', '')
      for (const gap of model.gaps) push(`- ${redactReportText(gap)}`)
      push('', '### 建議下一步', '', '- 針對上述缺口重跑（chat 內「調整參數重跑」）或以 Continue Goal 補齊', '')
    }
  } else {
    push(
      model.runnerKind === 'external'
        ? '（外部 CLI run 不經內建 DoD 驗收——見上方標章）'
        : '（無逐輪判定記錄：可能為 Turn-based 或早期版本 run）',
      '',
    )
  }

  if (model.files.length) {
    push('## 檔案變更', '')
    for (const file of model.files.slice(0, 80)) {
      const delta =
        file.added != null || file.removed != null
          ? `（+${file.added ?? 0} / −${file.removed ?? 0}）`
          : ''
      push(`- \`${redactReportText(file.path)}\` · ${file.action} ${delta}`)
    }
    push('')
  }

  if (model.operations.length) {
    push('## 執行軌跡摘要', '')
    for (const op of model.operations.slice(0, 40)) {
      const mark = op.ok === false ? '✗' : '·'
      push(`- ${mark} ${redactReportText(op.title)}${op.path ? `（\`${redactReportText(op.path)}\`）` : ''}`)
    }
    push('')
  }

  if (model.agents.length) {
    push('## Sub-agents', '')
    for (const agent of model.agents) {
      push(`- ${agent.name}（${agent.role}）· ${agent.status}${agent.model ? ` · ${agent.model}` : ''}`)
    }
    push('')
  }

  if (model.lineageRunIds.length > 1) {
    push('## 任務史（同 thread 重跑鏈）', '', model.lineageRunIds.map((id) => `\`${id}\``).join(' → '), '')
  }

  if (model.degraded.length) {
    push('## 資料完整性', '')
    for (const item of model.degraded) {
      push(`- ⚠ ${item === 'no-journal' ? '無生命週期記錄（journal）' : item === 'no-archive' ? '無封存記錄——證據可能不完整' : '無 thread 摘要（diff／操作軌跡缺件）'}`)
    }
    push('')
  }

  push('---', '', '*本報告由 SubAgents AI 本機產製；敏感憑證形狀已遮蔽。*')
  return lines.join('\n')
}

/**
 * Transcript 序列化（票 10）：ThreadRunSummary 的分組執行紀錄 → 可離線閱讀文件。
 * 不依賴 ephemeral 即時活動；內容有界（操作 40、diff 節錄 20k）。
 */
export function renderTranscriptMarkdown(args: {
  runId?: string
  objective?: string
  operations: Array<{ kind: string; title: string; detail?: string; path?: string; ok?: boolean }>
  files: Array<{ path: string; action: string; added?: number; removed?: number }>
  agents?: Array<{ name: string; role: string; status: string; model?: string }>
  diff?: string
  generatedAt: string
}): string {
  const lines: string[] = []
  const push = (...rows: string[]) => lines.push(...rows)
  push(
    `# 執行紀錄（Transcript）${args.runId ? ` · \`${args.runId}\`` : ''}`,
    '',
    `- **產出時間**：${args.generatedAt}`,
    args.objective ? `- **目標**：${redactReportText(args.objective)}` : '',
    '',
  )
  push('## 操作軌跡', '')
  if (args.operations.length) {
    for (const op of args.operations.slice(0, 40)) {
      const mark = op.ok === false ? '✗' : '·'
      const detail = op.detail ? `\n  \`\`\`\n  ${redactReportText(op.detail).slice(0, 400).replace(/\n/g, '\n  ')}\n  \`\`\`` : ''
      push(`- ${mark} ${redactReportText(op.title)}${op.path ? `（\`${redactReportText(op.path)}\`）` : ''}${detail}`)
    }
  } else {
    push('（無操作記錄）')
  }
  push('')
  if (args.files.length) {
    push('## 檔案變更', '')
    for (const file of args.files.slice(0, 80)) {
      const delta =
        file.added != null || file.removed != null ? `（+${file.added ?? 0} / −${file.removed ?? 0}）` : ''
      push(`- \`${redactReportText(file.path)}\` · ${file.action} ${delta}`)
    }
    push('')
  }
  if (args.agents?.length) {
    push('## Sub-agents', '')
    for (const agent of args.agents) {
      push(`- ${agent.name}（${agent.role}）· ${agent.status}${agent.model ? ` · ${agent.model}` : ''}`)
    }
    push('')
  }
  if (args.diff?.trim()) {
    push('## Diff 節錄', '', '```diff', redactReportText(args.diff.slice(0, 20_000)), '```', '')
  }
  push('---', '', '*SubAgents AI 執行紀錄 · 本機產製 · 敏感憑證形狀已遮蔽。*')
  return lines.join('\n')
}
/**
 * HTML 序列化（票 06）：與 Markdown 同一文件模型的第二個序列化端。
 * 自包含離線文件——樣式內嵌、無外部資源；MD 內容經輕量轉義後包 <pre> 區塊，
 * 確保兩端內容同源且不可注入。
 */
export function renderRunReportHtml(model: RunReportModel): string {
  const escapeHtml = (text: string): string =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const body = renderRunReportMarkdown(model)
    .split('\n')
    .map((line) => (line.trim() === '' ? '<span class="blank"></span>' : escapeHtml(line)))
    .join('\n')
  return [
    '<!DOCTYPE html>',
    '<html lang="zh-Hant">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(model.title)}</title>`,
    '<style>',
    ':root { color-scheme: dark; }',
    'body { margin: 0; background: #101613; color: #dfe7e2; font: 14px/1.65 ui-monospace, "SF Mono", Menlo, monospace; padding: 32px 16px; }',
    '.page { max-width: 860px; margin: 0 auto; background: #16201b; border: 1px solid #2c3a32; border-radius: 14px; padding: 28px 32px; }',
    'pre { white-space: pre-wrap; word-break: break-word; margin: 0; }',
    '.blank { display: block; height: 0.7em; }',
    'footer { margin-top: 24px; font-size: 12px; color: #8ba397; }',
    '</style>',
    '</head>',
    '<body>',
    '<div class="page">',
    `<pre>${body}</pre>`,
    '<footer>SubAgents AI · 驗證執行報告 · 本機產製</footer>',
    '</div>',
    '</body>',
    '</html>',
  ].join('\n')
}
