/**
 * Single source of truth for built-in tool definitions.
 *
 * Each tool records: catalog description, keyword hints, parameter schema,
 * and exactly one owning capability. Catalog / schemas / capability tools[]
 * are derived views — orphan tools cannot exist (compile error via satisfies).
 */
import type { BuiltinCapabilityId } from '../capabilities/capabilityIds.ts'

export type ToolDefinition = {
  description: string
  keywords: string[]
  parameters: Record<string, unknown>
  owningCapability: BuiltinCapabilityId
  /**
   * Extra capability ids that also surface this tool when loaded
   * (historical dual listing, e.g. SubDesign critique pack).
   * Ownership for gating remains owningCapability only.
   */
  alsoListedIn?: BuiltinCapabilityId[]
}

export const TOOL_DEFINITIONS = {
  web_search: {
    description: "Search the web / Wikipedia for facts and sources",
    keywords: ["search","find","research","compare","look up","web","market","competitor","software","tools","price"],
    parameters: {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Search query"
        },
        "limit": {
          "type": "integer",
          "description": "Max results (1-8)",
          "default": 5
        }
      },
      "required": [
        "query"
      ]
    },
    owningCapability: 'web-research',
  },
  http_fetch: {
    description: "Fetch a public HTTP(S) URL as text",
    keywords: ["fetch","http","url","download","endpoint","api"],
    parameters: {
      "type": "object",
      "properties": {
        "url": {
          "type": "string",
          "description": "HTTP(S) URL"
        },
        "maxChars": {
          "type": "integer",
          "description": "Max response characters",
          "default": 4000
        }
      },
      "required": [
        "url"
      ]
    },
    owningCapability: 'web-research',
  },
  workspace_list: {
    description: "List files in the sandboxed workspace",
    keywords: ["list files","workspace","directory","ls","ingest"],
    parameters: {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "Relative path under workspace",
          "default": "."
        }
      }
    },
    owningCapability: 'workspace',
  },
  workspace_read: {
    description: "Read a file from the sandboxed workspace",
    keywords: ["read file","open file","load","ingest","parse"],
    parameters: {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "Relative file path under workspace"
        }
      },
      "required": [
        "path"
      ]
    },
    owningCapability: 'workspace',
  },
  workspace_diff: {
    description: "Read the current Git working-tree diff for selected workspace files.",
    keywords: ["diff","review changes","patch","working tree","changed files"],
    parameters: {
      "type": "object",
      "properties": {
        "paths": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Optional relative file paths to scope the diff"
        }
      }
    },
    owningCapability: 'workspace',
  },
  workspace_write: {
    description: "Write a file into the sandboxed workspace",
    keywords: ["write file","save","export","report","deliver","output"],
    parameters: {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "Relative file path under workspace"
        },
        "content": {
          "type": "string",
          "description": "File content to write"
        }
      },
      "required": [
        "path",
        "content"
      ]
    },
    owningCapability: 'workspace',
  },
  workspace_download: {
    description: "Download an HTTP(S) URL to the sandboxed workspace",
    keywords: ["download file","save url","url to workspace"],
    parameters: {
      "type": "object",
      "properties": {
        "url": {
          "type": "string",
          "description": "HTTP(S) URL"
        },
        "path": {
          "type": "string",
          "description": "Relative destination path"
        }
      },
      "required": [
        "url",
        "path"
      ]
    },
    owningCapability: 'workspace',
  },
  workspace_mkdir: {
    description: "Create a directory in the sandboxed workspace",
    keywords: ["mkdir","create directory","folder"],
    parameters: {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "Relative directory path"
        }
      },
      "required": [
        "path"
      ]
    },
    owningCapability: 'workspace',
  },
  workspace_move: {
    description: "Move or rename a workspace file or directory",
    keywords: ["move file","rename file","rename directory"],
    parameters: {
      "type": "object",
      "properties": {
        "from": {
          "type": "string"
        },
        "to": {
          "type": "string"
        }
      },
      "required": [
        "from",
        "to"
      ]
    },
    owningCapability: 'workspace',
  },
  workspace_delete: {
    description: "Delete a workspace file or directory",
    keywords: ["delete file","remove file","delete directory"],
    parameters: {
      "type": "object",
      "properties": {
        "path": {
          "type": "string"
        },
        "recursive": {
          "type": "boolean",
          "default": false
        }
      },
      "required": [
        "path"
      ]
    },
    owningCapability: 'workspace',
  },
  table_parse: {
    description: "Parse CSV or TSV text into structured rows",
    keywords: ["csv","tsv","table","spreadsheet","parse rows"],
    parameters: {
      "type": "object",
      "properties": {
        "text": {
          "type": "string"
        },
        "delimiter": {
          "type": "string",
          "enum": [
            "auto",
            ",",
            "\t",
            ";"
          ],
          "default": "auto"
        },
        "hasHeader": {
          "type": "boolean",
          "default": true
        }
      },
      "required": [
        "text"
      ]
    },
    owningCapability: 'workspace',
  },
  bash: {
    description: "Run a shell command in Electron (bash / cmd)",
    keywords: ["bash","shell","command","terminal","exec","run script","git","npm"],
    parameters: {
      "type": "object",
      "properties": {
        "command": {
          "type": "string",
          "description": "Shell command to run"
        },
        "timeoutMs": {
          "type": "integer",
          "description": "Timeout ms (default 60000)"
        }
      },
      "required": [
        "command"
      ]
    },
    owningCapability: 'shell',
  },
  codegraph_explore: {
    description: "Query local CodeGraph index for symbols/call paths (surgical code context). Requires codegraph CLI + project init.",
    keywords: ["codegraph","call graph","callers","callees","impact","symbol","architecture","how does","code structure","blast radius","dependency"],
    parameters: {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Natural language or symbol name, e.g. \"how does X work\", \"UserService.login\""
        },
        "projectRoot": {
          "type": "string",
          "description": "Optional absolute project path (default: selected project)"
        }
      },
      "required": [
        "query"
      ]
    },
    owningCapability: 'codegraph',
  },
  codegraph_status: {
    description: "Check whether CodeGraph CLI is installed and project is indexed",
    keywords: ["codegraph status","index status","code index"],
    parameters: {
      "type": "object",
      "properties": {
        "projectRoot": {
          "type": "string",
          "description": "Optional absolute project path"
        }
      }
    },
    owningCapability: 'codegraph',
  },
  codegraph_impact: {
    description: "Blast radius: what is affected if symbol changes (CodeGraph impact)",
    keywords: ["impact","blast radius","affected","breaking change","ripple"],
    parameters: {
      "type": "object",
      "properties": {
        "symbol": {
          "type": "string",
          "description": "Symbol name to analyze"
        },
        "depth": {
          "type": "integer",
          "description": "Traversal depth (default 2)",
          "default": 2
        },
        "projectRoot": {
          "type": "string"
        }
      },
      "required": [
        "symbol"
      ]
    },
    owningCapability: 'codegraph',
  },
  codegraph_callers: {
    description: "Find callers of a symbol via CodeGraph",
    keywords: ["callers","who calls","references","usages"],
    parameters: {
      "type": "object",
      "properties": {
        "symbol": {
          "type": "string",
          "description": "Symbol to find callers for"
        },
        "projectRoot": {
          "type": "string"
        }
      },
      "required": [
        "symbol"
      ]
    },
    owningCapability: 'codegraph',
  },
  datetime_now: {
    description: "Get current local datetime",
    keywords: ["schedule","time","daily","cron","timestamp","clock"],
    parameters: {
      "type": "object",
      "properties": {
        "timezone": {
          "type": "string",
          "description": "IANA timezone (optional)"
        }
      }
    },
    owningCapability: 'core-utils',
  },
  memory_set: {
    description: "Store a key/value in session memory",
    keywords: ["remember","store","memory","cache"],
    parameters: {
      "type": "object",
      "properties": {
        "key": {
          "type": "string"
        },
        "value": {
          "type": "string"
        }
      },
      "required": [
        "key",
        "value"
      ]
    },
    owningCapability: 'memory',
  },
  memory_get: {
    description: "Read a key from session memory",
    keywords: ["recall","memory","retrieve","context"],
    parameters: {
      "type": "object",
      "properties": {
        "key": {
          "type": "string"
        }
      },
      "required": [
        "key"
      ]
    },
    owningCapability: 'memory',
  },
  memory_append: {
    description: "Append a durable memory entry (Hermes-style)",
    keywords: ["remember","prefer","lesson","note","save memory"],
    parameters: {
      "type": "object",
      "properties": {
        "text": {
          "type": "string",
          "description": "Durable memory text to append"
        },
        "tags": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "text"
      ]
    },
    owningCapability: 'memory',
  },
  memory_search: {
    description: "Search persistent memory entries",
    keywords: ["recall","search memory","past","preference"],
    parameters: {
      "type": "object",
      "properties": {
        "query": {
          "type": "string"
        },
        "limit": {
          "type": "integer",
          "default": 8
        }
      },
      "required": [
        "query"
      ]
    },
    owningCapability: 'memory',
  },
  skill_list: {
    description: "List available skills (procedural memory)",
    keywords: ["skill","skills","procedure","playbook"],
    parameters: {
      "type": "object",
      "properties": {}
    },
    owningCapability: 'skills',
  },
  skill_load: {
    description: "Load full SKILL.md content by name",
    keywords: ["skill","load skill","playbook","procedure"],
    parameters: {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "description": "Skill name"
        }
      },
      "required": [
        "name"
      ]
    },
    owningCapability: 'skills',
  },
  skill_save: {
    description: "Save or update a skill document",
    keywords: ["save skill","create skill","write skill"],
    parameters: {
      "type": "object",
      "properties": {
        "name": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "body": {
          "type": "string",
          "description": "Markdown skill body"
        }
      },
      "required": [
        "name",
        "body"
      ]
    },
    owningCapability: 'skills',
  },
  mcp_list_tools: {
    description: "List tools from configured MCP servers",
    keywords: ["mcp","list tools","external tool"],
    parameters: {
      "type": "object",
      "properties": {
        "serverId": {
          "type": "string",
          "description": "Optional: filter by server id"
        }
      }
    },
    owningCapability: 'mcp-bridge',
  },
  mcp_call: {
    description: "Call a tool on an MCP server",
    keywords: ["mcp","call tool","external"],
    parameters: {
      "type": "object",
      "properties": {
        "serverId": {
          "type": "string"
        },
        "toolName": {
          "type": "string"
        },
        "arguments": {
          "type": "object"
        }
      },
      "required": [
        "serverId",
        "toolName"
      ]
    },
    owningCapability: 'mcp-bridge',
  },
  delegate_task: {
    description: "Spawn isolated leaf subagent with separate context (supports background + notify)",
    keywords: ["delegate","subagent","parallel","spawn","isolate","background"],
    parameters: {
      "type": "object",
      "properties": {
        "goal": {
          "type": "string"
        },
        "context": {
          "type": "string"
        },
        "role": {
          "type": "string",
          "enum": [
            "leaf",
            "orchestrator"
          ]
        },
        "background": {
          "type": "boolean",
          "description": "If true, return immediately and run in background"
        },
        "notify_on_complete": {
          "type": "boolean",
          "description": "Desktop notification when background job finishes (default true)"
        },
        "inherit_capabilities": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Capability ids to preload in child (e.g. codegraph, workspace). Explicit inherit only."
        }
      },
      "required": [
        "goal"
      ]
    },
    owningCapability: 'delegate',
  },
  delegate_status: {
    description: "List or query background delegate jobs",
    keywords: ["delegate","status","background","job","notify"],
    parameters: {
      "type": "object",
      "properties": {
        "jobId": {
          "type": "string",
          "description": "Optional job id; omit to list recent jobs"
        },
        "jobIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Job ids to wait on (max 20); used with wait"
        },
        "wait": {
          "type": "string",
          "enum": [
            "none",
            "any",
            "all"
          ],
          "description": "Block until jobs finish: any = first terminal job returns; all = every job terminal. Default none (snapshot only). Never poll in a loop — use this instead."
        },
        "timeoutMs": {
          "type": "number",
          "description": "Max wait in ms (default 30000, cap 120000)"
        }
      }
    },
    owningCapability: 'delegate',
  },
  monitor: {
    description: "Stream a long-running command; each output line becomes a Proactive event",
    keywords: ["monitor","watch","tail","stream","log","ci","poll"],
    parameters: {
      "type": "object",
      "properties": {
        "action": {
          "type": "string",
          "enum": [
            "start",
            "stop",
            "list"
          ],
          "description": "start a stream, stop one by id, or list active monitors"
        },
        "command": {
          "type": "string",
          "description": "start: shell command whose output lines become events. ALWAYS use line-buffered filters (grep --line-buffered) — raw log streams get auto-stopped for volume."
        },
        "description": {
          "type": "string",
          "description": "start: short label shown on every event (3-6 words)"
        },
        "id": {
          "type": "string",
          "description": "stop: monitor id"
        }
      },
      "required": [
        "action"
      ]
    },
    owningCapability: 'monitoring',
  },
  message_send: {
    description: "Send a message via messaging gateway (Telegram etc.)",
    keywords: ["telegram","message","send","reply","gateway","chat"],
    parameters: {
      "type": "object",
      "properties": {
        "channel": {
          "type": "string",
          "enum": [
            "telegram"
          ],
          "description": "Messaging channel"
        },
        "chatId": {
          "type": "string",
          "description": "Chat / channel id"
        },
        "text": {
          "type": "string",
          "description": "Message body"
        }
      },
      "required": [
        "chatId",
        "text"
      ]
    },
    owningCapability: 'messaging',
  },
  json_extract_lite: {
    description: "json_extract_lite: simple title/items/summary heuristic, not arbitrary schema extraction",
    keywords: ["extract","json","schema","structure","parse"],
    parameters: {
      "type": "object",
      "properties": {
        "text": {
          "type": "string",
          "description": "Source text"
        },
        "fields": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Desired field names"
        }
      },
      "required": [
        "text"
      ]
    },
    owningCapability: 'core-utils',
  },
  update_plan: {
    description: "Update the current task plan with ordered items and statuses. Use for multi-step work.",
    keywords: ["update plan","task list","todo list","execution plan","plan steps"],
    parameters: {
      "type": "object",
      "properties": {
        "todos": {
          "type": "array",
          "description": "Complete ordered task list snapshot. Replace the previous plan.",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string",
                "description": "Stable item id (optional)"
              },
              "text": {
                "type": "string",
                "description": "Actionable task description"
              },
              "status": {
                "type": "string",
                "enum": [
                  "pending",
                  "active",
                  "done",
                  "failed"
                ]
              }
            },
            "required": [
              "text"
            ]
          }
        }
      },
      "required": [
        "todos"
      ]
    },
    owningCapability: 'planning',
  },
  ask_user: {
    description: "Ask the user a structured question with optional choices before continuing.",
    keywords: ["ask user","need clarification","clarify","choose","preference","question"],
    parameters: {
      "type": "object",
      "properties": {
        "question": {
          "type": "string",
          "description": "Question to show to the user"
        },
        "reason": {
          "type": "string",
          "description": "Why the agent needs this answer"
        },
        "options": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "label": {
                "type": "string"
              },
              "description": {
                "type": "string"
              },
              "value": {
                "type": "string"
              }
            },
            "required": [
              "label"
            ]
          }
        },
        "multiSelect": {
          "type": "boolean",
          "default": false
        },
        "allowFreeform": {
          "type": "boolean",
          "default": true
        },
        "timeoutMs": {
          "type": "integer",
          "description": "Question timeout in milliseconds"
        }
      },
      "required": [
        "question"
      ]
    },
    owningCapability: 'interaction',
  },
  design_brief_update: {
    description: "Update the linked SubDesign brief metadata, direction cards, or stage.",
    keywords: ["subdesign","design brief","design brief update","audience","constraints","acceptance criteria","direction cards"],
    parameters: {
      "type": "object",
      "properties": {
        "briefId": {
          "type": "string",
          "description": "Linked SubDesign brief id (optional in a linked thread)"
        },
        "objective": {
          "type": "string"
        },
        "audience": {
          "type": "string"
        },
        "platform": {
          "type": "string",
          "enum": [
            "responsive",
            "web-desktop",
            "mobile-ios",
            "desktop-app"
          ]
        },
        "fidelity": {
          "type": "string",
          "enum": [
            "wireframe",
            "high-fidelity"
          ]
        },
        "designSystemId": {
          "type": "string"
        },
        "constraints": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "acceptanceCriteria": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "directions": {
          "type": "array",
          "maxItems": 3,
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "title": {
                "type": "string"
              },
              "summary": {
                "type": "string"
              },
              "rationale": {
                "type": "string"
              },
              "risk": {
                "type": "string"
              }
            },
            "required": [
              "title",
              "summary"
            ]
          }
        },
        "stage": {
          "type": "string",
          "enum": [
            "brief",
            "direction",
            "build",
            "critique",
            "deliver"
          ]
        }
      }
    },
    owningCapability: 'subdesign-workflow',
  },
  design_direction_select: {
    description: "Record the user-selected SubDesign direction and unlock Build stage.",
    keywords: ["design direction","select direction","direction selected","choose direction","design choice"],
    parameters: {
      "type": "object",
      "properties": {
        "briefId": {
          "type": "string"
        },
        "directionId": {
          "type": "string"
        },
        "title": {
          "type": "string",
          "description": "Required only when creating a direction card inline"
        },
        "summary": {
          "type": "string"
        },
        "rationale": {
          "type": "string"
        },
        "risk": {
          "type": "string"
        }
      },
      "required": [
        "directionId"
      ]
    },
    owningCapability: 'subdesign-workflow',
  },
  design_system_list: {
    description: "List project DESIGN.md and SubDesign design systems.",
    keywords: ["design system list","design systems","design.md","brand rules","tokens"],
    parameters: {
      "type": "object",
      "properties": {}
    },
    owningCapability: 'subdesign-workflow',
  },
  design_system_read: {
    description: "Read a selected DESIGN.md design system and return its parsed summary.",
    keywords: ["read design system","read design.md","design tokens","brand system"],
    parameters: {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "description": "project or a safe design-system id"
        }
      },
      "required": [
        "id"
      ]
    },
    owningCapability: 'subdesign-workflow',
  },
  design_system_create: {
    description: "Create a versioned SubDesign DESIGN.md under the project workspace.",
    keywords: ["create design system","new design system","write design.md","brand contract"],
    parameters: {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "description": "Safe folder id, e.g. editorial-light"
        },
        "title": {
          "type": "string"
        },
        "category": {
          "type": "string"
        },
        "content": {
          "type": "string",
          "description": "Complete DESIGN.md content; omit to use the starter contract"
        }
      },
      "required": [
        "id",
        "title"
      ]
    },
    owningCapability: 'subdesign-workflow',
  },
  design_system_update: {
    description: "Update a versioned SubDesign DESIGN.md under the project workspace.",
    keywords: ["update design system","update design.md","edit brand rules","write tokens"],
    parameters: {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "content": {
          "type": "string",
          "description": "Complete DESIGN.md content"
        },
        "title": {
          "type": "string",
          "description": "Used only when content is omitted"
        }
      },
      "required": [
        "id",
        "content"
      ]
    },
    owningCapability: 'subdesign-workflow',
  },
  design_artifact_register: {
    description: "Register a validated project-relative SubDesign artifact manifest for preview and revision tracking.",
    keywords: ["artifact manifest","register artifact","preview artifact","design output","revision"],
    parameters: {
      "type": "object",
      "properties": {
        "manifest": {
          "type": "object",
          "description": "Artifact manifest. entry and supportingFiles are project-relative only.",
          "properties": {
            "id": {
              "type": "string"
            },
            "briefId": {
              "type": "string"
            },
            "kind": {
              "type": "string",
              "enum": [
                "html",
                "deck",
                "react-component",
                "markdown-document",
                "svg",
                "design-system"
              ]
            },
            "title": {
              "type": "string"
            },
            "entry": {
              "type": "string"
            },
            "renderer": {
              "type": "string",
              "enum": [
                "html",
                "deck-html",
                "markdown",
                "svg",
                "code",
                "design-system"
              ]
            },
            "exports": {
              "type": "array",
              "items": {
                "type": "string",
                "enum": [
                  "html",
                  "pdf",
                  "zip",
                  "pptx",
                  "mp4",
                  "jsx",
                  "md",
                  "svg",
                  "txt"
                ]
              }
            },
            "supportingFiles": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "tweaks": {
              "type": "array",
              "maxItems": 32,
              "description": "Structured live controls. replaceTemplate must contain literal {{value}}.",
              "items": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string"
                  },
                  "label": {
                    "type": "string"
                  },
                  "kind": {
                    "type": "string",
                    "enum": [
                      "color",
                      "text",
                      "number",
                      "select",
                      "boolean"
                    ]
                  },
                  "path": {
                    "type": "string"
                  },
                  "find": {
                    "type": "string"
                  },
                  "replaceTemplate": {
                    "type": "string"
                  },
                  "value": {
                    "type": "string"
                  },
                  "defaultValue": {
                    "type": "string"
                  },
                  "min": {
                    "type": "number"
                  },
                  "max": {
                    "type": "number"
                  },
                  "step": {
                    "type": "number"
                  },
                  "options": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  }
                },
                "required": [
                  "id",
                  "label",
                  "kind",
                  "path",
                  "find",
                  "replaceTemplate"
                ]
              }
            },
            "designSystemId": {
              "type": "string"
            },
            "status": {
              "type": "string",
              "enum": [
                "streaming",
                "complete",
                "error"
              ]
            },
            "revision": {
              "type": "integer"
            }
          },
          "required": [
            "id",
            "kind",
            "title",
            "entry",
            "renderer"
          ]
        },
        "briefId": {
          "type": "string",
          "description": "Optional when the thread is linked to a brief."
        }
      },
      "required": [
        "manifest"
      ]
    },
    owningCapability: 'subdesign-workflow',
  },
  design_artifact_patch: {
    description: "Apply a bounded in-place text patch to an already registered SubDesign artifact file.",
    keywords: ["artifact patch","tweak artifact","edit artifact","in place","原地調整","微調"],
    parameters: {
      "type": "object",
      "properties": {
        "artifactId": {
          "type": "string",
          "description": "Registered SubDesign artifact id"
        },
        "operations": {
          "type": "array",
          "maxItems": 12,
          "description": "Exact bounded replacements. Paths must already belong to the artifact.",
          "items": {
            "type": "object",
            "properties": {
              "path": {
                "type": "string",
                "description": "Existing artifact entry or supporting file"
              },
              "find": {
                "type": "string",
                "description": "Exact text to replace"
              },
              "replace": {
                "type": "string",
                "description": "Replacement text"
              },
              "expectedMatches": {
                "type": "integer",
                "minimum": 1,
                "maximum": 12,
                "default": 1
              }
            },
            "required": [
              "path",
              "find",
              "replace"
            ]
          }
        }
      },
      "required": [
        "artifactId",
        "operations"
      ]
    },
    owningCapability: 'subdesign-workflow',
  },
  design_artifact_tweak: {
    description: "Apply one declared structured live-control tweak to an already registered artifact.",
    keywords: ["artifact tweak","structured tweak","live tweak","parameter","color control","即時調參"],
    parameters: {
      "type": "object",
      "properties": {
        "artifactId": {
          "type": "string",
          "description": "Registered SubDesign artifact id"
        },
        "tweakId": {
          "type": "string",
          "description": "Declared structured tweak id"
        },
        "value": {
          "type": "string",
          "description": "New value; validated against the tweak kind and bounds"
        }
      },
      "required": [
        "artifactId",
        "tweakId",
        "value"
      ]
    },
    owningCapability: 'subdesign-workflow',
  },
  design_artifact_capture: {
    description: "Capture a sandboxed screenshot or DOM snapshot for a registered SubDesign artifact.",
    keywords: ["artifact screenshot","capture artifact","DOM evidence","screenshot evidence","截圖","證據"],
    parameters: {
      "type": "object",
      "properties": {
        "artifactId": {
          "type": "string",
          "description": "Registered SubDesign artifact id"
        },
        "kind": {
          "type": "string",
          "enum": [
            "screenshot",
            "dom"
          ]
        },
        "viewport": {
          "type": "object",
          "properties": {
            "width": {
              "type": "integer",
              "minimum": 320,
              "maximum": 2400,
              "default": 1440
            },
            "height": {
              "type": "integer",
              "minimum": 240,
              "maximum": 1800,
              "default": 900
            }
          }
        }
      },
      "required": [
        "artifactId",
        "kind"
      ]
    },
    owningCapability: 'subdesign-workflow',
    alsoListedIn: ["design-critique"],
  },
  design_artifact_lint: {
    description: "Run deterministic semantic lint against the registered artifact and create attested lint evidence.",
    keywords: ["artifact lint","semantic lint","accessibility lint","evidence lint","語意檢查"],
    parameters: {
      "type": "object",
      "properties": {
        "artifactId": {
          "type": "string",
          "description": "Registered SubDesign artifact id"
        }
      },
      "required": [
        "artifactId"
      ]
    },
    owningCapability: 'subdesign-workflow',
    alsoListedIn: ["design-critique"],
  },
  design_critique_note: {
    description: "Record one panelist-focused critique note (visual/brand, accessibility, or implementation readiness) during a Critique Theater round.",
    keywords: ["critique panelist","critique round","panelist note","visual review","accessibility review","implementation readiness","cross-check"],
    parameters: {
      "type": "object",
      "properties": {
        "artifactId": {
          "type": "string",
          "description": "Registered SubDesign artifact id"
        },
        "panelistId": {
          "type": "string",
          "enum": [
            "visual",
            "accessibility",
            "implementation"
          ],
          "description": "Which panelist focus this note represents"
        },
        "round": {
          "type": "integer",
          "enum": [
            1,
            2
          ],
          "description": "1 = independent review, 2 = cross-check of round-1 blockers"
        },
        "score": {
          "type": "integer",
          "minimum": 0,
          "maximum": 100,
          "description": "This panelist's focused 0-100 score for this round"
        },
        "summary": {
          "type": "string",
          "description": "One or two sentence assessment specific to this panelist focus; must differ in reasoning from the other panelists, not restate the same text"
        },
        "findings": {
          "type": "array",
          "maxItems": 20,
          "items": {
            "type": "object",
            "properties": {
              "severity": {
                "type": "string",
                "enum": [
                  "blocker",
                  "warning",
                  "note"
                ]
              },
              "message": {
                "type": "string"
              },
              "path": {
                "type": "string"
              }
            },
            "required": [
              "severity",
              "message"
            ]
          }
        },
        "evidence": {
          "type": "array",
          "maxItems": 10,
          "description": "Evidence this panelist relied on (screenshot/dom/lint); round 2 or the final design_critique call may reuse the same entries.",
          "items": {
            "type": "object",
            "properties": {
              "kind": {
                "type": "string",
                "enum": [
                  "screenshot",
                  "dom",
                  "lint",
                  "build",
                  "manual",
                  "template-attribution",
                  "design-system",
                  "asset-license"
                ]
              },
              "summary": {
                "type": "string"
              },
              "path": {
                "type": "string"
              },
              "capturedAt": {
                "type": "string"
              }
            },
            "required": [
              "kind",
              "summary"
            ]
          }
        }
      },
      "required": [
        "artifactId",
        "panelistId",
        "round",
        "score",
        "summary"
      ]
    },
    owningCapability: 'subdesign-workflow',
    alsoListedIn: ["design-critique"],
  },
  design_critique: {
    description: "Record a structured read-only critique for a SubDesign artifact.",
    keywords: ["design critique","critique artifact","accessibility review","brand conformance","brief coverage","verdict"],
    parameters: {
      "type": "object",
      "properties": {
        "critique": {
          "type": "object",
          "properties": {
            "artifactId": {
              "type": "string"
            },
            "briefId": {
              "type": "string"
            },
            "briefCoverage": {
              "type": "integer",
              "minimum": 0,
              "maximum": 100
            },
            "brandConformance": {
              "type": "integer",
              "minimum": 0,
              "maximum": 100
            },
            "accessibility": {
              "type": "integer",
              "minimum": 0,
              "maximum": 100
            },
            "implementationReadiness": {
              "type": "integer",
              "minimum": 0,
              "maximum": 100
            },
            "evidence": {
              "type": "array",
              "maxItems": 30,
              "description": "Required evidence for delivery: screenshot, dom, and lint entries.",
              "items": {
                "type": "object",
                "properties": {
                  "kind": {
                    "type": "string",
                    "enum": [
                      "screenshot",
                      "dom",
                      "lint",
                      "build",
                      "manual",
                      "template-attribution",
                      "design-system",
                      "asset-license"
                    ]
                  },
                  "summary": {
                    "type": "string"
                  },
                  "path": {
                    "type": "string"
                  },
                  "capturedAt": {
                    "type": "string"
                  }
                },
                "required": [
                  "kind",
                  "summary"
                ]
              }
            },
            "findings": {
              "type": "array",
              "maxItems": 40,
              "items": {
                "type": "object",
                "properties": {
                  "severity": {
                    "type": "string",
                    "enum": [
                      "blocker",
                      "warning",
                      "note"
                    ]
                  },
                  "message": {
                    "type": "string"
                  },
                  "path": {
                    "type": "string"
                  }
                },
                "required": [
                  "severity",
                  "message"
                ]
              }
            },
            "verdict": {
              "type": "string",
              "enum": [
                "pass",
                "needs-revision"
              ]
            }
          },
          "required": [
            "artifactId",
            "briefCoverage",
            "brandConformance",
            "accessibility",
            "implementationReadiness",
            "evidence",
            "findings",
            "verdict"
          ]
        }
      },
      "required": [
        "critique"
      ]
    },
    owningCapability: 'subdesign-workflow',
    alsoListedIn: ["design-critique"],
  },
  design_artifact_export: {
    description: "Export a validated SubDesign artifact as HTML, PDF, PPTX, MP4, or ZIP after user approval.",
    keywords: ["export artifact","export design","download prototype","pdf","pptx","mp4","zip","deliver artifact"],
    parameters: {
      "type": "object",
      "properties": {
        "artifactId": {
          "type": "string",
          "description": "Registered SubDesign artifact id"
        },
        "format": {
          "type": "string",
          "enum": [
            "html",
            "pdf",
            "zip",
            "pptx",
            "mp4"
          ]
        },
        "briefId": {
          "type": "string"
        }
      },
      "required": [
        "artifactId",
        "format"
      ]
    },
    owningCapability: 'subdesign-workflow',
  },
} as const satisfies Record<string, ToolDefinition>

export type ToolName = keyof typeof TOOL_DEFINITIONS

/** Tools owned by (or also-listed in) a capability — derived view. */
export function toolsForCapability(capabilityId: BuiltinCapabilityId): ToolName[] {
  const out: ToolName[] = []
  for (const [name, def] of Object.entries(TOOL_DEFINITIONS) as [ToolName, ToolDefinition][]) {
    if (def.owningCapability === capabilityId || def.alsoListedIn?.includes(capabilityId)) {
      out.push(name)
    }
  }
  return out
}

/** Catalog view for keyword routing / OpenAI defs. */
export function toolCatalogEntries(): { name: ToolName; description: string; keywords: string[] }[] {
  return (Object.entries(TOOL_DEFINITIONS) as [ToolName, ToolDefinition][]).map(([name, def]) => ({
    name,
    description: def.description,
    keywords: [...def.keywords],
  }))
}

/** Parameter schema view. */
export function toolParameters(): Record<ToolName, Record<string, unknown>> {
  const out = {} as Record<ToolName, Record<string, unknown>>
  for (const [name, def] of Object.entries(TOOL_DEFINITIONS) as [ToolName, ToolDefinition][]) {
    out[name] = def.parameters as Record<string, unknown>
  }
  return out
}
