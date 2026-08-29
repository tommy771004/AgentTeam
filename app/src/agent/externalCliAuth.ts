/** Pure parsers for provider-owned, non-model authentication status probes. */

export type AuthStatusProbe = Readonly<{
  status: number | null
  stdout: string
  stderr: string
}>

/** Codex may write the human-readable login status to either output stream. */
export function parseCodexLoginStatus(probe: AuthStatusProbe): boolean {
  const combined = `${probe.stdout}\n${probe.stderr}`
  return probe.status === 0 && /logged in/i.test(combined)
}

/** Claude auth status is JSON; a successful command with no boolean is not proof. */
export function parseClaudeAuthStatus(probe: AuthStatusProbe): boolean {
  if (probe.status !== 0) return false
  try {
    const value = JSON.parse(probe.stdout) as { loggedIn?: unknown }
    return value.loggedIn === true
  } catch {
    return false
  }
}
