import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { relinkPiBuildWorkspaces } from './piBuildWorkspaceLinks.mts'

const root = await mkdtemp(path.join(tmpdir(), 'pi-workspace-links-'))
try {
  const sourceVendor = path.join(root, 'source-pi')
  const stagingVendor = path.join(root, 'staging-pi')
  const externalAgent = path.join(sourceVendor, 'packages', 'agent')
  const stagingAgent = path.join(stagingVendor, 'packages', 'agent')
  const link = path.join(stagingVendor, 'node_modules', '@earendil-works', 'pi-agent-core')
  await mkdir(externalAgent, { recursive: true })
  for (const workspacePath of [
    'packages/tui',
    'packages/ai',
    'packages/agent',
    'packages/storage/sqlite-node',
    'packages/coding-agent',
    'packages/server',
  ]) await mkdir(path.join(stagingVendor, workspacePath), { recursive: true })
  await mkdir(path.dirname(link), { recursive: true })
  await symlink(externalAgent, link, process.platform === 'win32' ? 'junction' : 'dir')

  await relinkPiBuildWorkspaces(stagingVendor)

  assert.equal(await realpath(link), await realpath(stagingAgent))
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('Pi staging workspace links remain inside the isolated build tree')
