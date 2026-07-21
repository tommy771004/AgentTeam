/**
 * Fail the package build when SUBAGENTS_BUILD_FLAVOR is unknown.
 * Allowed: unset | standard | policy-admin
 *
 * Run: node --experimental-strip-types scripts/check-build-flavor.mts
 */
import { parseBuildFlavorStrict } from '../src/agent/outbound/policyAdmin.ts'

try {
  const flavor = parseBuildFlavorStrict(process.env.SUBAGENTS_BUILD_FLAVOR)
  console.log(`build-flavor: ${flavor}`)
  process.exit(0)
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
}
