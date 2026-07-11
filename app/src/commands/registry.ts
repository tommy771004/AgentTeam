/**
 * Slash command registry — Claude Code / Codex / OpenCode 風格
 * 輸入 `/` 或 ⌘/ 時彈出可篩選指令列表
 * OpenCode commands/*.md 與 opencode.json command 會動態合併進來
 */

export type SlashCommandCategory =
  | 'session'
  | 'project'
  | 'agent'
  | 'nav'
  | 'tools'
  | 'learning'
  | 'opencode'

export interface SlashCommand {
  name: string
  /** 不含斜線，例如 "run" */
  aliases?: string[]
  description: string
  category: SlashCommandCategory
  argsHint?: string
  /** 若為 true，需要額外參數才執行 */
  needsArgs?: boolean
  /** Dynamic OpenCode command */
  source?: 'builtin' | 'opencode'
  /** Template with $ARGUMENTS for OpenCode commands */
  template?: string
  /** Prefer agent for this command */
  agentHint?: string
  modelHint?: string
}

/** Built-in static list (OpenCode dynamics appended at runtime) */
export const SLASH_COMMANDS: SlashCommand[] = [
  // ── Session ───────────────────────────────────────────
  {
    name: 'help',
    aliases: ['?', 'commands'],
    description: '顯示指令說明',
    category: 'session',
  },
  {
    name: 'clear',
    aliases: ['new', 'reset'],
    description: '清空對話與輸入，開始新 session',
    category: 'session',
  },
  {
    name: 'status',
    aliases: ['info'],
    description: '顯示目前代理／模式／模型狀態',
    category: 'session',
  },
  {
    name: 'cost',
    aliases: ['tokens', 'usage'],
    description: '顯示本次執行 token 用量',
    category: 'session',
  },
  {
    name: 'model',
    aliases: ['models'],
    description: '此對話模型（或 /model global <id> 改全域）',
    category: 'session',
    argsHint: '[模型id | global <id>]',
  },
  {
    name: 'depth',
    aliases: ['think', 'thinking'],
    description: '推理強度：快思|中|高|極高|超高',
    category: 'session',
    argsHint: '[fast|standard|deep|max|ultra]',
  },
  {
    name: 'opencode',
    aliases: ['oc'],
    description: 'OpenCode：detect / agents / run',
    category: 'tools',
    argsHint: '[detect|agents|run …]',
  },
  {
    name: 'codegraph',
    aliases: ['cg', 'graph'],
    description: 'CodeGraph：status|init|sync|explore|impact|callers',
    category: 'tools',
    argsHint: '[status|init|sync|explore <q>|impact <sym>|callers <sym>]',
  },
  {
    name: 'knowledge',
    aliases: ['kg'],
    description: '開啟知識圖譜頁',
    category: 'nav',
  },
  {
    name: 'doctor',
    aliases: ['health', 'check'],
    description: '健康檢查（API、工具、閘道）',
    category: 'session',
  },
  {
    name: 'export',
    aliases: ['copy'],
    description: '複製最近 session 摘要到剪貼簿',
    category: 'session',
  },
  {
    name: 'undo',
    description: '還原上一則輸入（指令歷史）',
    category: 'session',
  },
  {
    name: 'history',
    aliases: ['hist'],
    description: '顯示最近輸入歷史',
    category: 'session',
  },
  {
    name: 'quit',
    aliases: ['exit', 'hide'],
    description: '隱藏視窗到系統匣',
    category: 'session',
  },

  // ── Agent ─────────────────────────────────────────────
  {
    name: 'run',
    aliases: ['go', 'start', 'exec'],
    description: '以目前輸入執行代理循環',
    category: 'agent',
    argsHint: '[目標…]',
  },
  {
    name: 'stop',
    aliases: ['abort', 'cancel'],
    description: '停止進行中的代理執行',
    category: 'agent',
  },
  {
    name: 'mode',
    aliases: ['pattern', 'loop', 'protocol'],
    description: '切換循環：turn | goal | time | proactive',
    category: 'agent',
    argsHint: '<turn|goal|time|proactive>',
    needsArgs: true,
  },
  {
    name: 'build',
    description: 'OpenCode Build：完整工具實作模式',
    category: 'agent',
    argsHint: '[目標…]',
  },
  {
    name: 'plan',
    description: 'OpenCode Plan：唯讀分析規劃（禁止寫入）',
    category: 'agent',
    argsHint: '[目標…]',
  },
  {
    name: 'agent',
    description: '切換主代理 build | plan（Tab 亦可）',
    category: 'agent',
    argsHint: '[build|plan]',
  },
  {
    name: 'ask',
    description: '以回合制問答（Turn-based）',
    category: 'agent',
    argsHint: '[問題…]',
  },
  {
    name: 'review',
    description: '檢視最近執行結果／前往封存',
    category: 'agent',
  },
  {
    name: 'jobs',
    aliases: ['bg', 'todo'],
    description: '列出背景委派任務',
    category: 'agent',
  },
  {
    name: 'queue',
    aliases: ['q'],
    description: '自動化待跑佇列（clear / cancel <id>）',
    category: 'agent',
  },
  {
    name: 'permissions',
    aliases: ['safety', 'auth'],
    description: '顯示安全與授權層級',
    category: 'agent',
  },
  {
    name: 'verbose',
    aliases: ['debug'],
    description: '顯示詳細執行設定摘要',
    category: 'agent',
  },
  {
    name: 'context',
    aliases: ['ctx'],
    description: '顯示 prompt 分層／記憶摘要',
    category: 'agent',
  },
  {
    name: 'init',
    description: '在專案目錄建立 AGENTS.md 範本',
    category: 'agent',
  },
  {
    name: 'thread',
    aliases: ['threads'],
    description: '建立新 Thread（/thread new）',
    category: 'session',
    argsHint: '[new]',
  },

  // ── Learning ──────────────────────────────────────────
  {
    name: 'skills',
    description: '列出可用技能',
    category: 'learning',
  },
  {
    name: 'skill',
    description: '載入技能內容',
    category: 'learning',
    argsHint: '<技能名>',
    needsArgs: true,
  },
  {
    name: 'memory',
    aliases: ['mem'],
    description: '顯示或追加記憶',
    category: 'learning',
    argsHint: '[append 文字…]',
  },

  // ── Tools ─────────────────────────────────────────────
  {
    name: 'search',
    aliases: ['find', 'web'],
    description: '網路搜尋',
    category: 'tools',
    argsHint: '<關鍵字>',
    needsArgs: true,
  },
  {
    name: 'mcp',
    description: '列出 MCP 工具與長連線 session',
    category: 'tools',
  },
  {
    name: 'gateway',
    aliases: ['telegram', 'tg'],
    description: '訊息閘道狀態（Telegram）',
    category: 'tools',
  },
  {
    name: 'diff',
    description: '顯示最近結果摘要差異（result preview）',
    category: 'tools',
  },

  // ── Project（專案目錄，非舊工作區頁）──────────────────
  {
    name: 'ls',
    aliases: ['list', 'dir'],
    description: '列出目前專案目錄',
    category: 'project',
  },
  {
    name: 'pwd',
    description: '顯示目前專案路徑',
    category: 'project',
  },
  {
    name: 'note',
    description: '在專案 reports/ 建立筆記',
    category: 'project',
  },
  {
    name: 'term',
    aliases: ['terminal', 'shell'],
    description: '開啟多頁籤終端面板',
    category: 'nav',
  },

  // ── Nav / UI ──────────────────────────────────────────
  {
    name: 'compact',
    aliases: ['mini', 'float'],
    description: '切換小視窗／浮動控制台',
    category: 'nav',
  },
  {
    name: 'expand',
    aliases: ['full'],
    description: '回到主對話並關閉小視窗',
    category: 'nav',
  },
  {
    name: 'home',
    aliases: ['chat'],
    description: '回到主對話（代理目標）',
    category: 'nav',
  },
  {
    name: 'dashboard',
    description: '前往系統總覽',
    category: 'nav',
  },
  {
    name: 'learning',
    description: '前往學習中心',
    category: 'nav',
  },
  {
    name: 'settings',
    aliases: ['config', 'login'],
    description: '前往設定',
    category: 'nav',
  },
  {
    name: 'records',
    aliases: ['logs', 'archive'],
    description: '前往封存與日誌',
    category: 'nav',
  },
  {
    name: 'automation',
    aliases: ['cron', 'schedule'],
    description: '前往自動化（排程／事件）',
    category: 'nav',
  },
  {
    name: 'docs',
    aliases: ['manual', 'readme'],
    description: '開啟文件說明',
    category: 'nav',
  },
  {
    name: 'bug',
    aliases: ['issue', 'failed'],
    description: '前往失敗紀錄／回報',
    category: 'nav',
  },
]

