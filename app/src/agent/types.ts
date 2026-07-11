/** Loop patterns from 02_Execution_Rules */
export type LoopType = 'Turn-based' | 'Goal-based' | 'Time-based' | 'Proactive'

export type StepStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'SKIPPED'

export type ExecutionStatus =
  | 'idle'
  | 'parsing'
  | 'running'
  | 'awaiting_user'
  | 'success'
  | 'failed'
  | 'halted'
  | 'manual_intervention'

export type LogLevel =
  | 'INFO'
  | 'PROCESS'
  | 'EXEC'
  | 'EVAL'
  | 'SUCCESS'
  | 'WARN'
  | 'ERROR'
  | 'DEBUG'
  | 'AWAIT'
  | 'HALT'
  | 'THOUGHT'
  | 'ACTION'
  | 'FATAL'
  | 'System'

/** Where the model id on a step/sub-agent came from */
export type ModelSource = 'role' | 'fallback' | 'cli' | 'sim' | 'none'

export interface ExecutionStep {
  step: number
  action: string
  description: string
  status: StepStatus
  durationMs?: number
  result?: string
  assignedAgent?: string
  /** Actual model id used for this step (role / fallback / CLI) */
  modelUsed?: string
  modelSource?: ModelSource
}

export interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  message: string
}

export interface LoopConfiguration {
  loopType: LoopType
  trigger: string
  executionSequence: string[]
  definitionOfDone: string
  maxIterations: number
  fallbackProtocol: string
  nextState: 'Halt' | 'Await User Input' | 'Trigger Webhook'
}

export type EntityKind =
  | 'ORG'
  | 'METRIC'
  | 'PROJECT'
  | 'PERSON'
  | 'CONCEPT'
  | 'TOOL'
  /** CodeGraph symbol (fn/class/method) */
  | 'SYMBOL'
  /** Source file path from code index */
  | 'FILE'

export interface KnowledgeEntity {
  id: string
  name: string
  kind: EntityKind
  mentions: number
  confidence: number
}

export interface KnowledgeEdge {
  from: string
  to: string
  label: string
}

export type KnowledgeSource = 'task' | 'codegraph' | 'merged'

export interface KnowledgeGraph {
  entities: KnowledgeEntity[]
  edges: KnowledgeEdge[]
  phase: string
  /** Origin of this snapshot */
  source?: KnowledgeSource
}

export interface SafetyCheck {
  ok: boolean
  constraint: string
  reason: string
  recommendation: string
  payload: Record<string, unknown>
  evaluations: Array<{
    name: string
    passed: boolean
    detail: string
  }>
}

export interface InterventionState {
  active: boolean
  reason: string
  payloadJson: string
  safety: SafetyCheck | null
  timeoutSec: number
}

/** OpenCode-style permission action */
export type PermissionAction = 'allow' | 'ask' | 'deny'

/** ChatGPT-style「動作應如何核准」三段模式 */
export type ApprovalMode = 'always' | 'auto' | 'full'

export type PermissionKey =
  | 'read'
  | 'edit'
  | 'web'
  | 'memory'
  | 'skill'
  | 'mcp'
  | 'task'
  | 'delegate'

export type PermissionPolicy = Partial<Record<PermissionKey, PermissionAction>>

/** OpenCode primary agent modes */
export type AgentMode = 'build' | 'plan'

/** OpenCode subagent ids */
export type SubagentId = 'general' | 'explore'

