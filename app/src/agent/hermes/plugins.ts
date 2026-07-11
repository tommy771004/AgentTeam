/**
 * Minimal plugin loader — Hermes edge philosophy:
 * capability lives at the edges, not by growing the core waist.
 *
 * Plugin JSON format (userData/plugins/*.json or localStorage):
 * {
 *   "id": "my-plugin",
 *   "name": "My Plugin",
 *   "version": "1.0.0",
 *   "enabled": true,
 *   "skills": [{ "path": "...", "raw": "---\nname: ...\n..." }],
 *   "promptAppend": "Extra system guidance..."
 * }
 */

import { skillsStore } from './skills'
import type { Skill } from './types'
import type { CustomToolDefinition } from '../types'

export interface PluginManifest {
  id: string
  name: string
  version?: string
  enabled: boolean
  description?: string
  skills?: Array<{ path: string; raw: string }>
  /** Appended to volatile prompt layer */
  promptAppend?: string
  /** Declarative edge tools. Handlers are constrained templates, never plugin JS. */
  customTools?: CustomToolDefinition[]
  /** @deprecated Optional demo tool aliases (name -> description only). */
  toolHints?: Array<{ name: string; description: string }>
}

export interface PluginLoadResult {
  plugins: PluginManifest[]
  skillsInjected: number
  promptFragments: string[]
}

const DEFAULT_EXAMPLE: PluginManifest = {
  id: 'example-edge',
  name: '範例外掛（Edge）',
  version: '1.0.0',
  enabled: false,
  description: '示範如何以 JSON 外掛注入技能與 prompt 片段（預設關閉）',
  skills: [
    {
      path: 'plugins/example/hello/SKILL.md',
      raw: `---
name: plugin-hello
description: 外掛示範技能：問候與狀態檢查。
version: 1.0.0
author: plugin
createdBy: user
tags: [plugin, demo]
---

# Plugin Hello Skill

## 何時使用
測試外掛系統是否載入成功。

## 流程
1. 用 \`datetime_now\` 取得時間。
2. 回覆「外掛技能可用」與時間戳。
`,
    },
  ],
  promptAppend: '（外掛 example-edge 已啟用：可使用 plugin-hello 技能。）',
  customTools: [
    {
      name: 'rss_fetch',
      description: 'Fetch an RSS or sitemap URL as text for later parsing.',
      kind: 'http_template',
      template: { method: 'GET', url: '{{url}}' },
      params: { url: { type: 'string', description: 'Public RSS or sitemap URL', required: true } },
    },
    {
      name: 'git_status_readonly',
      description: 'Show concise Git status for the selected project.',
      kind: 'bash_template',
      template: { command: 'git status --short --branch' },
      params: {},
      requiresApproval: true,
    },
  ],
}

class PluginRegistry {
  private plugins: PluginManifest[] = [{ ...DEFAULT_EXAMPLE }]

  list(): PluginManifest[] {
    return [...this.plugins]
  }

  loadFromArray(items: PluginManifest[]) {
    // Keep example, merge by id
    const map = new Map<string, PluginManifest>()
    map.set(DEFAULT_EXAMPLE.id, { ...DEFAULT_EXAMPLE })
    for (const p of items) {
      if (!p?.id) continue
      map.set(p.id, p)
    }
    this.plugins = [...map.values()]
  }

  setEnabled(id: string, enabled: boolean) {
    this.plugins = this.plugins.map((p) => (p.id === id ? { ...p, enabled } : p))
  }

  add(plugin: PluginManifest) {
    const rest = this.plugins.filter((p) => p.id !== plugin.id)
    this.plugins = [...rest, plugin]
  }

  remove(id: string) {
    if (id === DEFAULT_EXAMPLE.id) {
      this.setEnabled(id, false)
      return
    }
    this.plugins = this.plugins.filter((p) => p.id !== id)
  }

  /** Apply enabled plugins: inject skills + collect prompt fragments */
  apply(): PluginLoadResult {
    let skillsInjected = 0
    const promptFragments: string[] = []
    for (const p of this.plugins) {
      if (!p.enabled) continue
      if (p.skills?.length) {
        skillsStore.loadAll(p.skills)
        skillsInjected += p.skills.length
      }
      if (p.promptAppend?.trim()) {
        promptFragments.push(`### 外掛：${p.name}\n${p.promptAppend.trim()}`)
      }
    }
    return {
      plugins: this.list(),
      skillsInjected,
      promptFragments,
    }
  }

  exportAll(): PluginManifest[] {
    return this.list()
  }

  getEnabledSkills(): Skill[] {
    this.apply()
    return skillsStore.list()
  }
}

export const pluginRegistry = new PluginRegistry()
