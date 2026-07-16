/**
 * Bash 命令安全切段 — grok-build 22-permissions 語意,並比它更嚴:
 *
 * - 鏈式命令以 `&&` / `||` / `;` / `|` / 換行切段(引號感知)
 * - deny / ask 檢查每一段(含 wrapper 剝除後的內層命令)
 * - allow 必須「每一段」都命中才免問 —— grok 的 allow 只看整串,
 *   `Bash(git *)` 會放行 `git status && rm -rf /`;此處刻意收緊
 * - 段首剝 env 前綴(`RUST_LOG=x cmd`)與固定 wrapper
 *   (timeout/nice/ionice/chrt/stdbuf/env);sudo/xargs/nohup 不剝
 * - `bash -c '...'` 內嵌 script 也展開檢查
 * - 無法安全切段的結構(子 shell、`$(...)`、backtick、背景 `&`、
 *   process substitution、控制流)整串視為單一單位強制詢問
 * - 危險命令清單(rm、chmod、chown、kill 系、git push…):allow pattern
 *   不可越過,一律 HITL ask(比 grok 嚴;grok 的 config allow 可放行)
 *
 * 純邏輯;smoke-caps.mjs 鏡射驗證。
 */

/** grok-build dangerous list + dd/mkfs。 */
export const DANGEROUS_COMMANDS = new Set([
  'rm',
  'chmod',
  'chown',
  'chgrp',
  'chattr',
  'pkill',
  'kill',
  'killall',
  'dd',
  'mkfs',
])

/** 段首出現即視為無法安全切段的控制流關鍵字。 */
const CONTROL_KEYWORDS = new Set([
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'for',
  'while',
  'until',
  'do',
  'done',
  'case',
  'esac',
  'function',
  'select',
])

/** 可剝除的固定 wrapper(grok 同款);sudo / xargs / nohup 刻意不剝。 */
const PEELABLE_WRAPPERS = new Set(['timeout', 'nice', 'ionice', 'chrt', 'stdbuf', 'env'])

/** wrapper 之後帶獨立值的選項(`nice -n 10`、`ionice -c 2`…)。 */
const VALUE_OPTIONS = new Set(['-n', '-c', '-t', '-p', '-o', '-e', '-i'])

export interface ShellSegment {
  /** 切出來的原字串(deny/ask pattern 要能 match 到 wrapped 形式) */
  raw: string
  /** 剝除 env 前綴與 wrapper 後的內層命令 */
  effective: string
  dangerous: boolean
}

export interface ShellCommandAnalysis {
  segments: ShellSegment[]
  /** 子 shell / 替換 / 背景 / 控制流 — 整串必須視為單一單位 */
  unsplittable: boolean
  /** 任一段命中危險清單 */
  dangerous: boolean
}

/**
 * 引號感知切段。回傳 null 表示遇到無法安全切段的結構。
 */
