/**
 * Settings sections — 單一真相（first-run honesty ticket 09）。
 *
 * 設定頁的節清單與 Command Registry 的設定錨點條目共用這份資料，
 * 避免 palette／深連結與設定頁漂移。policyAdmin 僅在 policy-admin
 * build 顯示（設定頁自行過濾；palette 條目見 registry 的排除）。
 */

export interface SettingsSectionDef {
  id: string
  label: string
  icon: string
  group: string
}

export const SETTINGS_SECTION_GROUPS: Array<{ id: string; label: string }> = [
  { id: 'personal', label: '個人' },
  { id: 'agent', label: '代理' },
  { id: 'integrate', label: '整合' },
  { id: 'system', label: '系統' },
]

export const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  { id: 'general', label: '一般', icon: 'tune', group: 'personal' },
  { id: 'appearance', label: '外觀', icon: 'palette', group: 'personal' },
  { id: 'personalization', label: '個人化', icon: 'person', group: 'personal' },
  { id: 'memory', label: '記憶', icon: 'psychology', group: 'personal' },
  { id: 'data', label: '資料控制', icon: 'database', group: 'personal' },
  { id: 'shortcuts', label: '鍵盤快捷鍵', icon: 'keyboard', group: 'personal' },
  { id: 'safety', label: '組態', icon: 'shield', group: 'agent' },
  { id: 'piCore', label: 'Pi Core', icon: 'hub', group: 'agent' },
  { id: 'policyAdmin', label: 'Policy Admin', icon: 'policy', group: 'agent' },
  { id: 'roles', label: '角色模型', icon: 'groups', group: 'agent' },
  { id: 'llm', label: '語言模型', icon: 'smart_toy', group: 'agent' },
  { id: 'cli', label: 'CLI 授權', icon: 'terminal', group: 'agent' },
  { id: 'opencode', label: 'OpenCode', icon: 'auto_awesome', group: 'agent' },
  { id: 'git', label: 'Git', icon: 'commit', group: 'integrate' },
  { id: 'webhook', label: 'Webhook', icon: 'webhook', group: 'integrate' },
  { id: 'gateway', label: '訊息閘道', icon: 'forum', group: 'integrate' },
  { id: 'mcp', label: 'MCP 伺服器', icon: 'extension', group: 'integrate' },
  { id: 'oauth', label: '外掛 OAuth', icon: 'key', group: 'integrate' },
  { id: 'updates', label: '安全更新', icon: 'system_update', group: 'system' },
  { id: 'bundle', label: '匯出匯入', icon: 'import_export', group: 'system' },
]

/** palette／深連結可用的設定節（排除 policy-admin build 專屬節） */
export function paletteSettingsSections(): SettingsSectionDef[] {
  return SETTINGS_SECTIONS.filter((section) => section.id !== 'policyAdmin')
}

export function settingsPath(sectionId: string): string {
  return `/settings?section=${encodeURIComponent(sectionId)}`
}
