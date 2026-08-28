import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { relinkPiBuildWorkspaces } from './piBuildWorkspaceLinks.mts'

const root = await mkdtemp(path.join(tmpdir(), 'pi-workspace-links-'))
try {
  const sourceVendor = path.join(root, 'source-pi')
  const stagingVendor = path.join(root, 'staging-pi')
  const workspaces = [
    ['@earendil-works/pi-tui', 'packages/tui'],
    ['@earendil-works/pi-telemetry', 'packages/telemetry'],
    ['@earendil-works/pi-ai', 'packages/ai'],
    ['@earendil-works/pi-agent-core', 'packages/agent'],
    ['@earendil-works/pi-session-backend-sqlite-node', 'packages/session-backends/sqlite-node'],
    ['@earendil-works/pi-protocol', 'packages/protocol'],
    ['@earendil-works/pi-client', 'packages/client'],
    ['@earendil-works/pi-server', 'packages/server'],
    ['@earendil-works/pi-coding-agent', 'packages/coding-agent'],
  ] as const
  for (const [packageName, workspacePath] of workspaces) {
    const externalWorkspace = path.join(sourceVendor, workspacePath)
    const link = path.join(stagingVendor, 'node_modules', ...packageName.split('/'))
    await mkdir(externalWorkspace, { recursive: true })
    await mkdir(path.join(stagingVendor, workspacePath), { recursive: true })
    await mkdir(path.dirname(link), { recursive: true })
    await symlink(externalWorkspace, link, process.platform === 'win32' ? 'junction' : 'dir')
  }

  await relinkPiBuildWorkspaces(stagingVendor)

  for (const [packageName, workspacePath] of workspaces) {
    const link = path.join(stagingVendor, 'node_modules', ...packageName.split('/'))
    assert.equal(await realpath(link), await realpath(path.join(stagingVendor, workspacePath)))
  }
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('Pi staging workspace links remain inside the isolated build tree')
