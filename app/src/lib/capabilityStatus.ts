/**
 * User-facing capability status for task-first UX (no MCP jargon).
 */

/** Hide engineering jargon in marketplace kind labels */
export function installKindUserLabel(kind: string): string {
  if (kind === 'npm-mcp') return '進階工具包'
  if (kind === 'connector') return '連線授權'
  if (kind === 'bundled') return '內建能力'
  return kind
}

export function softTipUserFacing(tip: string | null): string | null {
  if (!tip) return null
  return tip
    .replace(/\bMCP\b/g, '進階工具')
    .replace(/connector/gi, '連線')
    .replace(/GITHUB_TOKEN|環境變數/g, '授權')
    .replace(/token 會自動注入/gi, '授權後即可使用')
}
