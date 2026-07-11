import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  Tray,
  Menu,
  nativeImage,
  Notification,
  powerSaveBlocker,
  safeStorage,
} from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  getWebhookStatus,
  setWebhookHandler,
  startWebhookServer,
  stopWebhookServer,
  type WebhookPayload,
} from './webhookServer'
import {
  mcpHttpRpc,
  mcpStdioCallTool,
  mcpStdioEnsure,
  mcpStdioListSessions,
  mcpStdioListTools,
  mcpStdioStop,
  mcpStdioStopAll,
} from './mcpBridge'
import {
  gatewaySendMessage,
  getGatewayStatus,
  setGatewayInboundHandler,
  startTelegramGateway,
  stopTelegramGateway,
  type GatewayInbound,
} from './messagingGateway'
import { cancelBash, runBash } from './shellBridge'
import {
  detectOpenCodeCli,
  loadOpenCodeBundle,
  runOpenCodePrompt,
  scanOpenCodeAgents,
  spawnOpenCodeInteractive,
} from './opencodeBridge'
import {
  inspectProject,
  listBranches,
  pickProjectFolder,
} from './projectBridge'
import {
  applyDiscoveryToProviders,
  discoverLocalClis,
} from './cliDiscover'
import { discoverMcpServers } from './mcpDiscover'
import {
  bindTermWebContents,
  createTermSession,
  killAllTerms,
  killTerm,
  listTermSessions,
  writeTerm,
} from './ptyBridge'
import { runLocalCliAgent, type LocalCliKind } from './localCliRunner'
import {
  executableLookupCommand,
  firstExecutablePath,
  isPathInside,
} from './platformProcess'
import {
  codegraphCallees,
  codegraphCallers,
  codegraphDetect,
  codegraphExplore,
  codegraphImpact,
  codegraphInit,
  codegraphNode,
  codegraphQuery,
  codegraphStatus,
  codegraphSync,
} from './codegraphBridge'
import {
  configurePluginInstallerDir,
  installPlugin,
  pluginCatalog,
  pluginHealth,
  pluginInstallerDir,
  pluginManifestPath,
  uninstallPlugin,
  validatePluginId,
} from './pluginInstaller'
import { cancelOAuth, refreshOAuthToken, runPluginOAuth } from './oauthBridge'
import { oauthProviderForPlugin } from '../src/agent/hermes/pluginOAuth'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(process.env.DIST, '../public')

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

function getDataDir(sub = 'executions') {
  const dir = path.join(app.getPath('userData'), sub)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function settingsPath() {
  return path.join(getDataDir('config'), 'settings.json')
}

function settingsForDisk(value: unknown) {
  if (!value || typeof value !== 'object') return value
  const settings = { ...(value as Record<string, unknown>) }
  const secrets = settings.customToolSecrets
  if (secrets && typeof secrets === 'object' && safeStorage.isEncryptionAvailable()) {
    settings.encryptedCustomToolSecrets = safeStorage.encryptString(JSON.stringify(secrets)).toString('base64')
    delete settings.customToolSecrets
  }
  return settings
}

function settingsForRenderer(value: unknown) {
  if (!value || typeof value !== 'object') return value
  const settings = { ...(value as Record<string, unknown>) }
  const encrypted = settings.encryptedCustomToolSecrets
  if (typeof encrypted === 'string') {
    try { settings.customToolSecrets = JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64'))) }
    catch { settings.customToolSecrets = {} }
    delete settings.encryptedCustomToolSecrets
  }
  return settings
}

/** Open native folder picker and push path to renderer */
async function openProjectFolderPicker(defaultPath?: string) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
  }
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
  if (win) {
    if (win.isMinimized()) win.restore()
    if (!win.isVisible()) win.show()
    win.focus()
  }
  const r = await pickProjectFolder(win, defaultPath)
  if (!r.canceled && r.path) {
    setActiveProjectRoot(r.path)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('project:selected', r.path)
    }
  }
  return r
}

