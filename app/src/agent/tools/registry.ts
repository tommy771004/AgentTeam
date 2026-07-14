/**
 * Agent tool catalog — deterministic routing by step keywords.
 * Actual I/O goes through Electron IPC when available.
 */

export type ToolName =
  | 'web_search'
  | 'http_fetch'
  | 'workspace_list'
  | 'workspace_read'
  | 'workspace_diff'
  | 'workspace_write'
  | 'workspace_download'
  | 'workspace_mkdir'
  | 'workspace_move'
  | 'workspace_delete'
  | 'table_parse'
  | 'bash'
  | 'datetime_now'
  | 'memory_set'
  | 'memory_get'
  | 'memory_append'
  | 'memory_search'
  | 'skill_list'
  | 'skill_load'
  | 'skill_save'
  | 'mcp_list_tools'
  | 'mcp_call'
  | 'delegate_task'
  | 'delegate_status'
  | 'message_send'
  | 'json_extract_lite'
  | 'update_plan'
  | 'ask_user'
  | 'codegraph_explore'
  | 'codegraph_status'
  | 'codegraph_impact'
  | 'codegraph_callers'
  | 'design_brief_update'
  | 'design_direction_select'
  | 'design_system_list'
  | 'design_system_read'
  | 'design_system_create'
  | 'design_system_update'
  | 'design_artifact_register'
  | 'design_artifact_patch'
  | 'design_artifact_tweak'
  | 'design_artifact_capture'
  | 'design_artifact_lint'
  | 'design_critique_note'
  | 'design_critique'
  | 'design_artifact_export'

export interface ToolDef {
  name: ToolName
  description: string
  keywords: string[]
}

