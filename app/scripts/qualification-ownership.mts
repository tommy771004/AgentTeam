export type QualificationCategory = 'deletion-ownership' | 'public-api' | 'runtime-behavior'

/** One-hop map from a release-hardening contract to its owning qualification. */
export const QUALIFICATION_OWNERSHIP: ReadonlyArray<{
  id: string
  category: QualificationCategory
  qualification: string
}> = [
  { id: 'single-task-ingress', category: 'deletion-ownership', qualification: 'scripts/smoke-task-run-ingress.mts' },
  { id: 'pi-production-owner', category: 'deletion-ownership', qualification: 'scripts/smoke-pi-production-owners.mts' },
  { id: 'pi-protocol-domains', category: 'deletion-ownership', qualification: 'scripts/check-pi-contract.mts' },
  { id: 'retired-renderer-paths', category: 'deletion-ownership', qualification: 'scripts/check-pi-contract.mts' },
  { id: 'task-admission-api', category: 'public-api', qualification: 'scripts/smoke-task-run-admission-prefactor.mts' },
  { id: 'pi-turn-routing-api', category: 'public-api', qualification: 'scripts/smoke-pi-host-turn-routing-prefactor.mts' },
  { id: 'external-cli-parser-api', category: 'public-api', qualification: 'scripts/smoke-external-cli-provider-parsers.mts' },
  { id: 'startup-recovery-phase-api', category: 'public-api', qualification: 'scripts/smoke-startup-recovery-phases.mts' },
  { id: 'route-chunk-runtime', category: 'runtime-behavior', qualification: 'scripts/smoke-route-lazy-loading.mts' },
  { id: 'release-hardening-receipt', category: 'runtime-behavior', qualification: 'scripts/smoke-release-hardening-qualification.mts' },
  { id: 'release-hardening-readiness', category: 'runtime-behavior', qualification: 'scripts/smoke-release-hardening-rollup.mts' },
  { id: 'external-cli-settlement', category: 'runtime-behavior', qualification: 'scripts/smoke-external-cli-durable-harness.mts' },
  { id: 'electron-restart-recovery', category: 'runtime-behavior', qualification: 'scripts/smoke-recovery-e2e.mjs' },
  { id: 'platform-release-contract', category: 'runtime-behavior', qualification: 'scripts/smoke-platform.mts' },
] as const

/** Expensive subprocess/Electron qualifications must occur at most once per root gate. */
export const HEAVY_QUALIFICATIONS = [
  'smoke-external-cli-durable-harness.mts',
  'smoke-pi-electron-host-e2e.mjs',
  'smoke-recovery-e2e.mjs',
  'smoke-settings-lifecycle-e2e.mjs',
  'smoke-update-migration-e2e.mjs',
] as const

/** Expand every runtime path; only the active stack is cycle-protected so duplicate chains stay visible. */
export function expandQualificationScript(
  scripts: Readonly<Record<string, string>>,
  name: string,
  active: readonly string[] = [],
): string {
  if (active.includes(name)) throw new Error(`qualification script cycle: ${[...active, name].join(' -> ')}`)
  let body = scripts[name] || ''
  for (const ref of body.match(/npm run [A-Za-z0-9:_-]+/g) || []) {
    body += ` ${expandQualificationScript(scripts, ref.slice('npm run '.length), [...active, name])}`
  }
  return body
}