function createAppMenu() {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: '檔案',
      submenu: [
        {
          label: '選擇專案資料夾…',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            void openProjectFolderPicker()
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: '編輯',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '檢視',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: '視窗',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [{ type: 'separator' as const }, { role: 'front' as const }]
          : [{ role: 'close' as const }]),
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createTray() {
  // Minimal 16x16 cyan-ish PNG (1x)
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKElEQVQ4T2NkYGD4z0ABYBzVMKoBBgP+/ydFG6MaRjWM5gE0NQAAK3YB/0m3w0sAAAAASUVORK5CYII=',
    'base64',
  )
  const icon = nativeImage.createFromBuffer(png)
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip('SubAgents AI')
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '顯示 SubAgents AI',
      click: () => {
        if (!mainWindow) createWindow()
        mainWindow?.show()
        mainWindow?.focus()
      },
    },
    {
      label: '選擇專案資料夾…',
      click: () => {
        void openProjectFolderPicker()
      },
    },
    {
      label: '隱藏到系統匣',
      click: () => mainWindow?.hide(),
    },
    { type: 'separator' },
    {
      label: '結束',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])
  tray.setContextMenu(contextMenu)
  tray.on('double-click', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'SubAgents AI',
    backgroundColor: '#0b1326',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    // Align with sidebar titlebar spacer (see Layout.tsx .mac-traffic-spacer)
    trafficLightPosition: process.platform === 'darwin' ? { x: 14, y: 14 } : undefined,
    webPreferences: {
      // CJS preload (see vite.config preload output) — .mjs + require breaks contextBridge
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  })

  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('[preload-error]', preloadPath, error)
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // Close → tray (background scheduler keeps running)
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
      if (Notification.isSupported()) {
        new Notification({
          title: 'SubAgents AI',
          body: '已在背景執行，排程仍會持續運作。',
        }).show()
      }
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    if (process.env.SUBAGENTS_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
  } else {
    mainWindow.loadFile(path.join(process.env.DIST!, 'index.html'))
  }
}

app.whenReady().then(() => {
  createAppMenu()
  createWindow()
  createTray()
  startScheduleTicker()

  // Forward webhook hits to renderer
  setWebhookHandler((payload: WebhookPayload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('webhook:event', payload)
    }
    if (Notification.isSupported()) {
      new Notification({
        title: 'SubAgents AI · Webhook',
        body: `已收到 ${payload.source || '事件'}`,
      }).show()
    }
  })

  // Messaging gateway → renderer
  setGatewayInboundHandler((msg: GatewayInbound) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:inbound', msg)
    }
    if (Notification.isSupported()) {
      new Notification({
        title: `SubAgents AI · ${msg.channel}`,
        body: `${msg.from || msg.chatId}: ${msg.text.slice(0, 120)}`,
      }).show()
    }
  })

  // Auto-start webhook / telegram if settings request it
  try {
    const file = settingsPath()
    if (fs.existsSync(file)) {
      const s = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
        webhookEnabled?: boolean
        webhookPort?: number
        webhookToken?: string
        telegramEnabled?: boolean
        telegramBotToken?: string
        telegramAllowedChatIds?: string
      }
      if (s.webhookEnabled) {
        void startWebhookServer({
          port: s.webhookPort || 8787,
          token: s.webhookToken || '',
        }).catch((e) => {
          console.error('Webhook auto-start failed', e)
        })
      }
      if (s.telegramEnabled && s.telegramBotToken) {
        void startTelegramGateway({
          token: s.telegramBotToken,
          allowedChatIds: s.telegramAllowedChatIds || '',
        }).catch((e) => {
          console.error('Telegram gateway auto-start failed', e)
        })
      }
    }
  } catch {
    /* ignore */
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else mainWindow?.show()
  })
})

app.on('before-quit', () => {
  isQuitting = true
  mcpStdioStopAll()
  killAllTerms()
  void stopTelegramGateway()
})

app.on('window-all-closed', () => {
  // Keep running in tray on all platforms unless quitting
  if (isQuitting && process.platform !== 'darwin') {
    app.quit()
  }
  // do not null mainWindow if just hidden
})

// ── Archive ─────────────────────────────────────────────────────

ipcMain.handle('archive:list', async () => {
  const dir = getDataDir()
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
  const records = files.map((f) => {
    const raw = fs.readFileSync(path.join(dir, f), 'utf-8')
    return JSON.parse(raw)
  })
  return records.sort(
    (a: { timestamp: string }, b: { timestamp: string }) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  )
})

ipcMain.handle('archive:save', async (_evt, record: unknown) => {
  const dir = getDataDir()
  const id = (record as { id: string }).id
  const file = path.join(dir, `${id}.json`)
  fs.writeFileSync(file, JSON.stringify(record, null, 2), 'utf-8')
  return { ok: true, path: file }
})

ipcMain.handle('archive:get', async (_evt, id: string) => {
  const file = path.join(getDataDir(), `${id}.json`)
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf-8'))
})

ipcMain.handle('archive:delete', async (_evt, id: string) => {
  const file = path.join(getDataDir(), `${id}.json`)
  if (fs.existsSync(file)) fs.unlinkSync(file)
  return { ok: true }
})

// ── Settings (userData) ─────────────────────────────────────────

ipcMain.handle('settings:get', async () => {
  const file = settingsPath()
  if (!fs.existsSync(file)) return null
  try {
    return settingsForRenderer(JSON.parse(fs.readFileSync(file, 'utf-8')))
  } catch {
    return null
  }
})

ipcMain.handle('settings:set', async (_evt, settings: unknown) => {
  const file = settingsPath()
  fs.writeFileSync(file, JSON.stringify(settingsForDisk(settings), null, 2), 'utf-8')
  return { ok: true }
})

// ── LLM proxy (OpenAI-compatible) ───────────────────────────────

