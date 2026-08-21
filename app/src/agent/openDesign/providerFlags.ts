/**
 * Experimental provider feature flags — all off by default.
 * Enables qualified evaluation without committing product to unstable upstreams.
 */
export type ProviderFlag = 'storybook' | 'chrome-devtools' | 'harness' | 'mcp-apps' | 'streaming'

const DEFAULTS: Record<ProviderFlag, boolean> = {
  storybook: false,
  'chrome-devtools': false,
  harness: false,
  'mcp-apps': false,
  streaming: false,
}

let overrides: Partial<Record<ProviderFlag, boolean>> = {}

export function isProviderEnabled(flag: ProviderFlag): boolean {
  return overrides[flag] ?? DEFAULTS[flag]
}

export function setProviderFlag(flag: ProviderFlag, enabled: boolean): void {
  overrides[flag] = enabled
}

export function resetProviderFlags(): void {
  overrides = {}
}

export function providerFlagDescription(flag: ProviderFlag): string {
  switch (flag) {
    case 'storybook':
      return 'Storybook component context provider（實驗性，需 pinned version 與 feature flag）'
    case 'chrome-devtools':
      return 'Chrome DevTools critique evidence（pinned browser target，僅 via Pi Core）'
    case 'harness':
      return 'Harness goal-based UX testing（alpha，macOS 限定，需權限說明）'
    case 'mcp-apps':
      return 'MCP Apps interactive surfaces（sandbox iframe + schema-validated bridge）'
    case 'streaming':
      return 'Streaming artifact envelope（product-owned，renderer 需聲明能力）'
  }
}
