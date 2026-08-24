import type { PiToolResult } from '../piToolHost.ts'

/**
 * Shared structured-result helpers for pack tools.
 *
 * Every pack tool answers in the same envelope: human-readable text for the
 * transcript, a JSON payload in `details` carrying `ok` and the facts. A
 * failure is CONTENT (`ok:false`), never a throw, so a failing tool can
 * never end a turn (issue 01).
 */

export function jsonOk(data: Record<string, unknown>): PiToolResult {
  // The text stays the bare payload: it is model-visible, and `ok` belongs to
  // `details`. Only a failure spells `ok:false` into the text, so the model
  // reads an error as an error without parsing a success flag every call.
  return { content: [{ type: 'text', text: JSON.stringify(data) }], details: { ok: true, ...data } }
}

export function structuredOk(text: string, data: Record<string, unknown> = {}): PiToolResult {
  // `ok:true` is stamped here rather than left to each caller: workspaceExtra
  // used to return raw `details`, so a successful move/delete/mkdir carried no
  // `ok` at all while every other pack's did. One envelope, one shape.
  return { content: [{ type: 'text', text }], details: { ok: true, ...data } }
}

export function structuredFailure(error: string): PiToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error }) }], details: { ok: false, error } }
}
