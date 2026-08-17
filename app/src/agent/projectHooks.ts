/**
 * 專案級 hooks(G7,grok folder-trust 語意)。
 *
 * 專案可在 `<root>/.subagents/hooks.json` 宣告 hook 規則(格式同
 * settings.hookRules,或 `{ "rules": [...] }` 包裝)。安全模型:
 *
 * - 未信任的專案「靜默跳過」(防不明 repo 的供應鏈攻擊,grok 同款);
 *   信任清單存 settings.trustedHookProjects,在 Settings →「安全」管理
 * - 與 plugin hooks 相同走 sanitizeHookRules,只能限制/觀察,
 *   永遠不能放寬核准政策
 *
 * 已知限制:cache 以「最近 hydrate 的專案」為 active —— 並行 run 指向
 * 不同專案時,後 hydrate 者生效。hooks 只能 restrict/observe,
 * 最壞情況是多印稽核行,不會放寬權限。
 */

import type { LlmSettings } from './types.ts'
import { sanitizeHookRules, type HookRule } from './hooks.ts'

export const PROJECT_HOOKS_FILE = '.subagents/hooks.json'

let activeRoot = ''
const cache = new Map<string, HookRule[]>()

export function isProjectHooksTrusted(
  settings: Pick<LlmSettings, 'trustedHookProjects'>,
  projectRoot: string | undefined,
): boolean {
  const root = (projectRoot || '').trim()
  return Boolean(root && (settings.trustedHookProjects || []).includes(root))
}

/**
 * Run 開始時 hydrate(coordinator beforeRun);之後 collectHookRules
 * 以同步方式讀 cache。重複 hydrate 同一 root 直接命中 cache。
 */
export async function hydrateProjectHooks(
  settings: Pick<LlmSettings, 'trustedHookProjects'>,
  projectRoot?: string,
): Promise<{ loaded: number; skipped?: string }> {
  const root = (projectRoot || '').trim()
  activeRoot = root
  if (!root) return { loaded: 0, skipped: 'no-project' }
  const cached = cache.get(root)
  if (cached) return { loaded: cached.length }
  if (!isProjectHooksTrusted(settings, root)) {
    cache.set(root, [])
    return { loaded: 0, skipped: 'untrusted' }
  }
  const read = window.subagents?.tools?.workspaceRead
  if (!read) {
    cache.set(root, [])
    return { loaded: 0, skipped: 'browser-mode' }
  }
  try {
    const r = await read(PROJECT_HOOKS_FILE, root)
    if (!r.ok || !r.content?.trim()) {
      cache.set(root, [])
      return { loaded: 0, skipped: 'missing' }
    }
    const parsed = JSON.parse(r.content) as unknown
    const raw = Array.isArray(parsed)
      ? parsed
      : (parsed as { rules?: unknown })?.rules
    const rules = sanitizeHookRules(raw, 'project')
    cache.set(root, rules)
    return { loaded: rules.length }
  } catch (e) {
    cache.set(root, [])
    return { loaded: 0, skipped: e instanceof Error ? e.message : String(e) }
  }
}

/** 同步供 collectHookRules 合併;僅回傳最近 hydrate 的專案規則。 */
export function activeProjectHookRules(): HookRule[] {
  return activeRoot ? cache.get(activeRoot) || [] : []
}

/** Settings 變更信任清單後讓 cache 失效。 */
export function invalidateProjectHooks(projectRoot?: string): void {
  if (projectRoot) cache.delete(projectRoot.trim())
  else cache.clear()
}

/** 測試隔離用。 */
export function resetProjectHooks(): void {
  cache.clear()
  activeRoot = ''
}