const CATEGORY_ZH: Record<SlashCommandCategory, string> = {
  session: '工作階段',
  project: '專案',
  agent: '代理',
  nav: '導覽',
  tools: '工具',
  learning: '學習',
  opencode: 'OpenCode',
}

export function categoryLabel(c: SlashCommandCategory) {
  return CATEGORY_ZH[c]
}

/** Sanitize OpenCode command id → slash name */
export function sanitizeSlashName(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'cmd'
}

type DynamicCmd = {
  id: string
  name: string
  description?: string
  template: string
  agent?: string
  model?: string
  source?: string
}

/**
 * Merge builtin + OpenCode dynamic commands.
 * Dynamic names that collide with builtin get `oc-` prefix.
 */
export function getAllSlashCommands(dynamic: DynamicCmd[] = []): SlashCommand[] {
  const builtinNames = new Set(
    SLASH_COMMANDS.flatMap((c) => [c.name, ...(c.aliases || [])]),
  )
  const extra: SlashCommand[] = []
  for (const d of dynamic) {
    if (!d.template?.trim()) continue
    let name = sanitizeSlashName(d.id || d.name)
    if (builtinNames.has(name)) name = `oc-${name}`
    if (extra.some((e) => e.name === name)) continue
    builtinNames.add(name)
    extra.push({
      name,
      description: d.description || `OpenCode: ${d.name || d.id}`,
      category: 'opencode',
      argsHint: d.template.includes('$ARGUMENTS') ? '<args>' : undefined,
      needsArgs: d.template.includes('$ARGUMENTS'),
      source: 'opencode',
      template: d.template,
      agentHint: d.agent,
      modelHint: d.model,
      aliases: d.name && sanitizeSlashName(d.name) !== name ? [sanitizeSlashName(d.name)] : undefined,
    })
  }
  return [
    ...SLASH_COMMANDS.map((c) => ({ ...c, source: c.source || ('builtin' as const) })),
    ...extra,
  ]
}

