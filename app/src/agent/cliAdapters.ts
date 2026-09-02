export type CliAdapterId = 'codex' | 'claude' | 'gemini' | 'cursor'
export type CliApprovalMode = 'always' | 'auto' | 'full'

export type AdapterDiagnostics = {
  id: CliAdapterId
  binary: string
  found: boolean
  path: string | null
  auth: 'unknown' | 'cli-login' | 'subscription' | 'provider-config'
  note: string
}

export type RunnerInput = {
  binary?: string
  prompt: string
  model?: string
  depth?: string
  agentMode?: string
  approvalMode?: CliApprovalMode
  unattended?: boolean
}

export type SpawnSpec = {
  file: string
  args: string[]
  displayCommand: string
}

export type RunnerEvent = {
  kind: 'text' | 'thought' | 'tool' | 'error' | 'done' | 'status'
  text?: string
  tool?: string
  raw?: unknown
}

export type CliAdapterDefinition = {
  id: CliAdapterId
  displayName: string
  binaryCandidates: string[]
  credentialMode: 'env' | 'subscription' | 'cli-login' | 'provider-config'
  promptTransport: 'stdin' | 'argv' | 'file'
  streamFormat: 'jsonl' | 'text' | 'provider-json'
  supports: {
    resume: boolean
    images: boolean
    mcp: boolean
    sandbox: 'none' | 'cli-native' | 'subagents-gated'
  }
  discover: () => Promise<AdapterDiagnostics>
  buildInvocation: (input: RunnerInput) => SpawnSpec
  parseEvent: (line: string) => RunnerEvent | null
}

function quote(value: string): string {
  return /[^A-Za-z0-9_./:@%+=,-]/.test(value) ? `'${value.replaceAll("'", "'\\''")}'` : value
}

function parseJsonEvent(line: string, textKeys: string[]): RunnerEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const raw = JSON.parse(trimmed) as Record<string, unknown>
    const type = String(raw.type || raw.event || '').toLowerCase()
    const text = textKeys
      .map((key) => raw[key])
      .concat([
        (raw.message as Record<string, unknown> | undefined)?.content,
        (raw.item as Record<string, unknown> | undefined)?.text,
        (raw.data as Record<string, unknown> | undefined)?.text,
      ])
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    if (type.includes('error') || raw.error) return { kind: 'error', text: text || String(raw.error || 'CLI error'), raw }
    if (type.includes('tool') || type.includes('command')) return { kind: 'tool', text, tool: String(raw.name || raw.tool || ''), raw }
    if (type.includes('thought') || type.includes('reason')) return { kind: 'thought', text, raw }
    if (type.includes('done') || type.includes('result') || type.includes('complete')) return { kind: 'done', text, raw }
    return text ? { kind: 'text', text, raw } : { kind: 'status', raw }
  } catch {
    return { kind: 'text', text: trimmed }
  }
}

function adapterDiscovery(id: CliAdapterId, displayName: string, binary: string, auth: AdapterDiagnostics['auth']): Promise<AdapterDiagnostics> {
  return (async () => {
    const result = window.subagents?.cli?.which ? await window.subagents.cli.which(binary) : { found: false, path: null }
    return {
      id,
      binary,
      found: Boolean(result.found),
      path: result.path || null,
      auth,
      note: result.found ? `${displayName} binary 已找到；登入狀態由 CLI 自己管理。` : `未找到 ${binary}，未執行任何安裝。`,
    }
  })()
}

