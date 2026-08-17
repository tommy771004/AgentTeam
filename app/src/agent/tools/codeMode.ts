/**
 * CodeMode (Pydantic AI 2.0 style) — run model-written JavaScript that
 * batches many tool calls into ONE function-calling round.
 *
 * The code runs inside a Web Worker (no DOM / window / preload access).
 * Tool calls are RPC-bridged back to the main thread, where each call goes
 * through the same capability gate + HITL authorization as a direct call.
 */

import type { OpenAiToolDef } from './schemas.ts'
import { RUN_CODE_TOOL } from '../capabilities/builtins.ts'

export interface CodeModeResult {
  ok: boolean
  output: string
  toolCallCount: number
  logs: string[]
  durationMs: number
}

export interface CodeModeOpts {
  /** Bridge one inner tool call (already model-visible tools only). */
  callTool: (name: string, args: Record<string, unknown>) => Promise<{ ok: boolean; output: string }>
  timeoutMs?: number
  maxToolCalls?: number
  onLog?: (message: string) => void
}

/** Tools never callable from inside run_code. */
const CODE_MODE_BLOCKED = new Set([RUN_CODE_TOOL, 'delegate_task', 'load_capability', 'tool_search'])

const WORKER_SOURCE = `
// Force all network through tools.http_fetch (supervisor + audit), not raw fetch
try { self.fetch = undefined; } catch (_) {}
try { self.XMLHttpRequest = undefined; } catch (_) {}
try { self.WebSocket = undefined; } catch (_) {}
const pending = new Map();
let seq = 0;
self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'run') {
    const logs = [];
    const log = (...a) => {
      logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
    };
    const tools = new Proxy({}, {
      get: (_t, name) => (args) => new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        self.postMessage({ type: 'tool_call', id, name: String(name), args: args || {} });
      }),
    });
    try {
      const fn = new Function('tools', 'log', '"use strict"; return (async () => {\\n' + msg.code + '\\n})()');
      const result = await fn(tools, log);
      const out = typeof result === 'string' ? result : JSON.stringify(result ?? null, null, 2);
      self.postMessage({ type: 'done', result: out, logs });
    } catch (err) {
      self.postMessage({ type: 'error', error: String((err && err.message) || err), logs });
    }
  } else if (msg.type === 'tool_result') {
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.output);
      else p.reject(new Error(msg.output));
    }
  }
};
`

export async function runCodeMode(code: string, opts: CodeModeOpts): Promise<CodeModeResult> {
  const started = Date.now()
  const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? 90_000, 5_000), 300_000)
  const maxToolCalls = Math.min(Math.max(opts.maxToolCalls ?? 25, 1), 100)

  if (!code.trim()) {
    return { ok: false, output: 'run_code requires non-empty code.', toolCallCount: 0, logs: [], durationMs: 0 }
  }
  if (typeof Worker === 'undefined') {
    return {
      ok: false,
      output: 'CodeMode unavailable: Worker not supported in this environment.',
      toolCallCount: 0,
      logs: [],
      durationMs: 0,
    }
  }

  const blobUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'application/javascript' }))
  const worker = new Worker(blobUrl)
  let toolCallCount = 0

  try {
    return await new Promise<CodeModeResult>((resolve) => {
      const finish = (r: Omit<CodeModeResult, 'durationMs' | 'toolCallCount'>) => {
        clearTimeout(timer)
        worker.terminate()
        resolve({ ...r, toolCallCount, durationMs: Date.now() - started })
      }
      const timer = setTimeout(() => {
        finish({ ok: false, output: `run_code timed out after ${timeoutMs}ms (worker terminated).`, logs: [] })
      }, timeoutMs)

      worker.onerror = (e) => {
        finish({ ok: false, output: `run_code worker error: ${e.message || 'unknown'}`, logs: [] })
      }
      worker.onmessage = async (e: MessageEvent) => {
        const msg = e.data as
          | { type: 'tool_call'; id: number; name: string; args: Record<string, unknown> }
          | { type: 'done'; result: string; logs: string[] }
          | { type: 'error'; error: string; logs: string[] }
        if (msg.type === 'done') {
          finish({ ok: true, output: msg.result, logs: msg.logs })
          return
        }
        if (msg.type === 'error') {
          finish({ ok: false, output: `run_code failed: ${msg.error}`, logs: msg.logs })
          return
        }
        // tool_call RPC
        let ok = false
        let output = ''
        if (CODE_MODE_BLOCKED.has(msg.name)) {
          output = `Tool «${msg.name}» is not callable from run_code.`
        } else if (toolCallCount >= maxToolCalls) {
          output = `run_code tool budget exhausted (${maxToolCalls}).`
        } else {
          toolCallCount++
          opts.onLog?.(`run_code → tools.${msg.name}(${JSON.stringify(msg.args).slice(0, 120)})`)
          try {
            const r = await opts.callTool(msg.name, msg.args)
            ok = r.ok
            output = r.output
          } catch (err) {
            output = err instanceof Error ? err.message : String(err)
          }
        }
        worker.postMessage({ type: 'tool_result', id: msg.id, ok, output: output.slice(0, 16_000) })
      }

      worker.postMessage({ type: 'run', code })
    })
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}

/** OpenAI tool def for run_code (visible when code-mode capability is active). */
export function runCodeToolDef(availableTools: string[]): OpenAiToolDef {
  return {
    type: 'function',
    function: {
      name: RUN_CODE_TOOL,
      description:
        'Execute JavaScript in a sandboxed worker to batch many tool calls into one round (loops, filtering, aggregation). Call tools as `await tools.<name>({...})` (returns string). Use `log(...)` for notes; return the final result. Requires human approval.',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: `Async JS body. Available tools: ${availableTools.slice(0, 40).join(', ') || '(loaded capability tools)'}. Example: const r = await tools.web_search({ query: 'x' }); return r.slice(0, 500);`,
          },
          timeoutMs: { type: 'integer', description: 'Max total run time (default 90000, cap 300000)' },
        },
        required: ['code'],
      },
    },
  }
}
