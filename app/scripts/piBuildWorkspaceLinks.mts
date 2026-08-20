import { mkdir, rm, symlink } from 'node:fs/promises'
import path from 'node:path'

const PI_BUILD_WORKSPACES = [
  ['@earendil-works/pi-tui', 'packages/tui'],
  ['@earendil-works/pi-ai', 'packages/ai'],
  ['@earendil-works/pi-agent-core', 'packages/agent'],
  ['@earendil-works/pi-storage-sqlite-node', 'packages/storage/sqlite-node'],
  ['@earendil-works/pi-coding-agent', 'packages/coding-agent'],
  ['@earendil-works/pi-server', 'packages/server'],
] as const

/** Replace copied npm workspace junctions so every link resolves inside staging. */
export async function relinkPiBuildWorkspaces(stagingVendor: string): Promise<void> {
  for (const [packageName, workspacePath] of PI_BUILD_WORKSPACES) {
    const linkPath = path.join(stagingVendor, 'node_modules', ...packageName.split('/'))
    const targetPath = path.join(stagingVendor, workspacePath)
    await rm(linkPath, { recursive: true, force: true })
    await mkdir(path.dirname(linkPath), { recursive: true })
    await symlink(targetPath, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
  }
}