/** Live list (builtin + hydrated OpenCode commands). Safe for non-React call sites. */
export function getLiveSlashCommands(): SlashCommand[] {
  try {
    // Dynamic import avoided: store is lightweight; only read getState
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../store/opencodeConfigStore') as {
      useOpenCodeConfigStore: { getState: () => { commands?: DynamicCmd[] } }
    }
    return getAllSlashCommands(mod.useOpenCodeConfigStore.getState().commands || [])
  } catch {
    return getAllSlashCommands()
  }
}

export function resolveSlashCommand(token: string): SlashCommand | undefined {
  const name = token.replace(/^\//, '').toLowerCase()
  const all = getLiveSlashCommands()
  return all.find((c) => c.name === name || c.aliases?.some((a) => a === name))
}

/** Filter commands by query after `/` */
export function filterSlashCommands(query: string): SlashCommand[] {
  const all = getLiveSlashCommands()
  const q = query.replace(/^\//, '').toLowerCase().trim()
  if (!q) return all
  return all.filter((c) => {
    if (c.name.startsWith(q)) return true
    if (c.aliases?.some((a) => a.startsWith(q) || a.includes(q))) return true
    if (c.description.toLowerCase().includes(q)) return true
    return c.name.includes(q)
  })
}

/** Parse `/cmd args...` from full input line */
export function parseSlashLine(line: string): { cmd: string; args: string; raw: string } | null {
  const t = line.trim()
  if (!t.startsWith('/')) return null
  const m = t.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/)
  if (!m) return { cmd: '', args: '', raw: t }
  return { cmd: m[1], args: (m[2] || '').trim(), raw: t }
}
