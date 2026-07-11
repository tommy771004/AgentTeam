import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  PLUGIN_CATALOG,
  catalogItem,
  type PluginCatalogItem,
} from '../src/agent/hermes/pluginCatalog'
import { MCP_SECRET_ENV_KEYS } from '../src/agent/hermes/mcpSecrets'
import type { PluginManifest } from '../src/agent/hermes/plugins'
import { mcpStdioListTools, mcpStdioStop } from './mcpBridge'
import {
  isPathInside,
  spawnCommandSpec,
  terminateProcessTree,
} from './platformProcess'

const MAX_LOG_CHARS = 24_000
const INSTALL_TIMEOUT_MS = 300_000
const PLUGIN_ID = /^[a-z0-9][a-z0-9-]{0,63}$/
let configuredPluginDir: string | null = null

type PluginMcpServer = {
  id: string
  name: string
  enabled: boolean
  transport: 'stdio'
  command: string
  args: string[]
  env?: Record<string, string>
  /** Package ownership (e.g. github-mcp) */
  pluginId: string
  /** Token ownership (e.g. github-connector) — may differ from pluginId */
  secretPluginId?: string
}

type InstalledManifest = PluginManifest & Record<string, unknown>

export function validatePluginId(value: unknown): string {
  if (typeof value !== 'string' || !PLUGIN_ID.test(value)) {
    throw new Error('無效的 plugin id')
  }
  return value
}

export function configurePluginInstallerDir(dir: string) {
  if (!path.isAbsolute(dir)) throw new Error('plugin installer dir 必須是絕對路徑')
  configuredPluginDir = path.resolve(dir)
  fs.mkdirSync(configuredPluginDir, { recursive: true })
}

export function pluginInstallerDir(): string {
  if (!configuredPluginDir) throw new Error('plugin installer dir 尚未設定')
  const dir = configuredPluginDir
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function packagesDir(): string {
  const dir = path.join(pluginInstallerDir(), '.packages')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function safeChild(root: string, ...parts: string[]): string {
  const target = path.resolve(root, ...parts)
  if (!isPathInside(root, target)) throw new Error('外掛路徑超出允許範圍')
  return target
}

export function pluginManifestPath(id: unknown): string {
  return safeChild(pluginInstallerDir(), `${validatePluginId(id)}.json`)
}

function packageInstallDir(id: string): string {
  return safeChild(packagesDir(), id)
}

function readManifest(id: string): InstalledManifest | null {
  const file = pluginManifestPath(id)
  if (!fs.existsSync(file)) return null
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as InstalledManifest
    return value?.id === id ? value : null
  } catch {
    return null
  }
}

function writeManifest(manifest: InstalledManifest): string {
  const file = pluginManifestPath(manifest.id)
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2), 'utf8')
  return file
}

function publicCatalogItem(item: PluginCatalogItem) {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    category: item.category,
    icon: item.icon,
    accent: item.accent,
    installKind: item.installKind,
    featured: Boolean(item.featured),
    tags: item.tags || [],
    setupHint: item.setupHint,
    requiresProjectRoot: Boolean(item.npm?.requiresProjectRoot),
    secretPluginId: item.npm?.secretPluginId || item.dependsOnPluginId,
    dependsOnPluginId: item.dependsOnPluginId,
  }
}

export function pluginCatalog() {
  return PLUGIN_CATALOG.map(publicCatalogItem)
}

function validProjectRoot(value: unknown, required: boolean): string | undefined {
  if (value == null || value === '') {
    if (required) throw new Error('此外掛需要有效的專案目錄')
    return undefined
  }
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error('projectRoot 必須是絕對路徑')
  }
  let stat: fs.Stats
  try {
    stat = fs.statSync(value)
  } catch {
    throw new Error('projectRoot 不存在')
  }
  if (!stat.isDirectory()) throw new Error('projectRoot 不是資料夾')
  return path.resolve(value)
}

