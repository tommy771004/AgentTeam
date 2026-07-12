/**
 * OpenAI-compatible function-calling tool schemas.
 */

import type { ToolName } from './registry'
import { TOOL_CATALOG } from './registry'

export interface OpenAiToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

const PARAMS: Record<ToolName, Record<string, unknown>> = {
  web_search: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      limit: { type: 'integer', description: 'Max results (1-8)', default: 5 },
    },
    required: ['query'],
  },
  http_fetch: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'HTTP(S) URL' },
      maxChars: { type: 'integer', description: 'Max response characters', default: 4000 },
    },
    required: ['url'],
  },
  workspace_list: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path under workspace', default: '.' },
    },
  },
  workspace_read: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative file path under workspace' },
    },
    required: ['path'],
  },
  workspace_diff: {
    type: 'object',
    properties: {
      paths: { type: 'array', items: { type: 'string' }, description: 'Optional relative file paths to scope the diff' },
    },
  },
  workspace_write: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative file path under workspace' },
      content: { type: 'string', description: 'File content to write' },
    },
    required: ['path', 'content'],
  },
  workspace_download: { type: 'object', properties: { url: { type: 'string', description: 'HTTP(S) URL' }, path: { type: 'string', description: 'Relative destination path' } }, required: ['url', 'path'] },
  workspace_mkdir: { type: 'object', properties: { path: { type: 'string', description: 'Relative directory path' } }, required: ['path'] },
  workspace_move: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
  workspace_delete: { type: 'object', properties: { path: { type: 'string' }, recursive: { type: 'boolean', default: false } }, required: ['path'] },
  table_parse: { type: 'object', properties: { text: { type: 'string' }, delimiter: { type: 'string', enum: ['auto', ',', '\t', ';'], default: 'auto' }, hasHeader: { type: 'boolean', default: true } }, required: ['text'] },
  bash: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to run' },
      timeoutMs: { type: 'integer', description: 'Timeout ms (default 60000)' },
    },
    required: ['command'],
  },
  datetime_now: {
    type: 'object',
    properties: {
      timezone: { type: 'string', description: 'IANA timezone (optional)' },
    },
  },
  memory_set: {
    type: 'object',
    properties: {
      key: { type: 'string' },
      value: { type: 'string' },
    },
    required: ['key', 'value'],
  },
  memory_get: {
    type: 'object',
    properties: {
      key: { type: 'string' },
    },
    required: ['key'],
  },
  memory_append: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Durable memory text to append' },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['text'],
  },
  memory_search: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      limit: { type: 'integer', default: 8 },
    },
    required: ['query'],
  },
  skill_list: {
    type: 'object',
    properties: {},
  },
  skill_load: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Skill name' },
    },
    required: ['name'],
  },
  skill_save: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      body: { type: 'string', description: 'Markdown skill body' },
    },
    required: ['name', 'body'],
  },
  mcp_list_tools: {
    type: 'object',
    properties: {
      serverId: { type: 'string', description: 'Optional: filter by server id' },
    },
  },
  mcp_call: {
    type: 'object',
    properties: {
      serverId: { type: 'string' },
      toolName: { type: 'string' },
      arguments: { type: 'object' },
    },
    required: ['serverId', 'toolName'],
  },
  delegate_task: {
    type: 'object',
    properties: {
      goal: { type: 'string' },
      context: { type: 'string' },
      role: { type: 'string', enum: ['leaf', 'orchestrator'] },
      background: {
        type: 'boolean',
        description: 'If true, return immediately and run in background',
      },
      notify_on_complete: {
        type: 'boolean',
        description: 'Desktop notification when background job finishes (default true)',
      },
      inherit_capabilities: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Capability ids to preload in child (e.g. codegraph, workspace). Explicit inherit only.',
      },
    },
    required: ['goal'],
  },
  delegate_status: {
    type: 'object',
    properties: {
      jobId: { type: 'string', description: 'Optional job id; omit to list recent jobs' },
    },
  },
  message_send: {
    type: 'object',
    properties: {
      channel: { type: 'string', enum: ['telegram'], description: 'Messaging channel' },
      chatId: { type: 'string', description: 'Chat / channel id' },
      text: { type: 'string', description: 'Message body' },
    },
    required: ['chatId', 'text'],
  },
  json_extract_lite: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Source text' },
      fields: {
        type: 'array',
        items: { type: 'string' },
        description: 'Desired field names',
      },
    },
    required: ['text'],
  },
  update_plan: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: 'Complete ordered task list snapshot. Replace the previous plan.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Stable item id (optional)' },
            text: { type: 'string', description: 'Actionable task description' },
            status: { type: 'string', enum: ['pending', 'active', 'done', 'failed'] },
          },
          required: ['text'],
        },
      },
    },
    required: ['todos'],
  },
  ask_user: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'Question to show to the user' },
      reason: { type: 'string', description: 'Why the agent needs this answer' },
      options: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            description: { type: 'string' },
            value: { type: 'string' },
          },
          required: ['label'],
        },
      },
      multiSelect: { type: 'boolean', default: false },
      allowFreeform: { type: 'boolean', default: true },
      timeoutMs: { type: 'integer', description: 'Question timeout in milliseconds' },
    },
    required: ['question'],
  },
  codegraph_explore: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Natural language or symbol name, e.g. "how does X work", "UserService.login"',
      },
      projectRoot: {
        type: 'string',
        description: 'Optional absolute project path (default: selected project)',
      },
    },
    required: ['query'],
  },
  codegraph_status: {
    type: 'object',
    properties: {
      projectRoot: {
        type: 'string',
        description: 'Optional absolute project path',
      },
    },
  },
  codegraph_impact: {
    type: 'object',
    properties: {
      symbol: { type: 'string', description: 'Symbol name to analyze' },
      depth: { type: 'integer', description: 'Traversal depth (default 2)', default: 2 },
      projectRoot: { type: 'string' },
    },
    required: ['symbol'],
  },
  codegraph_callers: {
    type: 'object',
    properties: {
      symbol: { type: 'string', description: 'Symbol to find callers for' },
      projectRoot: { type: 'string' },
    },
    required: ['symbol'],
  },
}

export function buildOpenAiTools(opts?: {
  webSearchEnabled?: boolean
  only?: ToolName[]
}): OpenAiToolDef[] {
  const catalog = TOOL_CATALOG.filter((t) => {
    if (opts?.webSearchEnabled === false && t.name === 'web_search') return false
    if (opts?.only && !opts.only.includes(t.name)) return false
    return true
  })

  return catalog.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: PARAMS[t.name],
    },
  }))
}

export function isToolName(name: string): name is ToolName {
  return TOOL_CATALOG.some((t) => t.name === name)
}
