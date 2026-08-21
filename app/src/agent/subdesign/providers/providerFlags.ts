/**
 * Experimental SubDesign surfaces that have no project settings record of
 * their own — all off by default.
 *
 * Storybook / Chrome DevTools / Harness are NOT here: each is gated by its
 * persisted `providerConfig.enabled`, checked by its `*Availability()` in the
 * Host adapter. Keeping a second flag for them meant two gates disagreeing,
 * with the flag one dead outside smokes.
 *
 * Off by default, and turned on per project through the same persisted
 * provider-settings record as everything else (`ExperimentalSurfaceSettings`),
 * surfaced by `ExperimentalSurfaceControl`. `hydrateProviderFlags` applies that
 * record once when a project binds, so `isProviderEnabled` can stay synchronous
 * for render paths.
 *
 * Renderer-only by design: Pi Host must not import this module. Host-side
 * gating belongs to `providerConfig.enabled` on the frozen request, so a
 * renderer flag can never widen what the Host is willing to execute.
 */
export type ProviderFlag = 'mcp-apps' | 'streaming'

const DEFAULTS: Record<ProviderFlag, boolean> = {
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

/** Apply a project's persisted experimental settings. Called on project bind. */
export function hydrateProviderFlags(settings: { mcpApps: boolean; streaming: boolean }): void {
  setProviderFlag('mcp-apps', settings.mcpApps)
  setProviderFlag('streaming', settings.streaming)
}

export function resetProviderFlags(): void {
  overrides = {}
}

/** User-visible support and degradation scope for each experimental surface (issue 09). */
export function providerFlagDescription(flag: ProviderFlag): string {
  switch (flag) {
    case 'mcp-apps':
      return 'MCP Apps interactive surfaces（sandbox iframe + schema-validated bridge；不可用時退回原生 UI）'
    case 'streaming':
      return 'Streaming artifact envelope（product-owned，renderer 需聲明能力；不支援時改用完成後預覽）'
  }
}