async function runInstall(args: string[], cwd: string) {
  const spec = spawnCommandSpec('npm', args)
  return new Promise<{ ok: boolean; code: number | null; log: string; timedOut: boolean }>(
    (resolve) => {
      let stdout = ''
      let stderr = ''
      let settled = false
      let child
      try {
        child = spawn(spec.file, spec.args, {
          cwd,
          env: { ...process.env },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          windowsVerbatimArguments: spec.windowsVerbatimArguments,
        })
      } catch (error) {
        resolve({
          ok: false,
          code: null,
          log: error instanceof Error ? error.message : String(error),
          timedOut: false,
        })
        return
      }

      const finish = (code: number | null, timedOut: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        const log = [stdout, stderr].filter(Boolean).join('\n').slice(-MAX_LOG_CHARS)
        resolve({ ok: code === 0 && !timedOut, code, log, timedOut })
      }
      const timer = setTimeout(() => {
        void terminateProcessTree(child, true)
        finish(null, true)
      }, INSTALL_TIMEOUT_MS)
      child.stdout.on('data', (chunk: Buffer) => {
        stdout = (stdout + chunk.toString('utf8')).slice(-MAX_LOG_CHARS)
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString('utf8')).slice(-MAX_LOG_CHARS)
      })
      child.once('error', (error: Error) => {
        stderr += `\n${error.message}`
        finish(null, false)
      })
      child.once('close', (code) => finish(code, false))
    },
  )
}

function resolvePackageBin(
  installDir: string,
  packageName: string,
  binName: string,
): { binPath: string; version?: string } {
  const packageDir = safeChild(installDir, 'node_modules', ...packageName.split('/'))
  const packageJsonPath = safeChild(packageDir, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
    version?: string
    bin?: string | Record<string, string>
  }
  const relativeBin =
    typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[binName]
  if (!relativeBin || typeof relativeBin !== 'string') {
    throw new Error(`套件未提供 bin：${binName}`)
  }
  const binPath = safeChild(packageDir, relativeBin)
  if (!fs.statSync(binPath).isFile()) throw new Error('套件 bin 不存在')
  return { binPath, version: pkg.version }
}

function serverFromManifest(manifest: InstalledManifest): PluginMcpServer | null {
  const server = manifest.mcpServers?.[0]
  // package ownership may use pluginId === manifest.id; secretPluginId may point at a connector
  if (
    !server ||
    typeof server.id !== 'string' ||
    typeof server.command !== 'string' ||
    !Array.isArray(server.args)
  ) {
    return null
  }
  return server as PluginMcpServer
}

export async function pluginHealth(idValue: unknown) {
  const id = validatePluginId(idValue)
  const item = catalogItem(id)
  const manifest = readManifest(id)
  if (!manifest) {
    return {
      ok: true,
      installed: false,
      healthy: false,
      status: item?.installKind === 'connector' ? ('setup-required' as const) : ('not-installed' as const),
      id,
      tools: [] as unknown[],
    }
  }
  // Connector: ready when connectorAuth.hasCredential was set after token save
  if (item?.installKind === 'connector' || manifest.installKind === 'connector') {
    const auth = manifest.connectorAuth as { hasCredential?: boolean; accountHint?: string } | undefined
    const ready = auth?.hasCredential === true
    return {
      ok: ready,
      installed: true,
      healthy: ready,
      status: ready ? ('ready' as const) : ('setup-required' as const),
      id,
      tools: [] as unknown[],
      error: ready
        ? auth?.accountHint
          ? `已授權 ${auth.accountHint}`
          : undefined
        : item?.setupHint || String(manifest.setupHint || '需要額外授權設定'),
    }
  }
  if (item?.installKind !== 'npm-mcp') {
    return {
      ok: true,
      installed: true,
      healthy: true,
      status: 'ready' as const,
      id,
      tools: [] as unknown[],
    }
  }
  const server = serverFromManifest(manifest)
  if (!server) {
    return {
      ok: false,
      installed: true,
      healthy: false,
      id,
      tools: [] as unknown[],
      error: 'MCP manifest 不完整',
    }
  }
  try {
    const tools = await mcpStdioListTools(server)
    return { ok: true, installed: true, healthy: true, id, tools }
  } catch (error) {
    mcpStdioStop(server.id)
    return {
      ok: false,
      installed: true,
      healthy: false,
      id,
      tools: [] as unknown[],
      error: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
    }
  }
}

