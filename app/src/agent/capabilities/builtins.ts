/**
 * Built-in capability bundles — tools + instructions as one unit.
 * Inspired by Pydantic AI 2.0 capabilities / progressive disclosure.
 */

import type { AgentCapability } from './types'
import { SUBDESIGN_CAPABILITY, SUBDESIGN_CRITIQUE_CAPABILITY } from './subDesign'

/** Framework-managed tool name (reserved). */
export const LOAD_CAPABILITY_TOOL = 'load_capability'
/** Framework tool: keyword retrieval over hidden tool schemas. */
export const TOOL_SEARCH_TOOL = 'tool_search'
/** CodeMode tool: run model-written JS that batches tool calls in one round. */
export const RUN_CODE_TOOL = 'run_code'

export const BUILTIN_CAPABILITIES: AgentCapability[] = [
  {
    id: 'interaction',
    description: 'Ask the user structured questions and resume the current run with the answer.',
    instructions:
      'Use ask_user when a missing user choice or clarification materially changes the result. Prefer concise options and include freeform input when useful.',
    tools: ['ask_user'],
    deferLoading: false,
    source: 'builtin',
    group: 'core',
  },
  {
    id: 'planning',
    description: 'Structured task planning and progress tracking for multi-step runs.',
    instructions:
      'Use update_plan for multi-step tasks. Send the complete ordered list each time; use pending, active, done, or failed statuses. Keep items actionable and concise.',
    tools: ['update_plan'],
    deferLoading: false,
    source: 'builtin',
    group: 'core',
  },
  {
    id: 'core-utils',
    description: 'Lightweight utilities: current time and structured extraction.',
    instructions:
      'Use datetime_now for schedules/timestamps. json_extract_lite only derives simple title/items/summary, not arbitrary schema extraction.',
    tools: ['datetime_now', 'json_extract_lite'],
    deferLoading: false,
    source: 'builtin',
    group: 'core',
  },
  {
    id: 'web-research',
    description: 'Web search and HTTP fetch for public research and sources.',
    instructions: `Web research playbook:
1. Prefer web_search for discovery (3–5 sources).
2. Use http_fetch only for specific URLs you need.
3. Never invent prices, citations, or private data.
4. Summarize with source attribution.`,
    tools: ['web_search', 'http_fetch'],
    deferLoading: true,
    source: 'builtin',
    group: 'research',
  },
  {
    id: 'workspace',
    description: 'Read/write files in the sandboxed workspace.',
    instructions: `Workspace rules:
- Paths are relative to the sandbox root.
- Prefer workspace_list before write when unsure.
- Write reports under reports/ when delivering deliverables.`,
    tools: ['workspace_list', 'workspace_read', 'workspace_diff', 'workspace_write', 'workspace_download', 'workspace_mkdir', 'workspace_move', 'workspace_delete', 'table_parse'],
    approvalTools: ['workspace_move', 'workspace_delete'],
    deferLoading: true,
    source: 'builtin',
    group: 'files',
  },
  {
    id: 'shell',
    description: 'Run shell commands (bash). Destructive ops may require approval.',
    instructions: `Shell rules:
- Prefer non-destructive commands first (pwd, ls, git status).
- Never exfiltrate secrets; avoid printing credentials.
- Long-running commands: set a reasonable timeoutMs.`,
    tools: ['bash'],
    /** Surface capability-level approval (also gated by bashRequireAsk / patterns) */
    approvalTools: ['bash'],
    deferLoading: true,
    source: 'builtin',
    group: 'system',
  },
  {
    id: 'memory',
    description: 'Session and durable memory read/write/search.',
    instructions: `Memory rules:
- Store only durable preferences/facts the user would want recalled.
- Do not store secrets (API keys, passwords).
- Search before rewriting similar memories.`,
    tools: ['memory_set', 'memory_get', 'memory_append', 'memory_search'],
    deferLoading: true,
    source: 'builtin',
    group: 'memory',
  },
  {
    id: 'skills',
    description: 'List / load / save procedural SKILL.md playbooks.',
    instructions: `Skills are procedural memory. Load a skill before following a multi-step playbook.
Prefer existing skills over inventing new procedures.`,
    tools: ['skill_list', 'skill_load', 'skill_save'],
    deferLoading: true,
    source: 'builtin',
    group: 'skills',
  },
  {
    id: 'codegraph',
    description: 'Local code index: explore, callers, impact analysis.',
    instructions: `CodeGraph:
- Prefer codegraph_status if unsure whether indexed.
- Use explore for architecture questions; impact/callers for change risk.
- Combine with workspace_read for full file content when needed.`,
    tools: [
      'codegraph_explore',
      'codegraph_status',
      'codegraph_impact',
      'codegraph_callers',
    ],
    deferLoading: true,
    source: 'builtin',
    group: 'code',
  },
  {
    id: 'delegate',
    description: 'Spawn isolated subagents or background delegate jobs.',
    instructions: `Delegation:
- Use for parallel isolated sub-goals with separate context.
- Prefer leaf role unless nested orchestration is required.
- Background jobs: check status with delegate_status.`,
    tools: ['delegate_task', 'delegate_status'],
    deferLoading: true,
    source: 'builtin',
    group: 'multi-agent',
  },
  {
    id: 'messaging',
    description: 'Send messages via gateway (Telegram etc.).',
    instructions: 'Only send messages the user explicitly requested. Keep bodies concise.',
    tools: ['message_send'],
    deferLoading: true,
    source: 'builtin',
    group: 'gateway',
  },
  {
    id: 'code-mode',
    description:
      'Run model-written JavaScript that batches many tool calls (loops/filters) into one round.',
    instructions: `CodeMode rules:
- Use run_code when a task needs many similar tool calls (e.g. fetch 10 URLs then filter) — one code block replaces N rounds.
- Inside code, call tools as: const r = await tools.web_search({ query: '...' }). Results are strings.
- Use log(...) for progress notes; return a final string (or JSON-serializable value).
- Only tools from currently loaded capabilities are callable; delegate/run_code recursion is blocked.
- Every run_code execution requires human approval.`,
    toolNames: [RUN_CODE_TOOL],
    approvalTools: [RUN_CODE_TOOL],
    modelSettings: { temperature: 0.15 },
    deferLoading: true,
    source: 'builtin',
    group: 'code',
  },
  {
    id: 'mcp-bridge',
    description: 'List or call MCP tools via generic mcp_list_tools / mcp_call.',
    instructions: `Generic MCP bridge:
- Prefer server-specific mcp_* capabilities when available (progressive load).
- Otherwise mcp_list_tools then mcp_call with correct serverId/toolName.`,
    tools: ['mcp_list_tools', 'mcp_call'],
    deferLoading: true,
    source: 'builtin',
    group: 'mcp',
  },
  SUBDESIGN_CAPABILITY,
  SUBDESIGN_CRITIQUE_CAPABILITY,
]