ipcMain.handle(
  'llm:chat',
  async (
    _evt,
    req: {
      baseUrl: string
      apiKey: string
      model: string
      messages: unknown[]
      temperature?: number
      max_tokens?: number
      tools?: unknown[]
      tool_choice?: unknown
    },
  ) => {
    const base = (req.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')
    const payload: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      temperature: req.temperature ?? 0.4,
      max_tokens: req.max_tokens ?? 1200,
    }
    if (req.tools && Array.isArray(req.tools) && req.tools.length > 0) {
      payload.tools = req.tools
      payload.tool_choice = req.tool_choice ?? 'auto'
    }

    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${req.apiKey}`,
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText)
      throw new Error(`LLM HTTP ${res.status}: ${errText.slice(0, 300)}`)
    }

    const data = (await res.json()) as {
      choices?: Array<{
        finish_reason?: string
        message?: {
          content?: string | null
          tool_calls?: Array<{
            id: string
            function?: { name?: string; arguments?: string }
          }>
        }
      }>
      usage?: { total_tokens?: number }
      model?: string
    }

    const choice = data.choices?.[0]
    const msg = choice?.message
    const toolCalls = (msg?.tool_calls || []).map((tc) => ({
      id: tc.id,
      name: tc.function?.name || '',
      arguments: tc.function?.arguments || '{}',
    }))

    return {
      content: (msg?.content || '').trim(),
      tokensUsed: data.usage?.total_tokens ?? 0,
      model: data.model || req.model,
      toolCalls,
      finishReason: choice?.finish_reason,
    }
  },
)

ipcMain.handle('llm:models', async (_evt, req: { baseUrl: string; apiKey: string }) => {
  const base = (req.baseUrl || '').replace(/\/$/, '')
  const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${req.apiKey || ''}` } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = (await res.json()) as { data?: Array<{ id?: string }> }
  return { models: (body.data || []).map((m) => m.id || '').filter(Boolean) }
})

ipcMain.handle('app:notify', async (_evt, title: string, body: string) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show()
  }
  return { ok: true }
})

ipcMain.handle('app:showWindow', async () => {
  if (!mainWindow) createWindow()
  mainWindow?.show()
  mainWindow?.focus()
  return { ok: true }
})

/** ChatGPT-style: keep Mac awake while agent runs */
let powerBlockerId: number | null = null
ipcMain.handle('power:preventSleep', async () => {
  if (powerBlockerId != null && powerSaveBlocker.isStarted(powerBlockerId)) {
    return { ok: true, id: powerBlockerId }
  }
  powerBlockerId = powerSaveBlocker.start('prevent-app-suspension')
  return { ok: true, id: powerBlockerId }
})
ipcMain.handle('power:allowSleep', async () => {
  if (powerBlockerId != null && powerSaveBlocker.isStarted(powerBlockerId)) {
    powerSaveBlocker.stop(powerBlockerId)
  }
  powerBlockerId = null
  return { ok: true }
})

// ── Webhook server ──────────────────────────────────────────────

ipcMain.handle(
  'webhook:start',
  async (_evt, opts: { port?: number; token?: string }) => {
    return startWebhookServer(opts || {})
  },
)

ipcMain.handle('webhook:stop', async () => stopWebhookServer())

ipcMain.handle('webhook:status', async () => getWebhookStatus())

// ── Bundle export path helper ───────────────────────────────────

ipcMain.handle('app:userDataPath', () => app.getPath('userData'))

// ── Hermes learning layer (memory + skills + soul/agents) ───────

function hermesPath() {
  return path.join(getDataDir('config'), 'hermes.json')
}

ipcMain.handle('hermes:get', async () => {
  const file = hermesPath()
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return null
  }
})

// ── Plugins directory ───────────────────────────────────────────

function pluginsDir() {
  return pluginInstallerDir()
}

configurePluginInstallerDir(getDataDir('plugins'))

ipcMain.handle('plugins:catalog', async () => pluginCatalog())

ipcMain.handle('plugins:install', async (_evt, input: unknown) => installPlugin(input))

ipcMain.handle('plugins:health', async (_evt, id: string) => pluginHealth(id))

ipcMain.handle('plugins:uninstall', async (_evt, id: string) => uninstallPlugin(id))

ipcMain.handle('plugins:list', async () => {
  const dir = pluginsDir()
  if (!fs.existsSync(dir)) return []
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
  const out = []
  for (const f of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, f), 'utf-8')
      out.push(JSON.parse(raw))
    } catch {
      /* skip */
    }
  }
  return out
})

ipcMain.handle('plugins:save', async (_evt, manifest: { id: string }) => {
  if (!manifest || typeof manifest !== 'object') throw new Error('無效的 plugin manifest')
  validatePluginId(manifest.id)
  const file = pluginManifestPath(manifest.id)
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2), 'utf-8')
  return { ok: true, path: file }
})