export async function installPlugin(input: unknown) {
  if (!input || typeof input !== 'object') throw new Error('安裝參數無效')
  const request = input as { id?: unknown; projectRoot?: unknown }
  const id = validatePluginId(request.id)
  const item = catalogItem(id)
  if (!item) throw new Error('外掛不在允許的 catalog 中')

  if (item.installKind === 'connector') {
    // 寫入 setup-required stub（含 catalog customTools，授權後即可被 FC 使用）
    const manifest: InstalledManifest = {
      ...(item.manifest || {}),
      id,
      name: item.name,
      version: item.manifest?.version || '1.0.0',
      enabled: false,
      description: item.description,
      installedAt: new Date().toISOString(),
      source: 'catalog:connector',
      installKind: 'connector',
      setupHint: item.setupHint || '此 connector 需要額外授權設定。',
    }
    const manifestPath = writeManifest(manifest)
    return {
      ok: true,
      installed: true,
      requiresSetup: true,
      id,
      manifest,
      manifestPath,
      setupHint: item.setupHint || '此 connector 需要額外授權設定。',
      health: {
        ok: false,
        installed: true,
        healthy: false,
        status: 'setup-required' as const,
        id,
        tools: [] as unknown[],
      },
    }
  }

  if (item.installKind === 'bundled') {
    if (!item.manifest) throw new Error('bundled 外掛缺少 manifest')
    const manifest: InstalledManifest = {
      ...item.manifest,
      id,
      name: item.name,
      enabled: true,
      installedAt: new Date().toISOString(),
      source: 'catalog:bundled',
      installKind: 'bundled',
    }
    const manifestPath = writeManifest(manifest)
    return {
      ok: true,
      installed: true,
      requiresSetup: false,
      id,
      manifest,
      manifestPath,
      health: await pluginHealth(id),
    }
  }

  if (!item.npm) throw new Error('npm-mcp 外掛缺少套件設定')
  const projectRoot = validProjectRoot(
    request.projectRoot,
    Boolean(item.npm.requiresProjectRoot),
  )
  const installDir = packageInstallDir(id)
  fs.mkdirSync(installDir, { recursive: true })
  const result = await runInstall(
    [
      'install',
      '--no-save',
      '--omit=dev',
      '--no-audit',
      '--no-fund',
      '--prefix',
      installDir,
      item.npm.packageSpec,
    ],
    installDir,
  )
  if (!result.ok) {
    return {
      ok: false,
      installed: false,
      requiresSetup: false,
      id,
      code: result.code,
      timedOut: result.timedOut,
      log: result.log,
      error: result.timedOut ? 'npm install 逾時' : 'npm install 失敗',
    }
  }

  const resolved = resolvePackageBin(
    installDir,
    item.npm.packageName,
    item.npm.binName,
  )
  const resolvedArgs = item.npm.args.map((arg) => {
    if (arg !== '${projectRoot}') return arg
    if (!projectRoot) throw new Error('此外掛需要 projectRoot')
    return projectRoot
  })
  // Link secrets: prefer secretPluginId so GitHub MCP uses github-connector token
  const secretPluginId = item.npm.secretPluginId || item.dependsOnPluginId || id
  const envKeys =
    item.npm.envKeys ||
    MCP_SECRET_ENV_KEYS[secretPluginId] ||
    []
  const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: '1' }
  // Reserve keys (empty) so enrich fills at runtime without wiping user overrides
  for (const key of envKeys) {
    if (env[key] == null) env[key] = ''
  }
  const server: PluginMcpServer = {
    id: `plugin-${id}`,
    name: item.name,
    enabled: true,
    transport: 'stdio',
    command: process.execPath,
    args: [resolved.binPath, ...resolvedArgs],
    env,
    // package ownership vs secret ownership (must not collapse these two)
    pluginId: id,
    secretPluginId,
  }
  const manifest: InstalledManifest = {
    id,
    name: item.name,
    version: resolved.version || '0.0.0',
    enabled: true,
    description: item.description,
    installedAt: new Date().toISOString(),
    source: 'catalog:npm-mcp',
    installKind: 'npm-mcp',
    packageSpec: item.npm.packageSpec,
    packageDir: installDir,
    secretPluginId,
    mcpServers: [server],
  }
  const manifestPath = writeManifest(manifest)
  const health = await pluginHealth(id)
  return {
    ok: health.healthy,
    installed: true,
    requiresSetup: false,
    id,
    manifest,
    manifestPath,
    log: result.log,
    health,
  }
}

export async function uninstallPlugin(idValue: unknown) {
  const id = validatePluginId(idValue)
  const manifest = readManifest(id)
  for (const server of manifest?.mcpServers || []) {
    // Stop by server session id (package ownership may differ from secretPluginId)
    if (typeof server.id === 'string') {
      mcpStdioStop(server.id)
    }
  }

  const manifestPath = pluginManifestPath(id)
  const installDir = packageInstallDir(id)
  if (!isPathInside(pluginInstallerDir(), manifestPath)) throw new Error('拒絕刪除外掛路徑')
  if (!isPathInside(packagesDir(), installDir)) throw new Error('拒絕刪除套件路徑')
  if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath)
  if (fs.existsSync(installDir)) fs.rmSync(installDir, { recursive: true, force: true })
  return { ok: true, id, installed: false }
}
