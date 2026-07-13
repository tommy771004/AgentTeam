/** Loop patterns from 02_Execution_Rules */
export type LoopType = 'Turn-based' | 'Goal-based' | 'Time-based' | 'Proactive'

/** Chat composer attachment (images / text files) — pure type, no DOM */
export type ChatAttachmentKind = 'image' | 'text' | 'binary'

export interface ChatAttachment {
  id: string
  kind: ChatAttachmentKind
  name: string
  mimeType: string
  size: number
  /** data: URL for images (session); may be dropped after disk persist */
  dataUrl?: string
  /** Extracted text for text-like files */
  textContent?: string
  /** Absolute path after Electron materialize — survives reloads / queue */
  filePath?: string
}

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
export type ModelSource = 'role' | 'fallback' | 'primary' | 'cli' | 'sim' | 'none'

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

/** A raw OpenCode permission value, including its fine-grained glob map. */
export type PermissionRuleValue = PermissionAction | Record<string, PermissionAction>

/** Lossless permission projection used by builtin and external adapters. */
export interface PermissionProjection {
  rules: Record<string, PermissionRuleValue>
  unsupported: string[]
}

/** ChatGPT-style「動作應如何核准」三段模式 */
export type ApprovalMode = 'always' | 'auto' | 'full'

/** P1-B: how a model capability claim was established */
export type ModelCapabilitySource = 'verified' | 'assumed' | 'unknown' | 'discovered'

export interface ModelProfile {
  modelId: string
  /** Function calling / tool use */
  tools?: boolean
  /** Multimodal image input */
  vision?: boolean
  /** Strict JSON / structured output */
  structuredOutput?: boolean
  /** Context window (tokens) when known */
  contextWindow?: number
  source: ModelCapabilitySource
  lastVerifiedAt?: string
  /** Probe error summary (why a capability came back false) */
  note?: string
}

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
  /** Stable trace id assigned by runTask controller; engine adopts it as state.id */
  runId?: string
  /**
   * Run entry source for lifecycle hooks (composer / schedule / webhook / …).
   * Set by runTask; tools forward it into beforeTool/afterTool evaluation.
   */
  sourceKind?: string
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
  /** Inherited OpenCode agent id for per-agent MCP restrictions. */
  mcpAgentId?: string
  /** OpenCode-style subagent */
  subagentId?: SubagentId
  /** Permission policy for tools */
  permissionPolicy?: PermissionPolicy
  /** Lossless OpenCode permission rules; deny/ask is evaluated before coarse policy. */
  permissionProjection?: PermissionProjection
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
  /**
   * User chat attachments (images / text files) for this run.
   * Images go to vision-capable FC messages; text is folded into the objective.
   */
  userAttachments?: ChatAttachment[]
  /**
   * Override active project root for this run only (scheduler / multi-project).
   * Does not permanently change projectStore.
   */
  projectRoot?: string
  /**
   * Loop type selection mode for this run:
   * - force: use forceLoopType / selectedLoopType (automation / user pin)
   * - auto: classify + optional LLM plan may pick Turn/Goal/… (conversation default)
   */
  loopTypeMode?: 'force' | 'auto'
  /** When loopTypeMode=force, re-derive plan for this loop type. */
  forceLoopType?: LoopType
  /** Thread id for plan bubble / UI correlation (optional). */
  threadId?: string
  /**
   * Resume a previous Goal on this thread: keep DoD / missing / steps.
   * Skips auto-classify re-parse; forces Goal-based corrective plan.
   */
  continueGoal?: {
    objective: string
    definitionOfDone: string
    loopType?: LoopType
    steps?: string[]
    missing?: string[]
    priorDigest?: string
    /** Optional user hint this turn (e.g.「補價格欄」) */
    userHint?: string
  }
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
  /** External runner/session/config lineage. */
  externalRun?: ExternalRunRef
  cliConfigSnapshot?: CliConfigSnapshot
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
  /** External runner/session/config lineage; secrets are never included. */
  externalRun?: ExternalRunRef
  cliConfigSnapshot?: CliConfigSnapshot
}

export type ExternalRunStatus = 'starting' | 'running' | 'success' | 'failed' | 'aborted'