ipcMain.handle('plugins:delete', async (_evt, id: string) => {
  const file = pluginManifestPath(id)
  if (fs.existsSync(file)) fs.unlinkSync(file)
  return { ok: true }
})

ipcMain.handle('plugins:dir', () => pluginsDir())

// ── OAuth (device code + loopback code flow) ────────────────────

ipcMain.handle(
  'oauth:run',
  async (
    evt,
    input: {
      pluginId?: string
      clientId?: string
      clientSecret?: string
    },
  ) => {
    const pluginId = typeof input?.pluginId === 'string' ? input.pluginId : ''
    const provider = oauthProviderForPlugin(pluginId)
    if (!provider) {
      return { ok: false, pluginId, error: `外掛 ${pluginId} 不支援 OAuth` }
    }
    return runPluginOAuth(
      {
        pluginId,
        provider,
        clientId: String(input?.clientId || '').trim(),
        clientSecret: input?.clientSecret ? String(input.clientSecret) : undefined,
      },
      evt.sender,
    )
  },
)

ipcMain.handle('oauth:cancel', async () => {
  cancelOAuth()
  return { ok: true }
})

ipcMain.handle(
  'oauth:refresh',
  async (
    _evt,
    input: {
      pluginId?: string
      refreshToken?: string
      clientId?: string
      clientSecret?: string
      tokenUrl?: string
      tokenAuth?: 'body' | 'basic'
    },
  ) => {
    return refreshOAuthToken({
      pluginId: String(input?.pluginId || ''),
      refreshToken: String(input?.refreshToken || ''),
      clientId: String(input?.clientId || ''),
      clientSecret: input?.clientSecret ? String(input.clientSecret) : undefined,
      tokenUrl: String(input?.tokenUrl || ''),
      tokenAuth: input?.tokenAuth,
    })
  },
)

ipcMain.handle('shell:openExternal', async (_evt, url: string) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new Error('無效的 URL')
  }
  await shell.openExternal(url)
  return { ok: true }
})

// ── MCP bridge ──────────────────────────────────────────────────

ipcMain.handle(
  'mcp:httpRpc',
  async (
    _evt,
    input: { url: string; headers?: Record<string, string>; body: unknown },
  ) => mcpHttpRpc(input),
)

ipcMain.handle(
  'mcp:stdioListTools',
  async (_evt, input: { id: string; command: string; args: string[]; env?: Record<string, string> }) =>
    mcpStdioListTools(input),
)

ipcMain.handle(
  'mcp:stdioCallTool',
  async (
    _evt,
    input: {
      id: string
      command: string
      args: string[]
      env?: Record<string, string>
      toolName: string
      arguments: Record<string, unknown>
    },
  ) => mcpStdioCallTool(input),
)

ipcMain.handle(
  'mcp:stdioEnsure',
  async (_evt, input: { id: string; command: string; args: string[]; env?: Record<string, string> }) =>
    mcpStdioEnsure(input),
)

ipcMain.handle('mcp:stdioStop', async (_evt, id: string) => mcpStdioStop(id))

ipcMain.handle('mcp:stdioStopAll', async () => mcpStdioStopAll())

ipcMain.handle('mcp:stdioSessions', async () => mcpStdioListSessions())
ipcMain.handle('mcp:discover', async (_evt, projectRoot?: string) => discoverMcpServers(projectRoot))

// ── Messaging gateway (Telegram) ────────────────────────────────

ipcMain.handle(
  'gateway:telegramStart',
  async (_evt, opts: { token: string; allowedChatIds?: string }) =>
    startTelegramGateway(opts || { token: '' }),
)

ipcMain.handle('gateway:telegramStop', async () => stopTelegramGateway())

ipcMain.handle('gateway:status', async () => getGatewayStatus())

ipcMain.handle(
  'gateway:send',
  async (
    _evt,
    input: { channel: 'telegram' | 'webhook' | 'system'; chatId: string; text: string; token?: string },
  ) => gatewaySendMessage(input),
)

// ── Shell / bash ────────────────────────────────────────────────

ipcMain.handle(
  'shell:bash',
  async (
    _evt,
    input: { command: string; cwd?: string; timeoutMs?: number },
  ) => {
    // Prefer explicit project cwd from renderer; else sandboxed workspace
    let cwd = input.cwd
    if (cwd && !path.isAbsolute(cwd)) {
      cwd = path.resolve(workspaceRoot(), cwd)
    }
    if (!cwd || !fs.existsSync(cwd)) cwd = workspaceRoot()
    return runBash({ ...input, cwd })
  },
)

// ── OpenCode interop ────────────────────────────────────────────

ipcMain.handle('opencode:scanAgents', async (_evt, projectRoot?: string) => {
  try {
    return scanOpenCodeAgents(projectRoot || workspaceRoot())
  } catch (e) {
    return {
      global: [],
      project: [],
      dirs: [],
      error: e instanceof Error ? e.message : String(e),
    }
  }
})