export interface RuntimeOverrides {
  maxIterations?: number
  /** Override FC tool rounds for this run */
  maxToolRounds?: number
  minConfidence?: number
  timeoutMs?: number
  useLlm?: boolean
  /** Per-conversation model override (does not change global settings permanently) */
  model?: string
  /** Inject skill bodies into prompt (cron / manual) */
  attachedSkills?: string[]
  /** Extra system context (e.g. MCP notes) */
  extraSystemContext?: string
  /** OpenCode-style primary agent */
  agentMode?: AgentMode
  /** OpenCode-style subagent */
  subagentId?: SubagentId
  /** Permission policy for tools */
  permissionPolicy?: PermissionPolicy
  /** Hard-blocked tool names (merged with policy deny) */
  blockedTools?: string[]
  /**
   * Event already matched in schedule/webhook/telegram layer —
   * skip engine Proactive when/if string re-check.
   */
  eventPreMatched?: boolean
  /** Per-run temporary chat (no memory read/write); falls back to settings */
  temporary?: boolean
  /**
   * Unattended run (scheduler / webhook / telegram).
   * HITL ask & safety intervention auto-deny on timeout so the global run lock cannot hang overnight.
   */
  unattended?: boolean
  /** Override HITL timeout (ms). Default: interactive 90s · unattended 45s */
  hitlTimeoutMs?: number
  /**
   * Preload deferred capability ids at start of each step
   * (thread resume / cross-run restore — Pydantic-style history state).
   */
  preloadCapabilityIds?: string[]
  /** Restore tool_search unlocked tool names across steps / runs */
  preloadUnlockedTools?: string[]
}

export interface ToolCallRecord {
  id: string
  tool: string
  input: Record<string, unknown>
  output: string
  ok: boolean
  durationMs: number
  timestamp: string
  step?: number
}

export interface AgentState {
  id: string
  objective: string
  loopConfig: LoopConfiguration
  status: ExecutionStatus
  currentIteration: number
  steps: ExecutionStep[]
  logs: LogEntry[]
  confidence: number
  progress: number
  startedAt: string | null
  finishedAt: string | null
  haltReason?: string
  result?: string
  reportTitle?: string
  subAgents: SubAgentNode[]
  knowledge: KnowledgeGraph
  intervention: InterventionState
  tokensUsed: number
  minConfidence: number
  toolCalls: ToolCallRecord[]
  /**
   * Capability ids active this run (always-on + load_capability).
   * Progressive disclosure surface for UI / audit.
   */
  loadedCapabilityIds: string[]
  /** tool_search unlocked tool names (for cross-step / cross-run restore) */
  unlockedToolNames: string[]
  violation: SupervisorViolationState | null
  metrics: {
    vramLabel: string
    apiCredits: number
    executionMs: number
  }
}

export interface SubAgentNode {
  id: string
  name: string
  role: string
  status: 'idle' | 'active' | 'done' | 'error'
  lastMessage?: string
  /** Resolved model for this role at spawn / last step */
  model?: string
  modelSource?: ModelSource
}

export interface ArchiveRecord {
  id: string
  status: 'success' | 'failed' | 'warning' | 'running' | 'halted'
  objective: string
  loopType: string
  confidence: number | null
  timestamp: string
  iterations: number
  maxIterations: number
  steps: ExecutionStep[]
  logs: LogEntry[]
  result?: string
  knowledge?: KnowledgeGraph
  /** Audit: tool calls (incl. load_capability / run_code) */
  toolCalls?: ToolCallRecord[]
  /** Audit: capabilities loaded this run */
  loadedCapabilityIds?: string[]
  tokensUsed?: number
  /** HITL decisions during this run (allow / deny / timed-out) */
  hitl?: {
    allowed: number
    denied: number
    timedOut: number
    toolsTimedOut?: string[]
  }
}

export interface ParseResult {
  config: LoopConfiguration
  objective: string
  steps: ExecutionStep[]
}

export type AgentRoleKey = 'orchestrator' | 'analyst' | 'synthesizer' | 'executor'

export interface RoleModelConfig {
  orchestrator: string
  analyst: string
  synthesizer: string
  executor: string
}

/** CLI / 廠商授權（動態模型來源） */
export type CliKind =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'opencode'
  | 'cursor'
  | 'codex'
  | 'grok'
  | 'custom'

export interface CliModelOption {
  id: string
  label: string
  depths?: Array<'fast' | 'standard' | 'deep' | 'max' | 'ultra'>
}

export interface CliProviderConfig {
  id: string
  kind: CliKind
  name: string
  enabled: boolean
  authorized: boolean
  apiKey?: string
  baseUrl?: string
  cliBinary?: string
  models: CliModelOption[]
}

