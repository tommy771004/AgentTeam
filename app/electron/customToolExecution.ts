import fs from 'node:fs'
import path from 'node:path'
import { runBash } from './shellBridge'
import {
  hasSecretPlaceholder,
  redactSecretValues,
  resolveSecretPlaceholders,
} from './secretsVault'
import type { ResolvedCustomTool } from '../src/agent/tools/customTools.ts'

export type BashTemplateInput = { command: string; cwd?: string; timeoutMs?: number; runId?: string }
export type HttpTemplateInput = { url: string; method?: string; headers?: Record<string, string>; body?: string; maxChars?: number }

const TEMPLATE_TOKEN = /{{\s*(secret:)?([A-Za-z0-9_.-]+)\s*}}/g

function materialize(value: string | undefined, input: Record<string, unknown>): string {
  return (value || '').replace(TEMPLATE_TOKEN, (_all, secretPrefix: string | undefined, key: string) => {
    if (secretPrefix) return `{{secret:${key}}}`
    const candidate = input[key]
    if ((candidate == null || candidate === '') && key === 'state') return 'open'
    if ((candidate == null || candidate === '') && key === 'path') return ''
    if ((candidate == null || candidate === '') && key === 'base_url') return 'http://homeassistant.local:8123'
    return candidate == null ? '' : String(candidate)
  })
}

function resolveText(text: string | undefined, missing: string[], usedSecrets: string[]): string | undefined {
  if (!text || !hasSecretPlaceholder(text)) return text
  const resolved = resolveSecretPlaceholders(text, usedSecrets)
  missing.push(...resolved.missing)
  return resolved.text
}

export async function executeBashTemplate(input: BashTemplateInput, defaultCwd: string) {
  const usedSecrets: string[] = []
  const resolved = resolveSecretPlaceholders(input.command, usedSecrets)
  if (resolved.missing.length) {
    return { ok: false, stdout: '', stderr: `缺少 secret：${[...new Set(resolved.missing)].join(', ')}`, code: 1 }
  }
  let cwd = input.cwd
  if (cwd && !path.isAbsolute(cwd)) cwd = path.resolve(defaultCwd, cwd)
  if (!cwd || !fs.existsSync(cwd)) cwd = defaultCwd
  try {
    return redactSecretValues(await runBash({ ...input, command: resolved.text, cwd }), usedSecrets)
  } catch (error) {
    return redactSecretValues({
      ok: false,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      code: 1,
    }, usedSecrets)
  }
}

export async function executeHttpTemplate(input: HttpTemplateInput) {
  const usedSecrets: string[] = []
  const missing: string[] = []
  try {
    const urlText = resolveText(input.url, missing, usedSecrets) || input.url
    const headers = Object.fromEntries(Object.entries(input.headers || {}).map(([key, value]) => [
      key, resolveText(value, missing, usedSecrets) ?? value,
    ]))
    const body = resolveText(input.body, missing, usedSecrets)
    if (missing.length) {
      return { ok: false, text: `缺少 secret：${[...new Set(missing)].join(', ')} — 請在 Marketplace 授權或 Settings 補填`, status: 0 }
    }
    const url = new URL(urlText)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http(s) URLs allowed')
    const response = await fetch(url, { method: input.method || 'GET', headers, body, redirect: 'follow' })
    return redactSecretValues({
      ok: response.ok,
      text: (await response.text()).slice(0, Math.min(Number(input.maxChars) || 50_000, 200_000)),
      status: response.status,
    }, usedSecrets)
  } catch (error) {
    return redactSecretValues({ ok: false, text: error instanceof Error ? error.message : String(error), status: 0 }, usedSecrets)
  }
}

/** Pi Host service target: the Host selects a configured tool, main only performs OS/network execution. */
export async function executeConfiguredCustomTool(
  tool: ResolvedCustomTool,
  input: Record<string, unknown>,
  defaultCwd: string,
): Promise<{ ok: boolean; output: string; data?: unknown }> {
  if (tool.kind === 'bash_template') {
    const result = await executeBashTemplate({ command: materialize(tool.template.command, input), cwd: defaultCwd, timeoutMs: 60_000 }, defaultCwd)
    return {
      ok: result.ok,
      output: [result.stdout && `stdout:\n${result.stdout}`, result.stderr && `stderr:\n${result.stderr}`, `exit=${result.code}`].filter(Boolean).join('\n'),
      data: result,
    }
  }
  const result = await executeHttpTemplate({
    url: materialize(tool.template.url, input),
    method: tool.template.method || 'GET',
    headers: Object.fromEntries(Object.entries(tool.template.headers || {}).map(([key, value]) => [key, materialize(value, input)])),
    body: tool.template.body ? materialize(tool.template.body, input) : undefined,
    maxChars: 50_000,
  })
  return { ok: result.ok, output: result.text, data: result }
}
