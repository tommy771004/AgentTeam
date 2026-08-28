import { mkdir, rm, symlink } from 'node:fs/promises'
import path from 'node:path'

const PI_BUILD_WORKSPACES = [
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