export interface ExternalRunRef {
  provider: 'opencode'
  serverUrl?: string
  sessionId?: string
  parentSessionId?: string
  /** Child sessions observed from OpenCode /session/:id/children. */
  childSessionIds?: string[]
  lastTodoAt?: string
  lastChildrenAt?: string
  version?: string
  configFingerprint?: string
  status?: ExternalRunStatus
  completionReason?: string
  startedAt?: string
  finishedAt?: string
}

/** Safe, renderer-visible OpenCode config lineage; never contains secret values. */
export interface CliConfigSnapshot {
  provider: 'opencode'
  sources: string[]
  agent: string
  model?: string
  permission: PermissionProjection
  instructions?: Array<{ entry: string; path?: string; bytes: number; sha256: string }>
  capturedAt: string
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
/** Provider-specific convenience preset; every option remains OpenAI-compatible. */
export type ApiProviderPreset = 'aihubmix' | 'openai' | 'openrouter' | 'custom'

export interface LlmSettings {
  enabled: boolean
  apiProvider: ApiProviderPreset
  baseUrl: string
  apiKey: string
  model: string
  /** Retried only when an OpenAI-compatible gateway reports no available route. */
  fallbackModels: string[]
  /** Model ids returned by the configured OpenAI-compatible /models endpoint. */
  discoveredModels: string[]
  /** Per-role model overrides (empty string = fall back to `model`) */
  roleModels: RoleModelConfig
  /** Enable role-based / delegated sub-agent execution. Default is off. */
  subAgentsEnabled: boolean
  authLevel: number
  minConfidence: number
  maxIterationsDefault: number
  safetyEnabled: boolean
  toolsEnabled: boolean
  webSearchEnabled: boolean
  /** Use OpenAI function-calling multi-round tool loop when LLM is on */
  functionCalling: boolean
  /** LLM 解析任務計畫（規格 03）；關閉時只使用啟發式 parser。 */
  llmParseEnabled?: boolean
  /**
   * 對話 run 開始時用 sessionSearch 召回 archive/memory/skills 摘要注入 volatile。
   * 預設開啟；臨時對話仍會跳過。
   */
  sessionRecallEnabled?: boolean
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
  /**
   * OAuth client credentials for connector plugins (github / notion / google / …).
   * clientSecret is sensitive — redacted on export like customToolSecrets.
   */
  pluginOAuthClients: Record<string, { clientId: string; clientSecret?: string }>
  /** MCP servers (minimal client) */
  mcpServers: McpServerConfig[]
  mcpEnabled: boolean
  /** Optional per-OpenCode-agent allowlist; missing key keeps global behavior. */
  mcpAgentServers: Record<string, string[]>
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
  /**
   * P1-B: per-model capability profiles.
   * 'verified' comes only from an explicit user-run probe; 'assumed' from
   * model-id heuristics; unknown fields stay undefined (conservative).
   */
  modelProfiles: Record<string, ModelProfile>
  /**
   * P1-D: user-defined lifecycle hook rules（宣告式，只能限制/觀察）。
   * Plugin hooks 由 manifest 提供並經 sanitize；此欄僅存 user 規則。
   */
  hookRules: unknown[]

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

/** Runner id stored on jobs (mirrors thread runners; avoid importing threadStore here) */
export type JobRunner = 'builtin' | 'codex' | 'claude' | 'grok' | 'opencode' | 'cursor'

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
  /** Execution engine for this job (default builtin) */
  runner?: JobRunner
  /** Pin project workspace for this job (absolute path); empty = use current UI project */
  projectRoot?: string
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
  /**
   * Owning package/plugin id (e.g. github-mcp) for settings merge / uninstall ownership.
   * Absent for pure user-managed servers in Settings.
   */
  pluginId?: string
  /**
   * Secret owner id for pluginSecrets / customToolSecrets (e.g. github-connector).
   * May differ from pluginId when npm-MCP is linked to a connector token.
   */
  secretPluginId?: string
  /** http JSON-RPC endpoint, e.g. http://127.0.0.1:3100/mcp */
  transport: 'http' | 'stdio'
  url?: string
  /** stdio: command + args */
  command?: string
  args?: string[]
  /** Extra environment for the stdio child, e.g. Electron's Node compatibility mode. */
  env?: Record<string, string>
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