export const TOOL_CATALOG: ToolDef[] = [
  {
    name: 'web_search',
    description: 'Search the web / Wikipedia for facts and sources',
    keywords: ['search', 'find', 'research', 'compare', 'look up', 'web', 'market', 'competitor', 'software', 'tools', 'price'],
  },
  {
    name: 'http_fetch',
    description: 'Fetch a public HTTP(S) URL as text',
    keywords: ['fetch', 'http', 'url', 'download', 'endpoint', 'api'],
  },
  {
    name: 'workspace_list',
    description: 'List files in the sandboxed workspace',
    keywords: ['list files', 'workspace', 'directory', 'ls', 'ingest'],
  },
  {
    name: 'workspace_read',
    description: 'Read a file from the sandboxed workspace',
    keywords: ['read file', 'open file', 'load', 'ingest', 'parse'],
  },
  {
    name: 'workspace_diff',
    description: 'Read the current Git working-tree diff for selected workspace files.',
    keywords: ['diff', 'review changes', 'patch', 'working tree', 'changed files'],
  },
  {
    name: 'workspace_write',
    description: 'Write a file into the sandboxed workspace',
    keywords: ['write file', 'save', 'export', 'report', 'deliver', 'output'],
  },
  { name: 'workspace_download', description: 'Download an HTTP(S) URL to the sandboxed workspace', keywords: ['download file', 'save url', 'url to workspace'] },
  { name: 'workspace_mkdir', description: 'Create a directory in the sandboxed workspace', keywords: ['mkdir', 'create directory', 'folder'] },
  { name: 'workspace_move', description: 'Move or rename a workspace file or directory', keywords: ['move file', 'rename file', 'rename directory'] },
  { name: 'workspace_delete', description: 'Delete a workspace file or directory', keywords: ['delete file', 'remove file', 'delete directory'] },
  { name: 'table_parse', description: 'Parse CSV or TSV text into structured rows', keywords: ['csv', 'tsv', 'table', 'spreadsheet', 'parse rows'] },
  {
    name: 'bash',
    description: 'Run a shell command in Electron (bash / cmd)',
    keywords: ['bash', 'shell', 'command', 'terminal', 'exec', 'run script', 'git', 'npm'],
  },
  {
    name: 'codegraph_explore',
    description:
      'Query local CodeGraph index for symbols/call paths (surgical code context). Requires codegraph CLI + project init.',
    keywords: [
      'codegraph',
      'call graph',
      'callers',
      'callees',
      'impact',
      'symbol',
      'architecture',
      'how does',
      'code structure',
      'blast radius',
      'dependency',
    ],
  },
  {
    name: 'codegraph_status',
    description: 'Check whether CodeGraph CLI is installed and project is indexed',
    keywords: ['codegraph status', 'index status', 'code index'],
  },
  {
    name: 'codegraph_impact',
    description: 'Blast radius: what is affected if symbol changes (CodeGraph impact)',
    keywords: ['impact', 'blast radius', 'affected', 'breaking change', 'ripple'],
  },
  {
    name: 'codegraph_callers',
    description: 'Find callers of a symbol via CodeGraph',
    keywords: ['callers', 'who calls', 'references', 'usages'],
  },
  {
    name: 'datetime_now',
    description: 'Get current local datetime',
    keywords: ['schedule', 'time', 'daily', 'cron', 'timestamp', 'clock'],
  },
  {
    name: 'memory_set',
    description: 'Store a key/value in session memory',
    keywords: ['remember', 'store', 'memory', 'cache'],
  },
  {
    name: 'memory_get',
    description: 'Read a key from session memory',
    keywords: ['recall', 'memory', 'retrieve', 'context'],
  },
  {
    name: 'memory_append',
    description: 'Append a durable memory entry (Hermes-style)',
    keywords: ['remember', 'prefer', 'lesson', 'note', 'save memory'],
  },
  {
    name: 'memory_search',
    description: 'Search persistent memory entries',
    keywords: ['recall', 'search memory', 'past', 'preference'],
  },
  {
    name: 'skill_list',
    description: 'List available skills (procedural memory)',
    keywords: ['skill', 'skills', 'procedure', 'playbook'],
  },
  {
    name: 'skill_load',
    description: 'Load full SKILL.md content by name',
    keywords: ['skill', 'load skill', 'playbook', 'procedure'],
  },
  {
    name: 'skill_save',
    description: 'Save or update a skill document',
    keywords: ['save skill', 'create skill', 'write skill'],
  },
  {
    name: 'mcp_list_tools',
    description: 'List tools from configured MCP servers',
    keywords: ['mcp', 'list tools', 'external tool'],
  },
  {
    name: 'mcp_call',
    description: 'Call a tool on an MCP server',
    keywords: ['mcp', 'call tool', 'external'],
  },
  {
    name: 'delegate_task',
    description: 'Spawn isolated leaf subagent with separate context (supports background + notify)',
    keywords: ['delegate', 'subagent', 'parallel', 'spawn', 'isolate', 'background'],
  },
  {
    name: 'delegate_status',
    description: 'List or query background delegate jobs',
    keywords: ['delegate', 'status', 'background', 'job', 'notify'],
  },
  {
    name: 'message_send',
    description: 'Send a message via messaging gateway (Telegram etc.)',
    keywords: ['telegram', 'message', 'send', 'reply', 'gateway', 'chat'],
  },
  {
    name: 'json_extract_lite',
    description: 'json_extract_lite: simple title/items/summary heuristic, not arbitrary schema extraction',
    keywords: ['extract', 'json', 'schema', 'structure', 'parse'],
  },
  {
    name: 'update_plan',
    description: 'Update the current task plan with ordered items and statuses. Use for multi-step work.',
    keywords: ['update plan', 'task list', 'todo list', 'execution plan', 'plan steps'],
  },
  {
    name: 'ask_user',
    description: 'Ask the user a structured question with optional choices before continuing.',
    keywords: ['ask user', 'need clarification', 'clarify', 'choose', 'preference', 'question'],
  },
  {
    name: 'design_brief_update',
    description: 'Update the linked SubDesign brief metadata, direction cards, or stage.',
    keywords: ['subdesign', 'design brief', 'design brief update', 'audience', 'constraints', 'acceptance criteria', 'direction cards'],
  },
  {
    name: 'design_direction_select',
    description: 'Record the user-selected SubDesign direction and unlock Build stage.',
    keywords: ['design direction', 'select direction', 'direction selected', 'choose direction', 'design choice'],
  },
  {
    name: 'design_system_list',
    description: 'List project DESIGN.md and SubDesign design systems.',
    keywords: ['design system list', 'design systems', 'design.md', 'brand rules', 'tokens'],
  },
  {
    name: 'design_system_read',
    description: 'Read a selected DESIGN.md design system and return its parsed summary.',
    keywords: ['read design system', 'read design.md', 'design tokens', 'brand system'],
  },
  {
    name: 'design_system_create',
    description: 'Create a versioned SubDesign DESIGN.md under the project workspace.',
    keywords: ['create design system', 'new design system', 'write design.md', 'brand contract'],
  },
  {
    name: 'design_system_update',
    description: 'Update a versioned SubDesign DESIGN.md under the project workspace.',
    keywords: ['update design system', 'update design.md', 'edit brand rules', 'write tokens'],
  },
  {
    name: 'design_artifact_register',
    description: 'Register a validated project-relative SubDesign artifact manifest for preview and revision tracking.',
    keywords: ['artifact manifest', 'register artifact', 'preview artifact', 'design output', 'revision'],
  },
  {
    name: 'design_artifact_patch',
    description: 'Apply a bounded in-place text patch to an already registered SubDesign artifact file.',
    keywords: ['artifact patch', 'tweak artifact', 'edit artifact', 'in place', '原地調整', '微調'],
  },
  {
    name: 'design_artifact_tweak',
    description: 'Apply one declared structured live-control tweak to an already registered artifact.',
    keywords: ['artifact tweak', 'structured tweak', 'live tweak', 'parameter', 'color control', '即時調參'],
  },
  {
    name: 'design_artifact_capture',
    description: 'Capture a sandboxed screenshot or DOM snapshot for a registered SubDesign artifact.',
    keywords: ['artifact screenshot', 'capture artifact', 'DOM evidence', 'screenshot evidence', '截圖', '證據'],
  },
  {
    name: 'design_artifact_lint',
    description: 'Run deterministic semantic lint against the registered artifact and create attested lint evidence.',
    keywords: ['artifact lint', 'semantic lint', 'accessibility lint', 'evidence lint', '語意檢查'],
  },
  {
    name: 'design_critique_note',
    description: 'Record one panelist-focused critique note (visual/brand, accessibility, or implementation readiness) during a Critique Theater round.',
    keywords: ['critique panelist', 'critique round', 'panelist note', 'visual review', 'accessibility review', 'implementation readiness', 'cross-check'],
  },
  {
    name: 'design_critique',
    description: 'Record a structured read-only critique for a SubDesign artifact.',
    keywords: ['design critique', 'critique artifact', 'accessibility review', 'brand conformance', 'brief coverage', 'verdict'],
  },
  {
    name: 'design_artifact_export',
    description: 'Export a validated SubDesign artifact as HTML, PDF, PPTX, MP4, or ZIP after user approval.',
    keywords: ['export artifact', 'export design', 'download prototype', 'pdf', 'pptx', 'mp4', 'zip', 'deliver artifact'],
  },
]