/** Full bundle: merged json layers + agents/commands markdown */
ipcMain.handle('opencode:loadBundle', async (_evt, projectRoot?: string) => {
  try {
    return loadOpenCodeBundle(projectRoot || workspaceRoot())
  } catch (e) {
    return {
      layers: [],
      agents: [],
      commands: [],
      sources: [],
      error: e instanceof Error ? e.message : String(e),
    }
  }
})

ipcMain.handle('opencode:detect', async () => detectOpenCodeCli())

ipcMain.handle(
  'opencode:run',
  async (_evt, input: { prompt: string; timeoutMs?: number; cwd?: string }) =>
    runOpenCodePrompt({
      ...input,
      cwd: input.cwd || workspaceRoot(),
    }),
)

ipcMain.handle('opencode:hint', async () => spawnOpenCodeInteractive({ cwd: workspaceRoot() }))

// ── Project / Git worktree ──────────────────────────────────────

ipcMain.handle(
  'project:pick',
  async (evt, opts?: { defaultPath?: string }) => {
    try {
      let win = BrowserWindow.fromWebContents(evt.sender)
      if (!win || win.isDestroyed()) {
        win = BrowserWindow.getFocusedWindow() || mainWindow
      }
      const r = await pickProjectFolder(win, opts?.defaultPath)
      if (r.path && !r.canceled) {
        setActiveProjectRoot(r.path)
      }
      return r
    } catch (e) {
      return {
        canceled: false,
        path: null,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  },
)

ipcMain.handle('project:inspect', async (_evt, root: string) => inspectProject(root || workspaceRoot()))

ipcMain.handle('project:branches', async (_evt, root: string) =>
  listBranches(root || workspaceRoot()),
)

/** Sync tools/bash workspace root with ProjectContextBar selection */
ipcMain.handle('project:setActiveRoot', async (_evt, root: string | null) =>
  setActiveProjectRoot(root),
)

ipcMain.handle('project:getActiveRoot', async () => ({
  root: workspaceRoot(),
  mode: activeProjectRoot ? 'project' : 'sandbox',
  projectRoot: activeProjectRoot,
}))

ipcMain.handle('cli:which', async (_evt, binary: string) => {
  const bin = (binary || '').trim()
  if (!bin) return { found: false, path: null }
  const r = await runBash({
    command: executableLookupCommand(bin),
    timeoutMs: 5000,
  })
  const p = firstExecutablePath(r.stdout)
  return { found: Boolean(p && r.ok), path: p }
})

ipcMain.handle('cli:discover', async () => discoverLocalClis())

ipcMain.handle(
  'cli:applyDiscovery',
  async (_evt, currentProviders: Array<Record<string, unknown>>) => {
    const { clis, summary } = await discoverLocalClis()
    const next = applyDiscoveryToProviders(currentProviders || [], clis)
    // default model/depth hints from codex if present
    const codex = clis.find((c) => c.id === 'codex')
    return {
      providers: next,
      summary,
      clis,
      suggestedModel: codex?.defaultModel || clis.find((c) => c.models[0])?.models[0]?.id,
      suggestedDepth: codex?.defaultDepth || 'deep',
    }
  },
)

/** Run agent prompt via installed local CLI (uses their login) */
ipcMain.handle(
  'cli:runAgent',
  async (
    _evt,
    input: {
      kind: LocalCliKind
      binary?: string
      prompt: string
      cwd?: string
      model?: string
      depth?: string
      agentMode?: string
      approvalMode?: 'always' | 'auto' | 'full'
      unattended?: boolean
      timeoutMs?: number
      attachments?: Array<{
        name: string
        mimeType?: string
        kind?: 'image' | 'text' | 'binary'
        dataUrl?: string
        textContent?: string
      }>
    },
  ) => {
    const cwd =
      input.cwd && fs.existsSync(input.cwd) ? input.cwd : workspaceRoot()
    // Cap attachment payload size at IPC boundary (avoid huge hangs)
    const attachments = (input.attachments || []).slice(0, 4).map((a) => ({
      name: String(a.name || 'file').slice(0, 200),
      mimeType: a.mimeType,
      kind: a.kind,
      dataUrl:
        typeof a.dataUrl === 'string' && a.dataUrl.length < 12_000_000
          ? a.dataUrl
          : undefined,
      textContent:
        typeof a.textContent === 'string'
          ? a.textContent.slice(0, 200_000)
          : undefined,
    }))
    return runLocalCliAgent({ ...input, cwd, attachments })
  },
)

/** Cancel in-flight CLI specialist processes (tag: cli-agent) */
ipcMain.handle('cli:cancel', async () => {
  return cancelBash({ tag: 'cli-agent' })
})

// ── Chat attachments (disk materialize for bubbles / queue / vision) ──
ipcMain.handle(
  'attachments:materialize',
  async (
    _evt,
    input: {
      attachments?: Array<{
        id?: string
        name: string
        mimeType?: string
        kind?: 'image' | 'text' | 'binary'
        dataUrl?: string
        textContent?: string
        filePath?: string
        size?: number
      }>
      projectRoot?: string
      sessionId?: string
    },
  ) => {
    const { materializeAttachments } = await import('./attachmentStore')
    const projectRoot =
      input.projectRoot && fs.existsSync(input.projectRoot)
        ? input.projectRoot
        : workspaceRoot()
    const capped = (input.attachments || []).slice(0, 4).map((a) => ({
      ...a,
      name: String(a.name || 'file').slice(0, 200),
      dataUrl:
        typeof a.dataUrl === 'string' && a.dataUrl.length < 12_000_000
          ? a.dataUrl
          : undefined,
      textContent:
        typeof a.textContent === 'string'
          ? a.textContent.slice(0, 200_000)
          : undefined,
    }))
    const r = materializeAttachments(capped, {
      projectRoot: projectRoot || undefined,
      sessionId: input.sessionId,
    })
    return { ok: true, dir: r.dir, items: r.items }
  },
)

ipcMain.handle(
  'attachments:readDataUrl',
  async (_evt, filePath: string) => {
    const { readFileAsDataUrl } = await import('./attachmentStore')
    return readFileAsDataUrl(String(filePath || ''))
  },
)

// ── CodeGraph (https://github.com/colbymchenry/codegraph) ────────

ipcMain.handle('codegraph:detect', async () => codegraphDetect())

ipcMain.handle('codegraph:status', async (_evt, projectRoot?: string) =>
  codegraphStatus(projectRoot || workspaceRoot()),
)

ipcMain.handle('codegraph:init', async (_evt, projectRoot?: string) =>
  codegraphInit(projectRoot || workspaceRoot()),
)

ipcMain.handle('codegraph:sync', async (_evt, projectRoot?: string) =>
  codegraphSync(projectRoot || workspaceRoot()),
)

ipcMain.handle(
  'codegraph:explore',
  async (
    _evt,
    input: { projectRoot?: string; query: string; maxFiles?: number },
  ) =>
    codegraphExplore(input?.projectRoot || workspaceRoot(), input?.query || '', {
      maxFiles: input?.maxFiles,
    }),
)

ipcMain.handle(
  'codegraph:query',
  async (
    _evt,
    input: {
      projectRoot?: string
      search: string
      kind?: string
      limit?: number
      json?: boolean
    },
  ) =>
    codegraphQuery(input?.projectRoot || workspaceRoot(), input?.search || '', {
      kind: input?.kind,
      limit: input?.limit,
      json: input?.json,
    }),
)

ipcMain.handle(
  'codegraph:callers',
  async (
    _evt,
    input: { projectRoot?: string; symbol: string; limit?: number; json?: boolean },
  ) =>
    codegraphCallers(input?.projectRoot || workspaceRoot(), input?.symbol || '', {
      limit: input?.limit,
      json: input?.json,
    }),
)

ipcMain.handle(
  'codegraph:callees',
  async (
    _evt,
    input: { projectRoot?: string; symbol: string; limit?: number; json?: boolean },
  ) =>
    codegraphCallees(input?.projectRoot || workspaceRoot(), input?.symbol || '', {
      limit: input?.limit,
      json: input?.json,
    }),
)

ipcMain.handle(
  'codegraph:impact',
  async (
    _evt,
    input: { projectRoot?: string; symbol: string; depth?: number; json?: boolean },
  ) =>
    codegraphImpact(input?.projectRoot || workspaceRoot(), input?.symbol || '', {
      depth: input?.depth,
      json: input?.json,
    }),
)

ipcMain.handle(
  'codegraph:node',
  async (_evt, input: { projectRoot?: string; name: string; file?: string }) =>
    codegraphNode(input?.projectRoot || workspaceRoot(), input?.name || '', {
      file: input?.file,
    }),
)

// ── Multi-tab terminal (soft PTY) ───────────────────────────────

ipcMain.handle(
  'term:create',
  async (evt, opts: { cwd?: string; title?: string }) => {
    const info = createTermSession({
      cwd: opts?.cwd,
      title: opts?.title,
      webContents: evt.sender,
    })
    bindTermWebContents(info.id, evt.sender)
    return info
  },
)

ipcMain.handle('term:list', async () => listTermSessions())

ipcMain.handle('term:write', async (_evt, id: string, data: string) => writeTerm(id, data))

ipcMain.handle('term:kill', async (_evt, id: string) => killTerm(id))

ipcMain.handle('term:killAll', async () => {
  killAllTerms()
  return { ok: true }
})

ipcMain.handle('hermes:set', async (_evt, data: unknown) => {
  fs.writeFileSync(hermesPath(), JSON.stringify(data, null, 2), 'utf-8')
  // Also mirror MEMORY.md / USER.md into workspace for human edit
  try {
    const payload = data as {
      memory?: { userProfile?: string; memory?: string }
      soul?: string
      agents?: string
    }
    const root = getDataDir('workspace')
    const hermesDir = path.join(root, 'hermes')
    fs.mkdirSync(hermesDir, { recursive: true })
    if (payload.memory?.userProfile != null) {
      fs.writeFileSync(path.join(hermesDir, 'USER.md'), `# USER.md\n\n${payload.memory.userProfile}\n`, 'utf-8')
    }
    if (payload.memory?.memory != null) {
      fs.writeFileSync(path.join(hermesDir, 'MEMORY.md'), `# MEMORY.md\n\n${payload.memory.memory}\n`, 'utf-8')
    }
    if (payload.soul) {
      fs.writeFileSync(path.join(hermesDir, 'SOUL.md'), payload.soul, 'utf-8')
    }
    if (payload.agents) {
      fs.writeFileSync(path.join(hermesDir, 'AGENTS.md'), payload.agents, 'utf-8')
    }
  } catch {
    /* non-fatal */
  }
  return { ok: true }
})

ipcMain.handle('app:platform', () => process.platform)
ipcMain.handle('app:version', () => app.getVersion())

// ── Workspace: active project root OR sandboxed userData/workspace ──

/** When user picks a project, tools/bash share this root (synced from renderer). */
let activeProjectRoot: string | null = null

function workspaceRoot() {
  if (activeProjectRoot && fs.existsSync(activeProjectRoot)) {
    return activeProjectRoot
  }
  return getDataDir('workspace')
}

function setActiveProjectRoot(root: string | null) {
  if (!root || !String(root).trim()) {
    activeProjectRoot = null
    return { ok: true as const, root: workspaceRoot(), mode: 'sandbox' as const }
  }
  const resolved = path.resolve(root)
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return {
      ok: false as const,
      root: workspaceRoot(),
      mode: activeProjectRoot ? ('project' as const) : ('sandbox' as const),
      error: 'path is not a directory',
    }
  }
  activeProjectRoot = resolved
  return { ok: true as const, root: resolved, mode: 'project' as const }
}

function resolveWorkspacePath(rel: string) {
  const root = workspaceRoot()
  const cleaned = (rel || '.').replace(/^[/\\]+/, '')
  const full = path.resolve(root, cleaned)
  // Ensure path stays inside root (handle trailing sep)
  if (!isPathInside(root, full)) {
    throw new Error('Path escapes workspace sandbox')
  }
  return full
}

ipcMain.handle('tools:workspaceList', async (_evt, relPath = '.') => {
  const dir = resolveWorkspacePath(relPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true }).map((d) => ({
    name: d.name,
    dir: d.isDirectory(),
  }))
  return { path: relPath, entries }
})