function splitSegments(command: string): string[] | null {
  const segments: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    const next = command[i + 1]
    if (quote) {
      current += ch
      if (ch === quote && command[i - 1] !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    if (ch === '\\') {
      current += ch + (next ?? '')
      i += 1
      continue
    }
    if (ch === '`') return null
    if (ch === '$' && next === '(') return null
    if ((ch === '<' || ch === '>') && next === '(') return null
    if (ch === '(') return null
    if (ch === '&') {
      if (next === '&') {
        segments.push(current)
        current = ''
        i += 1
        continue
      }
      return null // 背景執行,無法檢查
    }
    if (ch === '|') {
      segments.push(current)
      current = ''
      if (next === '|') i += 1
      continue
    }
    if (ch === ';' || ch === '\n') {
      segments.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (quote) return null // 未閉合引號,保守處理
  segments.push(current)
  return segments.map((s) => s.trim()).filter(Boolean)
}

/** 剝除段首 env 賦值與固定 wrapper,回傳內層命令。 */
export function peelWrappers(segment: string): string {
  const tokens = segment.trim().split(/\s+/)
  let i = 0
  for (;;) {
    // env 前綴:RUST_LOG=debug cmd
    while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i += 1
    const head = (tokens[i] || '').toLowerCase()
    if (!PEELABLE_WRAPPERS.has(head)) break
    i += 1
    // wrapper 自身的選項(含帶值選項)
    while (i < tokens.length && tokens[i].startsWith('-')) {
      const opt = tokens[i]
      i += 1
      if (VALUE_OPTIONS.has(opt) && i < tokens.length && !tokens[i].startsWith('-')) i += 1
    }
    // timeout 5 / chrt 99 / nice 10 之類的位置參數
    if ((head === 'timeout' || head === 'chrt' || head === 'nice') && i < tokens.length) {
      if (/^\d+(?:\.\d+)?[smhd]?$/.test(tokens[i])) i += 1
    }
    // env 的 VAR=… 賦值串
    if (head === 'env') {
      while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i += 1
    }
  }
  return tokens.slice(i).join(' ')
}

export function isDangerousCommand(effective: string): boolean {
  const words = effective.trim().split(/\s+/)
  const first = (words[0] || '').toLowerCase()
  if (DANGEROUS_COMMANDS.has(first)) return true
  if (first.startsWith('mkfs.')) return true
  if (first === 'git' && (words[1] || '').toLowerCase() === 'push') return true
  return false
}

/** `bash -c '…'` / `sh -c "…"` 內嵌 script 抽出(單層)。 */
function extractInlineScript(effective: string): string | null {
  const m = /^(?:bash|sh|zsh)\s+(?:-\S+\s+)*-c\s+(['"])([\s\S]+)\1\s*$/.exec(effective.trim())
  return m ? m[2] : null
}

export function analyzeShellCommand(command: string): ShellCommandAnalysis {
  const trimmed = command.trim()
  if (!trimmed) return { segments: [], unsplittable: false, dangerous: false }

  const rawSegments = splitSegments(trimmed)
  if (!rawSegments) {
    const effective = peelWrappers(trimmed)
    return {
      segments: [{ raw: trimmed, effective, dangerous: isDangerousCommand(effective) }],
      unsplittable: true,
      dangerous: isDangerousCommand(effective),
    }
  }

  const segments: ShellSegment[] = []
  let unsplittable = false
  let dangerous = false

  const pushSegment = (raw: string) => {
    const effective = peelWrappers(raw)
    const firstWord = (effective.split(/\s+/)[0] || '').toLowerCase()
    if (CONTROL_KEYWORDS.has(firstWord)) {
      unsplittable = true
    }
    const seg: ShellSegment = {
      raw,
      effective,
      dangerous: isDangerousCommand(effective),
    }
    if (seg.dangerous) dangerous = true
    segments.push(seg)

    // bash -c 內嵌 script:展開一層,讓 deny/ask/危險清單掃得到
    const inline = extractInlineScript(effective)
    if (inline) {
      const inner = splitSegments(inline)
      if (!inner) {
        unsplittable = true
        return
      }
      for (const innerRaw of inner) {
        const innerEffective = peelWrappers(innerRaw)
        const innerFirst = (innerEffective.split(/\s+/)[0] || '').toLowerCase()
        if (CONTROL_KEYWORDS.has(innerFirst)) unsplittable = true
        const innerSeg: ShellSegment = {
          raw: innerRaw,
          effective: innerEffective,
          dangerous: isDangerousCommand(innerEffective),
        }
        if (innerSeg.dangerous) dangerous = true
        segments.push(innerSeg)
      }
    }
  }

  for (const raw of rawSegments) pushSegment(raw)

  return { segments, unsplittable, dangerous }
}

export type BashPermissionAction = 'allow' | 'ask' | 'deny'

/** deny > ask > allow。 */
export function maxSeverity(
  a: BashPermissionAction,
  b: BashPermissionAction,
): BashPermissionAction {
  if (a === 'deny' || b === 'deny') return 'deny'
  if (a === 'ask' || b === 'ask') return 'ask'
  return 'allow'
}

/**
 * 段級決策核心(純函式)。resolver 由呼叫端注入,合約:
 * `resolve(candidate, fallback)` — 明確 pattern 命中回 allow/ask/deny,
 * 否則回傳 fallback。以兩種 fallback 呼叫即可區分「明確命中」與「無規則」:
 * `resolve(c,'allow')==='deny'|'ask'` 是明確 deny/ask;
 * `resolve(c,'ask')==='allow'` 是明確 allow。
 *
 * 規則(deny > ask > allow,對 raw 與 wrapper 剝除後的 effective 皆檢查):
 * - 整串或任一段明確 deny → deny
 * - 無法切段 → ask(整串單一單位)
 * - 危險命令 → ask(allow pattern 不可越過;比 grok 嚴)
 * - 任一段明確 ask → ask
 * - 每一段都明確 allow → allow;否則依 fallback
 */
export function decideBashAction(
  command: string,
  resolve: (candidate: string, fallback: BashPermissionAction) => BashPermissionAction,
  fallback: BashPermissionAction = 'ask',
): { action: BashPermissionAction; reason: string } {
  const analysis = analyzeShellCommand(command)
  if (!analysis.segments.length) return { action: 'ask', reason: '空命令' }

  const explicitDeny = (c: string) => resolve(c, 'allow') === 'deny'
  const explicitAsk = (c: string) => resolve(c, 'allow') === 'ask'
  const explicitAllow = (c: string) => resolve(c, 'ask') === 'allow'

  // deny:整串 + 每段(wrapped 與 peeled 皆檢查)
  if (explicitDeny(command.trim())) {
    return { action: 'deny', reason: '整串命中 deny pattern' }
  }
  for (const seg of analysis.segments) {
    if (explicitDeny(seg.raw) || explicitDeny(seg.effective)) {
      return { action: 'deny', reason: `段「${seg.effective.slice(0, 60)}」命中 deny pattern` }
    }
  }

  if (analysis.unsplittable) {
    return {
      action: 'ask',
      reason: '含子 shell／替換／背景／控制流,無法逐段檢查,整串需核准',
    }
  }
  if (analysis.dangerous) {
    const hit = analysis.segments.find((s) => s.dangerous)
    return {
      action: 'ask',
      reason: `危險命令「${(hit?.effective || '').split(/\s+/).slice(0, 2).join(' ')}」需人工核准(allow pattern 不可越過)`,
    }
  }

  let uncovered: string | null = null
  for (const seg of analysis.segments) {
    if (explicitAsk(seg.raw) || explicitAsk(seg.effective)) {
      return { action: 'ask', reason: `段「${seg.effective.slice(0, 60)}」命中 ask pattern` }
    }
    if (explicitAllow(seg.raw) || explicitAllow(seg.effective)) continue
    uncovered = uncovered ?? seg.effective
  }
  if (uncovered !== null && fallback !== 'allow') {
    return { action: 'ask', reason: `段「${uncovered.slice(0, 60)}」未被 allow pattern 涵蓋` }
  }
  return {
    action: 'allow',
    reason: uncovered === null ? '所有段皆命中 allow pattern' : '預設放行(bashRequireAsk 關閉)',
  }
}