/** Pick tools relevant to a step description + objective. */
export function selectToolsForStep(
  description: string,
  objective: string,
  action: string,
  opts?: { webSearchEnabled?: boolean },
): ToolName[] {
  const hay = `${description} ${objective} ${action}`.toLowerCase()
  const picks: ToolName[] = []

  for (const tool of TOOL_CATALOG) {
    if (tool.name === 'web_search' && opts?.webSearchEnabled === false) continue
    if (tool.keywords.some((k) => hay.includes(k))) {
      picks.push(tool.name)
    }
  }

  // Always give datetime for time-based-ish wording
  if (/\b(every|daily|schedule|cron|08:00)\b/i.test(hay) && !picks.includes('datetime_now')) {
    picks.unshift('datetime_now')
  }

  // Cap to avoid noisy steps
  const unique = [...new Set(picks)]
  if (unique.length === 0) {
    // default lightweight tools
    return ['datetime_now']
  }
  return unique.slice(0, 3)
}

export function buildToolInput(
  tool: ToolName,
  objective: string,
  stepDescription: string,
  priorOutputs: string[],
): Record<string, unknown> {
  const query = extractQuery(objective, stepDescription)

  switch (tool) {
    case 'web_search':
      return { query, limit: 5 }
    case 'http_fetch': {
      const url = extractUrl(`${objective} ${stepDescription} ${priorOutputs.join(' ')}`)
      return { url: url || 'https://example.com', maxChars: 4000 }
    }
    case 'workspace_list':
      return { path: '.' }
    case 'workspace_read':
      return { path: guessFilename(objective, 'input') }
    case 'workspace_diff':
      return { paths: [] }
    case 'workspace_write':
      return {
        path: guessFilename(objective, 'report'),
        content: priorOutputs.slice(-1)[0] || `# ${objective}\n\n(pending synthesis)\n`,
      }
    case 'workspace_download':
      return { url: extractUrl(`${objective} ${stepDescription}`) || '', path: guessFilename(objective, 'input') }
    case 'workspace_mkdir':
      return { path: 'outputs' }
    case 'workspace_move':
      return { from: '', to: '' }
    case 'workspace_delete':
      return { path: '' }
    case 'table_parse':
      return { text: priorOutputs.slice(-1)[0] || objective, delimiter: 'auto' }
    case 'bash':
      return {
        command:
          typeof navigator !== 'undefined' && /win/i.test(navigator.platform)
            ? 'cd && dir'
            : 'pwd && ls -la',
        timeoutMs: 30_000,
      }
    case 'datetime_now':
      return { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }
    case 'memory_set':
      return { key: 'last_objective', value: objective }
    case 'memory_get':
      return { key: 'last_objective' }
    case 'memory_append':
      return { text: priorOutputs.slice(-1)[0]?.slice(0, 400) || objective.slice(0, 200) }
    case 'memory_search':
      return { query: extractQuery(objective, stepDescription) }
    case 'skill_list':
      return {}
    case 'skill_load': {
      const match = skillsHintName(objective, stepDescription)
      return { name: match }
    }
    case 'skill_save':
      return {
        name: `skill-${Date.now().toString(36)}`,
        description: objective.slice(0, 60),
        body: priorOutputs.slice(-1)[0] || `# Skill\n\n${objective}`,
      }
    case 'mcp_list_tools':
      return {}
    case 'mcp_call':
      return {
        serverId: '',
        toolName: '',
        arguments: {},
      }
    case 'delegate_task':
      return {
        goal: stepDescription || objective,
        context: priorOutputs.slice(-1)[0]?.slice(0, 500) || '',
        role: 'leaf',
        background: false,
        notify_on_complete: true,
      }
    case 'delegate_status':
      return {}
    case 'message_send':
      return {
        channel: 'telegram',
        chatId: '',
        text: priorOutputs.slice(-1)[0]?.slice(0, 500) || objective.slice(0, 200),
      }
    case 'json_extract_lite':
      return { text: priorOutputs.slice(-1)[0] || objective, fields: ['title', 'items', 'summary'] }
    case 'update_plan':
      return { todos: [{ text: stepDescription || objective, status: 'active' }] }
    case 'ask_user':
      return {
        question: stepDescription || objective,
        options: [],
        allowFreeform: true,
      }
    default:
      return {}
  }
}

function extractQuery(objective: string, step: string): string {
  // Prefer shorter step-focused query
  const base = step.length < 80 ? `${step} ${objective}` : objective
  return base.replace(/[^\w\s\-.:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)
}

function extractUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s)"']+/)
  return m ? m[0] : null
}

function guessFilename(objective: string, kind: 'report' | 'input'): string {
  const slug = objective
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40)
  return kind === 'report' ? `reports/${slug || 'output'}.md` : `inputs/${slug || 'notes'}.md`
}

function skillsHintName(objective: string, step: string): string {
  const hay = `${objective} ${step}`.toLowerCase()
  if (/export|credential|sensitive|dump/.test(hay)) return 'safe-export'
  if (/search|research|price|compare|find/.test(hay)) return 'web-research'
  return 'web-research'
}
