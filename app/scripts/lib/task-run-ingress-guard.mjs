import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

export const taskRunIngressFiles = [
  'src/App.tsx',
  'src/hooks/useSlashExecutor.ts',
  'src/pages/ProtocolsPage.tsx',
  'src/pages/OpsPage.tsx',
  'src/pages/FailedPage.tsx',
  'src/pages/RecordsPage.tsx',
  'src/pages/SuccessPage.tsx',
  'src/pages/SubDesignPage.tsx',
  'src/components/InlineRunPanel.tsx',
  'src/components/RunContinuationActions.tsx',
  'src/components/subdesign/CritiqueTheater.tsx',
  'src/agent/subdesign/workspaceIntegration.ts',
  'src/agent/hostAgentQueuePump.ts',
]

export function assertCanonicalTaskRunIngress(appRoot) {
  for (const relativePath of taskRunIngressFiles) {
    const source = fs.readFileSync(path.join(appRoot, relativePath), 'utf8')
    assert.doesNotMatch(source, /dispatchThreadTask\s*\(/, `${relativePath} must enter through runTask`)
    assert.doesNotMatch(
      source,
      /startExecution\s*\(|startLocalCliExecution\s*\(/,
      `${relativePath} must not enter a runner adapter directly`,
    )
  }

  const coordinator = fs.readFileSync(path.join(appRoot, 'src/agent/taskRunCoordinator.ts'), 'utf8')
  assert.match(coordinator, /export async function runTask\s*\(/, 'taskRunCoordinator must export the canonical runTask ingress')
  assert.match(coordinator, /dispatchThreadTask\(snapshot\)/, 'only the coordinator may dispatch an admitted Task')
}
