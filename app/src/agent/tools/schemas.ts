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
  design_brief_update: {
    type: 'object',
    properties: {
      briefId: { type: 'string', description: 'Linked SubDesign brief id (optional in a linked thread)' },
      objective: { type: 'string' },
      audience: { type: 'string' },
      platform: { type: 'string', enum: ['responsive', 'web-desktop', 'mobile-ios', 'desktop-app'] },
      fidelity: { type: 'string', enum: ['wireframe', 'high-fidelity'] },
      designSystemId: { type: 'string' },
      constraints: { type: 'array', items: { type: 'string' } },
      acceptanceCriteria: { type: 'array', items: { type: 'string' } },
      directions: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            summary: { type: 'string' },
            rationale: { type: 'string' },
            risk: { type: 'string' },
          },
          required: ['title', 'summary'],
        },
      },
      stage: { type: 'string', enum: ['brief', 'direction', 'build', 'critique', 'deliver'] },
    },
  },
  design_direction_select: {
    type: 'object',
    properties: {
      briefId: { type: 'string' },
      directionId: { type: 'string' },
      title: { type: 'string', description: 'Required only when creating a direction card inline' },
      summary: { type: 'string' },
      rationale: { type: 'string' },
      risk: { type: 'string' },
    },
    required: ['directionId'],
  },
  design_system_list: {
    type: 'object',
    properties: {},
  },
  design_system_read: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'project or a safe design-system id' },
    },
    required: ['id'],
  },
  design_system_create: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Safe folder id, e.g. editorial-light' },
      title: { type: 'string' },
      category: { type: 'string' },
      content: { type: 'string', description: 'Complete DESIGN.md content; omit to use the starter contract' },
    },
    required: ['id', 'title'],
  },
  design_system_update: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      content: { type: 'string', description: 'Complete DESIGN.md content' },
      title: { type: 'string', description: 'Used only when content is omitted' },
    },
    required: ['id', 'content'],
  },
  design_artifact_register: {
    type: 'object',
    properties: {
      manifest: {
        type: 'object',
        description: 'Artifact manifest. entry and supportingFiles are project-relative only.',
        properties: {
          id: { type: 'string' },
          briefId: { type: 'string' },
          kind: { type: 'string', enum: ['html', 'deck', 'react-component', 'markdown-document', 'svg', 'design-system'] },
          title: { type: 'string' },
          entry: { type: 'string' },
          renderer: { type: 'string', enum: ['html', 'deck-html', 'markdown', 'svg', 'code', 'design-system'] },
          exports: { type: 'array', items: { type: 'string', enum: ['html', 'pdf', 'zip', 'pptx', 'mp4', 'jsx', 'md', 'svg', 'txt'] } },
          supportingFiles: { type: 'array', items: { type: 'string' } },
          tweaks: {
            type: 'array',
            maxItems: 32,
            description: 'Structured live controls. replaceTemplate must contain literal {{value}}.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                label: { type: 'string' },
                kind: { type: 'string', enum: ['color', 'text', 'number', 'select', 'boolean'] },
                path: { type: 'string' },
                find: { type: 'string' },
                replaceTemplate: { type: 'string' },
                value: { type: 'string' },
                defaultValue: { type: 'string' },
                min: { type: 'number' },
                max: { type: 'number' },
                step: { type: 'number' },
                options: { type: 'array', items: { type: 'string' } },
              },
              required: ['id', 'label', 'kind', 'path', 'find', 'replaceTemplate'],
            },
          },
          designSystemId: { type: 'string' },
          status: { type: 'string', enum: ['streaming', 'complete', 'error'] },
          revision: { type: 'integer' },
        },
        required: ['id', 'kind', 'title', 'entry', 'renderer'],
      },
      briefId: { type: 'string', description: 'Optional when the thread is linked to a brief.' },
    },
    required: ['manifest'],
  },
  design_artifact_patch: {
    type: 'object',
    properties: {
      artifactId: { type: 'string', description: 'Registered SubDesign artifact id' },
      operations: {
        type: 'array',
        maxItems: 12,
        description: 'Exact bounded replacements. Paths must already belong to the artifact.',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Existing artifact entry or supporting file' },
            find: { type: 'string', description: 'Exact text to replace' },
            replace: { type: 'string', description: 'Replacement text' },
            expectedMatches: { type: 'integer', minimum: 1, maximum: 12, default: 1 },
          },
          required: ['path', 'find', 'replace'],
        },
      },
    },
    required: ['artifactId', 'operations'],
  },
  design_artifact_tweak: {
    type: 'object',
    properties: {
      artifactId: { type: 'string', description: 'Registered SubDesign artifact id' },
      tweakId: { type: 'string', description: 'Declared structured tweak id' },
      value: { type: 'string', description: 'New value; validated against the tweak kind and bounds' },
    },
    required: ['artifactId', 'tweakId', 'value'],
  },
  design_artifact_capture: {
    type: 'object',
    properties: {
      artifactId: { type: 'string', description: 'Registered SubDesign artifact id' },
      kind: { type: 'string', enum: ['screenshot', 'dom'] },
      viewport: {
        type: 'object',
        properties: {
          width: { type: 'integer', minimum: 320, maximum: 2400, default: 1440 },
          height: { type: 'integer', minimum: 240, maximum: 1800, default: 900 },
        },
      },
    },
    required: ['artifactId', 'kind'],
  },
  design_artifact_lint: {
    type: 'object',
    properties: {
      artifactId: { type: 'string', description: 'Registered SubDesign artifact id' },
    },
    required: ['artifactId'],
  },
  design_critique: {
    type: 'object',
    properties: {
      critique: {
        type: 'object',
        properties: {
          artifactId: { type: 'string' },
          briefId: { type: 'string' },
          briefCoverage: { type: 'integer', minimum: 0, maximum: 100 },
          brandConformance: { type: 'integer', minimum: 0, maximum: 100 },
          accessibility: { type: 'integer', minimum: 0, maximum: 100 },
          implementationReadiness: { type: 'integer', minimum: 0, maximum: 100 },
          evidence: {
            type: 'array',
            maxItems: 30,
            description: 'Required evidence for delivery: screenshot, dom, and lint entries.',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['screenshot', 'dom', 'lint', 'build', 'manual', 'template-attribution', 'design-system', 'asset-license'] },
                summary: { type: 'string' },
                path: { type: 'string' },
                capturedAt: { type: 'string' },
              },
              required: ['kind', 'summary'],
            },
          },
          findings: {
            type: 'array',
            maxItems: 40,
            items: {
              type: 'object',
              properties: {
                severity: { type: 'string', enum: ['blocker', 'warning', 'note'] },
                message: { type: 'string' },
                path: { type: 'string' },
              },
              required: ['severity', 'message'],
            },
          },
          verdict: { type: 'string', enum: ['pass', 'needs-revision'] },
        },
        required: ['artifactId', 'briefCoverage', 'brandConformance', 'accessibility', 'implementationReadiness', 'evidence', 'findings', 'verdict'],
      },
    },
    required: ['critique'],
  },
  design_artifact_export: {
    type: 'object',
    properties: {
      artifactId: { type: 'string', description: 'Registered SubDesign artifact id' },
      format: { type: 'string', enum: ['html', 'pdf', 'zip', 'pptx', 'mp4'] },
      briefId: { type: 'string' },
    },
    required: ['artifactId', 'format'],
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