const definitions: CliAdapterDefinition[] = [
  {
    id: 'codex', displayName: 'Codex CLI', binaryCandidates: ['codex'], credentialMode: 'cli-login', promptTransport: 'argv', streamFormat: 'jsonl',
    supports: { resume: true, images: true, mcp: true, sandbox: 'cli-native' },
    discover: () => adapterDiscovery('codex', 'Codex CLI', 'codex', 'cli-login'),
    buildInvocation: (input) => {
      const file = input.binary || 'codex'
      const args = ['exec', '--json', '--color', 'never', '--skip-git-repo-check']
      if (input.agentMode === 'plan') args.push('-s', 'read-only')
      else args.push('-s', 'workspace-write')
      if (input.model) args.push('-m', input.model)
      args.push(input.prompt)
      return { file, args, displayCommand: [file, ...args].map(quote).join(' ') }
    },
    parseEvent: (line) => parseJsonEvent(line, ['text', 'delta', 'content']),
  },
  {
    id: 'claude', displayName: 'Claude Code', binaryCandidates: ['claude', 'claude-code'], credentialMode: 'subscription', promptTransport: 'argv', streamFormat: 'jsonl',
    supports: { resume: true, images: true, mcp: true, sandbox: 'cli-native' },
    discover: async () => {
      const first = await adapterDiscovery('claude', 'Claude Code', 'claude', 'subscription')
      return first.found ? first : adapterDiscovery('claude', 'Claude Code', 'claude-code', 'subscription')
    },
    buildInvocation: (input) => {
      const file = input.binary || 'claude'
      const args = ['-p', '--output-format', 'stream-json', '--verbose']
      if (input.model) args.push('--model', input.model)
      if (input.agentMode === 'plan') args.push('--permission-mode', 'plan')
      else args.push('--permission-mode', 'acceptEdits')
      args.push(input.prompt)
      return { file, args, displayCommand: [file, ...args].map(quote).join(' ') }
    },
    parseEvent: (line) => parseJsonEvent(line, ['text', 'delta', 'content']),
  },
  {
    id: 'gemini', displayName: 'Gemini CLI', binaryCandidates: ['gemini'], credentialMode: 'cli-login', promptTransport: 'argv', streamFormat: 'provider-json',
    supports: { resume: false, images: true, mcp: true, sandbox: 'cli-native' },
    discover: () => adapterDiscovery('gemini', 'Gemini CLI', 'gemini', 'cli-login'),
    buildInvocation: (input) => {
      const file = input.binary || 'gemini'
      const args = ['-p', input.prompt, '--output-format', 'json']
      if (input.model) args.push('--model', input.model)
      return { file, args, displayCommand: [file, ...args].map(quote).join(' ') }
    },
    parseEvent: (line) => parseJsonEvent(line, ['text', 'response', 'content', 'delta']),
  },
  {
    id: 'cursor', displayName: 'Cursor Agent', binaryCandidates: ['cursor-agent', 'agent'], credentialMode: 'subscription', promptTransport: 'argv', streamFormat: 'jsonl',
    supports: { resume: false, images: true, mcp: false, sandbox: 'cli-native' },
    discover: async () => {
      const first = await adapterDiscovery('cursor', 'Cursor Agent', 'cursor-agent', 'subscription')
      return first.found ? first : adapterDiscovery('cursor', 'Cursor Agent', 'agent', 'subscription')
    },
    buildInvocation: (input) => {
      const file = input.binary || 'cursor-agent'
      const args = ['-p', '--output-format', 'stream-json']
      if (input.model) args.push('--model', input.model)
      args.push(input.prompt)
      return { file, args, displayCommand: [file, ...args].map(quote).join(' ') }
    },
    parseEvent: (line) => parseJsonEvent(line, ['text', 'delta', 'content']),
  },
]

export const CLI_ADAPTERS: readonly CliAdapterDefinition[] = definitions

export const DISCOVERY_ONLY_AGENT_ADAPTERS = [
  { id: 'github-copilot', displayName: 'GitHub Copilot CLI', status: 'discovery-only' as const },
  { id: 'qwen-code', displayName: 'Qwen Code', status: 'discovery-only' as const },
  { id: 'kimi-cli', displayName: 'Kimi CLI', status: 'discovery-only' as const },
  { id: 'aider', displayName: 'Aider', status: 'discovery-only' as const },
  { id: 'pi', displayName: 'Pi', status: 'discovery-only' as const },
  { id: 'mistral-vibe', displayName: 'Mistral Vibe', status: 'discovery-only' as const },
  { id: 'trae', displayName: 'Trae', status: 'discovery-only' as const },
  { id: 'kilo', displayName: 'Kilo', status: 'discovery-only' as const },
  { id: 'qoder', displayName: 'Qoder', status: 'discovery-only' as const },
  { id: 'kiro', displayName: 'Kiro', status: 'discovery-only' as const },
  { id: 'devin', displayName: 'Devin', status: 'discovery-only' as const },
  { id: 'antigravity', displayName: 'Antigravity', status: 'discovery-only' as const },
  { id: 'deepseek', displayName: 'DeepSeek CLI', status: 'discovery-only' as const },
  { id: 'grok-build', displayName: 'Grok Build', status: 'discovery-only' as const },
  { id: 'hermes', displayName: 'Hermes', status: 'discovery-only' as const },
] as const