/** ChatGPT-style personality presets (non-account personalization) */
export type PersonalityPreset =
  | 'default'
  | 'friendly'
  | 'efficient'
  | 'professional'
  | 'candid'
  | 'quirky'
  | 'none'

export type ThemePreference = 'system' | 'dark' | 'light'
export type ReducedMotionPreference = 'system' | 'on' | 'off'
/** Enter sends vs ⌘/Ctrl+Enter sends (ChatGPT enterBehavior) */
export type EnterBehavior = 'enter' | 'cmdEnter'
/** Follow-up while agent is running: interrupt/steer vs queue */
export type FollowUpMode = 'steer' | 'queue'

export interface LlmSettings {
  enabled: boolean
  baseUrl: string
  apiKey: string
  model: string
  /** Model ids returned by the configured OpenAI-compatible /models endpoint. */
  discoveredModels: string[]
  /** Per-role model overrides (empty string = fall back to `model`) */
  roleModels: RoleModelConfig
  authLevel: number
  minConfidence: number
  maxIterationsDefault: number
  safetyEnabled: boolean
  toolsEnabled: boolean
  webSearchEnabled: boolean
  /** Use OpenAI function-calling multi-round tool loop when LLM is on */
  functionCalling: boolean
  /** Halt loop if tool payload exceeds maxToolPayloadKb (else truncate) */
  haltOnPayloadOverflow: boolean
  maxToolPayloadKb: number
  maxToolRounds: number
  /** Local webhook receiver for Proactive events */
  webhookEnabled: boolean
  webhookPort: number
  webhookToken: string
  /** Declarative edge tools. Secrets are referenced by key, never embedded here. */
  customTools: CustomToolDefinition[]
  /** Values used by {{secret:key}} template references; redacted on export. */
  customToolSecrets: Record<string, string>
  /** MCP servers (minimal client) */
  mcpServers: McpServerConfig[]
  mcpEnabled: boolean
  /** Messaging gateway (Phase 5 — Telegram etc.) */
  telegramEnabled: boolean
  telegramBotToken: string
  /** Comma-separated allowed chat IDs; empty = allow all */
  telegramAllowedChatIds: string
  /** Auto-run agent when inbound message received */
  telegramAutoRun: boolean
  /** Reply to chat with agent final summary */
  telegramReplyWithResult: boolean
  /** 各家 CLI / API 授權與模型目錄 */
  cliProviders: CliProviderConfig[]
  /** bash 預設是否需 HITL ask（安全開啟時建議 true；approvalMode=auto 時的細部開關） */
  bashRequireAsk: boolean
  /**
   * ChatGPT-style approval mode (動作應如何核准):
   * - 'always': 要求核准 — 一律先詢問編輯檔案 / 使用網路等副作用工具
   * - 'auto':   代我核准 — 僅對偵測為可能不安全的操作要求核准（既有行為）
   * - 'full':   完整存取權 — 跳過 HITL ask 與 safety intervention（deny 規則仍生效）
   */
  approvalMode: ApprovalMode
  /**
   * Capability progressive disclosure (Pydantic AI 2.0–style).
   * When true, FC only exposes a catalog + load_capability until the model loads a bundle.
   */
  capabilitiesEnabled: boolean
  /** Capability ids forced always-on even if normally deferred */
  alwaysOnCapabilities: string[]
  /**
   * Tool Search (Pydantic AI 2.0 style): when visible tool schemas exceed the
   * threshold, hide non-core ones and let the model retrieve by keyword.
   */
  toolSearchEnabled: boolean
  /** Hide tool schemas beyond this count (min 4) */
  toolSearchThreshold: number
  /** CodeMode: run_code capability — model-written JS batches tool calls in one round */
  codeModeEnabled: boolean

  /* ── ChatGPT app–style preferences (exclude account/login) ── */