ipcMain.handle('tools:workspaceRead', async (_evt, relPath: string) => {
  try {
    const file = resolveWorkspacePath(relPath)
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return { ok: false, content: `Not found: ${relPath}` }
    }
    const content = fs.readFileSync(file, 'utf-8')
    return { ok: true, content: content.slice(0, 200_000) }
  } catch (e) {
    return { ok: false, content: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle('tools:workspaceWrite', async (_evt, relPath: string, content: string) => {
  try {
    const file = resolveWorkspacePath(relPath)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content ?? '', 'utf-8')
    return { ok: true, path: relPath, bytes: Buffer.byteLength(content ?? '', 'utf-8') }
  } catch (e) {
    return {
      ok: false,
      path: relPath,
      bytes: 0,
      error: e instanceof Error ? e.message : String(e),
    }
  }
})

ipcMain.handle('tools:workspaceDownload', async (_evt, targetUrl: string, relPath: string) => {
  try {
    const url = new URL(targetUrl)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http(s) URLs allowed')
    const file = resolveWorkspacePath(relPath)
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = Buffer.from(await res.arrayBuffer())
    if (body.length > 20 * 1024 * 1024) throw new Error('Download exceeds 20MB limit')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, body)
    return { ok: true, path: relPath, bytes: body.length }
  } catch (e) { return { ok: false, path: relPath, bytes: 0, error: e instanceof Error ? e.message : String(e) } }
})

ipcMain.handle('tools:workspaceMkdir', async (_evt, relPath: string) => {
  try { fs.mkdirSync(resolveWorkspacePath(relPath), { recursive: true }); return { ok: true, path: relPath } }
  catch (e) { return { ok: false, path: relPath, error: e instanceof Error ? e.message : String(e) } }
})

ipcMain.handle('tools:workspaceMove', async (_evt, from: string, to: string) => {
  try {
    const source = resolveWorkspacePath(from); const dest = resolveWorkspacePath(to)
    if (!fs.existsSync(source)) throw new Error(`Not found: ${from}`)
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.renameSync(source, dest)
    return { ok: true, from, to }
  } catch (e) { return { ok: false, from, to, error: e instanceof Error ? e.message : String(e) } }
})

ipcMain.handle('tools:workspaceDelete', async (_evt, relPath: string, recursive = false) => {
  try {
    const file = resolveWorkspacePath(relPath)
    if (!fs.existsSync(file)) throw new Error(`Not found: ${relPath}`)
    const stat = fs.statSync(file)
    if (stat.isDirectory() && !recursive) throw new Error('Directory deletion requires recursive=true')
    fs.rmSync(file, { recursive: stat.isDirectory(), force: false })
    return { ok: true, path: relPath }
  } catch (e) { return { ok: false, path: relPath, error: e instanceof Error ? e.message : String(e) } }
})

ipcMain.handle('tools:workspaceRoot', () => workspaceRoot())
ipcMain.handle('tools:workspaceMode', () => ({
  root: workspaceRoot(),
  mode: activeProjectRoot ? 'project' : 'sandbox',
  projectRoot: activeProjectRoot,
}))

// ── Web search (Wikipedia) + HTTP fetch ─────────────────────────

ipcMain.handle('tools:webSearch', async (_evt, query: string, limit = 5) => {
  const q = (query || '').trim()
  if (!q) return { query: q, results: [] }

  const url = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(q)}&limit=${limit}&namespace=0&format=json`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'SubAgentsAI/1.0 (desktop agent; research tool)' },
  })
  if (!res.ok) throw new Error(`Search HTTP ${res.status}`)
  const data = (await res.json()) as [string, string[], string[], string[]]
  const titles = data[1] || []
  const snippets = data[2] || []
  const links = data[3] || []
  return {
    query: q,
    results: titles.map((title, i) => ({
      title,
      snippet: snippets[i] || title,
      url: links[i],
    })),
  }
})

ipcMain.handle('tools:httpFetch', async (_evt, targetUrl: string, maxChars = 4000) => {
  try {
    const u = new URL(targetUrl)
    if (!['http:', 'https:'].includes(u.protocol)) {
      return { ok: false, text: 'Only http(s) URLs allowed', status: 0 }
    }
    const res = await fetch(u.toString(), {
      headers: { 'User-Agent': 'SubAgentsAI/1.0' },
      redirect: 'follow',
    })
    const text = (await res.text()).slice(0, maxChars)
    return { ok: res.ok, text, status: res.status }
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : String(e), status: 0 }
  }
})

ipcMain.handle('tools:httpRequest', async (_evt, input: { url: string; method?: string; headers?: Record<string, string>; body?: string; maxChars?: number }) => {
  try {
    const url = new URL(input.url)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http(s) URLs allowed')
    const res = await fetch(url, { method: input.method || 'GET', headers: input.headers, body: input.body, redirect: 'follow' })
    return { ok: res.ok, text: (await res.text()).slice(0, Math.min(Number(input.maxChars) || 50_000, 200_000)), status: res.status }
  } catch (e) { return { ok: false, text: e instanceof Error ? e.message : String(e), status: 0 } }
})

// ── Persistent memory ───────────────────────────────────────────

function memoryPath() {
  return path.join(getDataDir('config'), 'memory.json')
}

function readMemory(): Record<string, string> {
  const file = memoryPath()
  if (!fs.existsSync(file)) return {}
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return {}
  }
}

function writeMemory(map: Record<string, string>) {
  fs.writeFileSync(memoryPath(), JSON.stringify(map, null, 2), 'utf-8')
}

ipcMain.handle('tools:memorySet', async (_evt, key: string, value: string) => {
  const map = readMemory()
  map[key] = value
  writeMemory(map)
  return { ok: true }
})

ipcMain.handle('tools:memoryGet', async (_evt, key: string) => {
  const map = readMemory()
  return map[key] ?? null
})

// ── Scheduler jobs persistence ──────────────────────────────────

function jobsPath() {
  return path.join(getDataDir('config'), 'jobs.json')
}

function eventsPath() {
  return path.join(getDataDir('config'), 'events.json')
}

ipcMain.handle('scheduler:list', async () => {
  const file = jobsPath()
  if (!fs.existsSync(file)) return []
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return []
  }
})

ipcMain.handle('scheduler:saveAll', async (_evt, jobs: unknown) => {
  fs.writeFileSync(jobsPath(), JSON.stringify(jobs, null, 2), 'utf-8')
  return { ok: true }
})

ipcMain.handle('events:list', async () => {
  const file = eventsPath()
  if (!fs.existsSync(file)) return []
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return []
  }
})

ipcMain.handle('events:saveAll', async (_evt, events: unknown) => {
  fs.writeFileSync(eventsPath(), JSON.stringify(events, null, 2), 'utf-8')
  return { ok: true }
})

// Notify renderer when a due job might need running (optional tick)
let scheduleTimer: ReturnType<typeof setInterval> | null = null

function startScheduleTicker() {
  if (scheduleTimer) return
  scheduleTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send('scheduler:tick', { at: new Date().toISOString() })
  }, 15_000)
}