  /** General · Theme */
  theme: ThemePreference
  /** Appearance · Reduce motion */
  reducedMotion: ReducedMotionPreference
  /** Appearance · UI base font size (px) */
  uiFontSize: number
  /** Appearance · Code base font size (px) */
  codeFontSize: number
  /** Appearance · translucent / glass sidebar */
  translucentSidebar: boolean
  /** General · Send shortcut */
  enterBehavior: EnterBehavior
  /** General · Follow-up while running */
  followUpMode: FollowUpMode
  /** General · Desktop notification when a run finishes */
  notifyOnComplete: boolean
  /** General · Soft sound on complete (where supported) */
  soundOnComplete: boolean
  /** General · Keep system awake while agent runs (best-effort) */
  preventSleepWhileRunning: boolean
  /** Personalization · Suggested / ambient prompts on empty chat */
  ambientSuggestions: boolean
  /** Personalization · Personality preset */
  personality: PersonalityPreset
  /** Personalization · Custom instructions: about the user */
  customAboutUser: string
  /** Personalization · Custom instructions: preferred response style */
  customResponseStyle: string
  /** Memory · Carry context from past chats / memory store */
  memoryEnabled: boolean
  /** Memory · Allow writing new memories from tool-assisted runs */
  memoryWriteEnabled: boolean
  /** Memory · Include recent conversation history in prompts when available */
  referenceChatHistory: boolean
  /** Data controls · Prefer temporary (non-memory) chats by default */
  temporaryChatDefault: boolean
  /** Data controls · Auto-archive finished chats older than N days (0 = off) */
  autoArchiveDays: number
  /** Git · Branch prefix when agent creates branches */
  gitBranchPrefix: string
  /** Git · Commit message guidance injected into prompts */
  gitCommitInstructions: string
  /** Git · PR title/body guidance */
  gitPrInstructions: string
  /** Git · Prefer draft PRs */
  gitCreateDraftPr: boolean
  /** Git · Prefer force-with-lease push */
  gitForcePush: boolean
}

export interface SupervisorViolationState {
  code: string
  detail: string
  exitCode: number
  tool?: string
  stackTrace: string[]
}

/** Time-based / cron-style scheduled job */
export type ScheduleKind = 'interval' | 'daily' | 'once'

export interface ScheduledJob {
  id: string
  name: string
  objective: string
  loopType: LoopType
  enabled: boolean
  kind: ScheduleKind
  /** interval minutes (kind=interval) */
  intervalMinutes?: number
  /** HH:mm local (kind=daily) */
  dailyAt?: string
  /** ISO timestamp (kind=once) */
  runAt?: string
  /** Hermes-style: skills attached to this cron job */
  skillNames?: string[]
  lastRunAt: string | null
  nextRunAt: string | null
  lastStatus: 'idle' | 'running' | 'success' | 'failed' | 'skipped'
  createdAt: string
}

/** Minimal MCP server config (Hermes-style extension edge) */
export interface McpServerConfig {
  id: string
  name: string
  enabled: boolean
  /** http JSON-RPC endpoint, e.g. http://127.0.0.1:3100/mcp */
  transport: 'http' | 'stdio'
  url?: string
  /** stdio: command + args */
  command?: string
  args?: string[]
  /** Optional bearer token for HTTP */
  authToken?: string
}

export type CustomToolKind = 'http_template' | 'bash_template'

/** JSON-safe schema for user/plugin supplied declarative tools. */
export interface CustomToolDefinition {
  /** Stable, function-call-safe id (letters, numbers, _ and -). */
  name: string
  description: string
  kind: CustomToolKind
  template: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    url?: string
    headers?: Record<string, string>
    body?: string
    /** bash_template only */
    command?: string
  }
  params?: Record<string, {
    type?: 'string' | 'number' | 'integer' | 'boolean'
    description?: string
    required?: boolean
  }>
  /** HTTP tools may opt into approval; bash templates always require it. */
  requiresApproval?: boolean
  /** Plugin id when supplied by a plugin; settings tools use "settings". */
  ownerId?: string
}

export interface McpToolInfo {
  serverId: string
  serverName: string
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

/** Proactive event predicate (strict boolean fields) */
export interface ProactiveEvent {
  id: string
  name: string
  /** e.g. email.received */
  source: string
  subjectContains?: string
  hasAttachment?: boolean
  keyword?: string
  objective: string
  enabled: boolean
  lastTriggeredAt: string | null
  triggerCount: number
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmChatResult {
  content: string
  tokensUsed: number
  model: string
}
