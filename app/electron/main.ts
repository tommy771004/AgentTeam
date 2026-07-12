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
  clearVaultSecret,
  getVaultSecret,
  hasSecretPlaceholder,
  listVaultMeta,
  migrateIntoVault,
  resolveSecretPlaceholders,
  setVaultSecret,
} from './secretsVault'
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
  quoteShellArg,
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

/**
 * Resolve SubAgents brand icon for window / tray / notifications.
 *
 * Search order (real filesystem paths first — Windows shell cannot use asar paths):
 * 1. Packaged extraResources → resources/app-icons/ (from build/icons + public/brand)
 * 2. Dev build/icons + public/brand (npm run icons output)
 * 3. Vite dist/brand (copied from public/)
 *
 * Master: build/icons/icon.svg → `npm run icons` → build/icons/* + public/favicon* + public/brand/*
 * Windows taskbar: must use a real .ico path + setIcon(); a bad BrowserWindow.icon
 * overrides the .exe resource and falls back to the default Electron atom.
 */
function iconSearchDirs(): string[] {
  const distDir = process.env.DIST || path.join(__dirname, '../dist')
  const dirs = [
    // packaged extraResources (outside asar — preferred)
    path.join(process.resourcesPath, 'app-icons'),
    path.join(process.resourcesPath, 'icons'),
    // dev / pre-package
    path.join(__dirname, '../build/icons'),
    path.join(__dirname, '../build'),
    path.join(__dirname, '../public/brand'),
    path.join(__dirname, '../public'),
    // Vite public → dist
    path.join(distDir, 'brand'),
    distDir,
  ]
  // asar / app path last (readable via Electron fs, but bad for native HICON)
  try {
    const appPath = app.getAppPath()
    dirs.push(
      path.join(appPath, 'build', 'icons'),
      path.join(appPath, 'build'),
      path.join(appPath, 'dist', 'brand'),
      path.join(appPath, 'dist'),
      path.join(appPath, 'public', 'brand'),
      path.join(appPath, 'public'),
    )
  } catch {
    /* app not ready */
  }
  return dirs
}

function resolveAppIconPath(prefer: 'window' | 'tray' = 'window'): string | null {
  const names =
    prefer === 'tray'
      ? [
          'icon-32.png',
          'icon-64.png',
          'icon-256.png',
          'icon.png',
          'subagents-icon-32.png',
          'subagents-icon-64.png',
          'subagents-icon-512.png',
          'favicon-32.png',
        ]
      : process.platform === 'win32'
        ? [
            'icon.ico',
            'icon-256.png',
            'icon-512.png',
            'icon.png',
            'icon-128.png',
            'subagents-icon-512.png',
            'subagents-icon-1024.png',
            'subagents-icon-128.png',
            'subagents-icon-64.png',
          ]
        : [
            'icon-256.png',
            'icon-512.png',
            'icon.png',
            'icon-128.png',
            'subagents-icon-512.png',
            'subagents-icon-1024.png',
            'subagents-icon-128.png',
            'icon.ico',
          ]

  for (const dir of iconSearchDirs()) {
    for (const n of names) {
      const p = path.join(dir, n)
      try {
        if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
      } catch {
        /* ignore */
      }
    }
  }
  return null
}

/**
 * Windows shell APIs need a real filesystem path (not inside asar).
 * Copy the brand icon into userData so setIcon always has a stable path.
 */
function materializeWindowsIcon(): string | null {
  if (process.platform !== 'win32') return null
  const src = resolveAppIconPath('window')
  if (!src) return null
  try {
    const inAsar = src.includes(`${path.sep}app.asar${path.sep}`) || src.includes('/app.asar/')
    // Prefer already-outside-asar file that nativeImage can load
    if (!inAsar) {
      const img = nativeImage.createFromPath(src)
      if (!img.isEmpty()) return src
    }
    const destDir = path.join(app.getPath('userData'), 'app-icons')
    fs.mkdirSync(destDir, { recursive: true })
    const outName = /\.ico$/i.test(src) ? 'icon.ico' : path.basename(src)
    const outPath = path.join(destDir, outName)
    fs.copyFileSync(src, outPath)
    const check = nativeImage.createFromPath(outPath)
    if (check.isEmpty()) {
      console.warn('[icon] materialize produced empty image', outPath)
      return src
    }
    return outPath
  } catch (e) {
    console.warn('[icon] materialize failed', e)
    return src
  }
}

function loadAppIcon(prefer: 'window' | 'tray' = 'window'): Electron.NativeImage {
  const p =
    prefer === 'window' && process.platform === 'win32'
      ? materializeWindowsIcon() || resolveAppIconPath(prefer)
      : resolveAppIconPath(prefer)
  if (p) {
    const img = nativeImage.createFromPath(p)
    if (!img.isEmpty()) {
      if (prefer === 'tray' && process.platform === 'win32') {
        return img.resize({ width: 32, height: 32 })
      }
      return img
    }
    console.warn('[icon] nativeImage empty for', p)
  }
  return nativeImage.createEmpty()
}

/** BrowserWindow.icon option — only set when we have a verified non-empty image. */
function browserWindowIconOption(): { icon: string | Electron.NativeImage } | Record<string, never> {
  if (process.platform === 'win32') {
    const iconPath = materializeWindowsIcon() || resolveAppIconPath('window')
    if (!iconPath) return {}
    const img = nativeImage.createFromPath(iconPath)
    if (img.isEmpty()) {
      console.warn('[icon] skip BrowserWindow.icon — empty image at', iconPath)
      return {}
    }
    // Path string for .ico is most reliable for Windows chrome; NativeImage for PNG.
    if (/\.ico$/i.test(iconPath)) return { icon: iconPath }
    return { icon: img }
  }
  const iconPath = resolveAppIconPath('window')
  if (!iconPath) return {}
  const img = nativeImage.createFromPath(iconPath)
  if (img.isEmpty()) return {}
  return { icon: img }
}

/** Apply icon after window exists — constructor alone is not enough on some Win builds. */
function applyWindowIcon(win: BrowserWindow) {
  if (process.platform === 'win32') {
    const iconPath = materializeWindowsIcon() || resolveAppIconPath('window')
    if (iconPath) {
      try {
        win.setIcon(iconPath)
        console.log('[icon] setIcon ←', iconPath)
        return
      } catch (e) {
        console.warn('[icon] setIcon(path) failed', e)
      }
    }
  }
  const img = loadAppIcon('window')
  if (!img.isEmpty()) {
    try {
      win.setIcon(img)
      console.log('[icon] setIcon ← NativeImage', resolveAppIconPath('window'))
    } catch (e) {
      console.warn('[icon] setIcon(image) failed', e)
    }
  } else {
    console.warn('[icon] no brand icon found — window may show Electron default')
  }
}

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
  let icon = loadAppIcon('tray')
  if (icon.isEmpty()) {
    // Fallback 1x1 only if brand assets missing
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKElEQVQ4T2NkYGD4z0ABYBzVMKoBBgP+/ydFG6MaRjWM5gE0NQAAK3YB/0m3w0sAAAAASUVORK5CYII=',
      'base64',
    )
    icon = nativeImage.createFromBuffer(png)
  }
  tray = new Tray(icon)
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
  const winIconOpt = browserWindowIconOption()
  if (winIconOpt.icon && typeof winIconOpt.icon === 'string') {
    console.log('[icon] BrowserWindow ctor ←', winIconOpt.icon)
  } else if (winIconOpt.icon) {
    console.log('[icon] BrowserWindow ctor ← NativeImage', resolveAppIconPath('window'))
  } else {
    console.warn('[icon] BrowserWindow ctor — no icon option (exe resource / setIcon fallback)')
  }
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'SubAgents AI',
    backgroundColor: '#0b1326',
    // Window / taskbar icon (dev + packaged). Packaged .exe also uses build/icon.ico.
    ...winIconOpt,
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

  // Constructor icon is flaky on Windows — re-apply after create + before show
  applyWindowIcon(mainWindow)

  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('[preload-error]', preloadPath, error)
  })

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      applyWindowIcon(mainWindow)
      mainWindow.show()
    }
  })

  // Close → tray (background scheduler keeps running)
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
      if (Notification.isSupported()) {
        const nIcon = loadAppIcon('tray')
        new Notification({
          title: 'SubAgents AI',
          body: '已在背景執行，排程仍會持續運作。',
          ...(nIcon.isEmpty() ? {} : { icon: nIcon }),
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
  // Windows taskbar grouping + correct Jump List icon identity
  if (process.platform === 'win32') {
    app.setAppUserModelId('ai.subagents.desktop')
  }
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
      fallbackModels?: string[]
      messages: unknown[]
      temperature?: number
      max_tokens?: number
      tools?: unknown[]
      tool_choice?: unknown
    },
  ) => {
    const base = (req.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')
    const candidates = [...new Set([req.model, ...(req.fallbackModels || [])].map((id) => id.trim()).filter(Boolean))]
    type ChatResponse = {
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
    let data: ChatResponse | undefined
    let usedModel = req.model
    let lastError = ''

    for (const model of candidates) {
      const payload: Record<string, unknown> = {
        model,
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
      if (res.ok) {
        data = (await res.json()) as ChatResponse
        usedModel = model
        break
      }
      const errText = await res.text().catch(() => res.statusText)
      lastError = `LLM HTTP ${res.status}: ${errText.slice(0, 300)}`
      // Do not mask authentication, schema, or quota errors. Retry only the
      // transient gateway condition reported by AIHubMix-compatible routers.
      if (!errText.includes('no_available_channel')) break
    }
    if (!data) throw new Error(lastError || 'LLM request failed')

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
      model: data.model || usedModel,
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
  ) => {
    // P1-A: resolve vault placeholders in MCP HTTP auth headers main-side
    const headers = Object.fromEntries(
      Object.entries(input?.headers || {}).map(([k, v]) => [
        k,
        typeof v === 'string' && hasSecretPlaceholder(v)
          ? resolveSecretPlaceholders(v, currentCustomToolSecrets()).text
          : v,
      ]),
    )
    return mcpHttpRpc({ ...input, headers })
  },
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

/**
 * W2 / P0-B: read persistent project guidance (AGENTS.md hierarchy).
 * Read-only, name-allowlisted, size-capped.
 *
 * When workPath is under project root, walks from the work file/dir UP to
 * project root (subdirectory AGENTS), then continues parent-of-root levels.
 * Layer order: farthest parent first → nearest work dir last.
 */
ipcMain.handle(
  'project:agentsDocs',
  async (_evt, root: string, workPath?: string) => {
    const AGENTS_FILES = ['AGENTS.md', 'CLAUDE.md']
    const MAX_BYTES = 24_000
    const MAX_LEVELS_UP = 3
    const MAX_SUB_LEVELS = 8
    const docs: Array<{
      path: string
      scope: 'project' | 'project-parent' | 'project-subdir'
      bytes: number
      truncated: boolean
      mtimeMs: number
      content: string
    }> = []
    const seen = new Set<string>()

    const pushDoc = (
      d: string,
      scope: 'project' | 'project-parent' | 'project-subdir',
    ) => {
      for (const name of AGENTS_FILES) {
        const p = path.join(d, name)
        try {
          if (seen.has(p) || !fs.existsSync(p)) continue
          const st = fs.statSync(p)
          if (!st.isFile()) continue
          const raw = fs.readFileSync(p, 'utf-8')
          const truncated = Buffer.byteLength(raw, 'utf8') > MAX_BYTES
          docs.push({
            path: p,
            scope,
            bytes: Buffer.byteLength(raw, 'utf8'),
            truncated,
            mtimeMs: st.mtimeMs,
            content: truncated ? raw.slice(0, MAX_BYTES) : raw,
          })
          seen.add(p)
          return // one guidance file per directory
        } catch {
          /* skip */
        }
      }
    }

    try {
      const projectRoot = path.resolve(String(root || '').trim())
      if (
        !projectRoot ||
        !fs.existsSync(projectRoot) ||
        !fs.statSync(projectRoot).isDirectory()
      ) {
        return { docs }
      }

      // 1) Subdirectory chain: workPath → … → projectRoot (nearest last)
      const subChain: string[] = []
      const work = workPath ? path.resolve(String(workPath).trim()) : ''
      if (work && isPathInside(projectRoot, work)) {
        let d = fs.existsSync(work) && fs.statSync(work).isDirectory() ? work : path.dirname(work)
        for (let i = 0; i < MAX_SUB_LEVELS; i++) {
          if (!isPathInside(projectRoot, d) && d !== projectRoot) break
          subChain.push(d)
          if (d === projectRoot) break
          const parent = path.dirname(d)
          if (parent === d) break
          d = parent
        }
      } else {
        subChain.push(projectRoot)
      }
      // parent-most of subchain first
      for (const d of subChain.reverse()) {
        pushDoc(d, d === projectRoot ? 'project' : 'project-subdir')
      }

      // 2) Parents of project root (repo → workspace)
      let dir = projectRoot
      for (let i = 0; i < MAX_LEVELS_UP; i++) {
        if (fs.existsSync(path.join(dir, '.git')) && dir === projectRoot) {
          // stay: already included project root
        }
        const parent = path.dirname(dir)
        if (parent === dir) break
        if (fs.existsSync(path.join(dir, '.git')) && dir !== projectRoot) break
        dir = parent
        // insert parents at front (farthest first already via push order after reverse)
        // We push after project docs; re-order: parent docs should precede project
      }
      // Re-walk parents cleanly and prepend
      const parentChain: string[] = []
      dir = projectRoot
      for (let i = 0; i < MAX_LEVELS_UP; i++) {
        const parent = path.dirname(dir)
        if (parent === dir) break
        if (fs.existsSync(path.join(dir, '.git'))) break
        parentChain.push(parent)
        dir = parent
      }
      // parent-most first
      const parentDocs: typeof docs = []
      for (const d of parentChain.reverse()) {
        const before = docs.length + parentDocs.length
        for (const name of AGENTS_FILES) {
          const p = path.join(d, name)
          try {
            if (seen.has(p) || !fs.existsSync(p)) continue
            const st = fs.statSync(p)
            if (!st.isFile()) continue
            const raw = fs.readFileSync(p, 'utf-8')
            const truncated = Buffer.byteLength(raw, 'utf8') > MAX_BYTES
            parentDocs.push({
              path: p,
              scope: 'project-parent',
              bytes: Buffer.byteLength(raw, 'utf8'),
              truncated,
              mtimeMs: st.mtimeMs,
              content: truncated ? raw.slice(0, MAX_BYTES) : raw,
            })
            seen.add(p)
            break
          } catch {
            /* skip */
          }
        }
        void before
      }
      return { docs: [...parentDocs, ...docs] }
    } catch {
      /* return what we have */
    }
    return { docs }
  },
)

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
    evt,
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
      runId?: string
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
    const { isVisionImageTooSmall } = await import('./attachmentStore')
    const attachments = (input.attachments || []).slice(0, 4).map((a) => {
      const name = String(a.name || 'file').slice(0, 200)
      const dataUrl =
        typeof a.dataUrl === 'string' && a.dataUrl.length < 12_000_000
          ? a.dataUrl
          : undefined
      // CLI adapters classify any data:image URL as visual input even when a
      // restored attachment lost its `kind`. Gate on the payload, not UI state.
      const isImagePayload =
        dataUrl !== undefined &&
        (a.kind === 'image' ||
          /^data:image\//i.test(dataUrl) ||
          (a.mimeType || '').toLowerCase().startsWith('image/'))
      // Final main-process gate: an outdated renderer or a restored queue must
      // never pass a tiny image to Grok/other vision CLIs and fail the whole run.
      if (isImagePayload && dataUrl && isVisionImageTooSmall(dataUrl)) {
        return {
          name: `${name}.txt`,
          mimeType: 'text/plain',
          kind: 'text' as const,
          textContent:
            `圖片「${name}」低於 vision 最小尺寸（512 總像素），已略過視覺傳送以避免 CLI 400 錯誤。`,
        }
      }
      return {
        name,
        mimeType: a.mimeType,
        kind: a.kind,
        dataUrl,
        textContent:
          typeof a.textContent === 'string'
            ? a.textContent.slice(0, 200_000)
            : undefined,
      }
    })
    return runLocalCliAgent({
      ...input,
      cwd,
      attachments,
      onStream: (ev) => {
        try {
          if (!evt.sender.isDestroyed()) {
            evt.sender.send('cli:stream', ev)
          }
        } catch {
          /* ignore */
        }
      },
    })
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

function workspaceRootFor(rootOverride?: unknown) {
  const requested = String(rootOverride || '').trim()
  if (requested) {
    const resolved = path.resolve(requested)
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) return resolved
  }
  return workspaceRoot()
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

/**
 * Resolve path under workspace. Optional rootOverride pins a per-run project
 * (scheduler A while UI shows B) without mutating global activeProjectRoot.
 */
function resolveWorkspacePath(rel: string, rootOverride?: string | null) {
  let root = workspaceRoot()
  if (rootOverride && String(rootOverride).trim()) {
    const resolved = path.resolve(String(rootOverride).trim())
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      root = resolved
    }
  }
  const cleaned = (rel || '.').replace(/^[/\\]+/, '')
  const full = path.resolve(root, cleaned)
  // Ensure path stays inside root (handle trailing sep)
  if (!isPathInside(root, full)) {
    throw new Error('Path escapes workspace sandbox')
  }
  return full
}

function parseWorkspaceArgs(
  a: unknown,
  b?: unknown,
): { relPath: string; projectRoot?: string } {
  // New form: ({ path, projectRoot }) or (path, projectRoot)
  if (a && typeof a === 'object' && !Array.isArray(a)) {
    const o = a as { path?: string; relPath?: string; projectRoot?: string }
    return {
      relPath: String(o.path ?? o.relPath ?? '.'),
      projectRoot: o.projectRoot ? String(o.projectRoot) : undefined,
    }
  }
  return {
    relPath: String(a ?? '.'),
    projectRoot: typeof b === 'string' && b.trim() ? b.trim() : undefined,
  }
}

ipcMain.handle('tools:workspaceList', async (_evt, a?: unknown, b?: unknown) => {
  const { relPath, projectRoot } = parseWorkspaceArgs(a ?? '.', b)
  const dir = resolveWorkspacePath(relPath, projectRoot)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true }).map((d) => ({
    name: d.name,
    dir: d.isDirectory(),
  }))
  return { path: relPath, entries, projectRoot: projectRoot || activeProjectRoot }
})

ipcMain.handle('tools:workspaceRead', async (_evt, a: unknown, b?: unknown) => {
  try {
    const { relPath, projectRoot } = parseWorkspaceArgs(a, b)
    const file = resolveWorkspacePath(relPath, projectRoot)
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return { ok: false, content: `Not found: ${relPath}` }
    }
    const content = fs.readFileSync(file, 'utf-8')
    return { ok: true, content: content.slice(0, 200_000) }
  } catch (e) {
    return { ok: false, content: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle('tools:workspaceWrite', async (_evt, a: unknown, b?: unknown, c?: unknown) => {
  // (relPath, content) | (relPath, content, projectRoot) | ({ path, content, projectRoot })
  try {
    let relPath: string
    let content: string
    let projectRoot: string | undefined
    if (a && typeof a === 'object' && !Array.isArray(a)) {
      const o = a as { path?: string; content?: string; projectRoot?: string }
      relPath = String(o.path || '.')
      content = String(o.content ?? '')
      projectRoot = o.projectRoot
    } else {
      relPath = String(a || '.')
      content = String(b ?? '')
      projectRoot = typeof c === 'string' ? c : undefined
    }
    const file = resolveWorkspacePath(relPath, projectRoot)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content ?? '', 'utf-8')
    return { ok: true, path: relPath, bytes: Buffer.byteLength(content ?? '', 'utf-8') }
  } catch (e) {
    return {
      ok: false,
      path: String(a),
      bytes: 0,
      error: e instanceof Error ? e.message : String(e),
    }
  }
})

ipcMain.handle('tools:workspaceDiff', async (_evt, rawPaths?: unknown, projectRoot?: unknown) => {
  try {
    const root = workspaceRootFor(projectRoot)
    if (!fs.existsSync(path.join(root, '.git'))) {
      return { ok: false, diff: '', files: [], error: '目前專案不是 Git working tree' }
    }
    const paths = Array.isArray(rawPaths)
      ? rawPaths
          .map((value) => String(value || '').trim())
          .filter(Boolean)
          .slice(0, 80)
      : []
    // Validate every supplied path before putting it into the shell command.
    for (const rel of paths) resolveWorkspacePath(rel, root)
    const scope = paths.length ? ` -- ${paths.map((value) => quoteShellArg(value)).join(' ')}` : ''
    const result = await runBash({
      command: `git diff --no-ext-diff --unified=3${scope}`,
      cwd: root,
      timeoutMs: 15_000,
    })
    return {
      ok: result.ok,
      diff: result.stdout.slice(0, 200_000),
      files: paths,
      error: result.ok ? undefined : result.stderr.slice(0, 600),
    }
  } catch (e) {
    return { ok: false, diff: '', files: [], error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle('tools:workspaceDownload', async (_evt, targetUrl: string, relPath: string, projectRoot?: string) => {
  try {
    const url = new URL(targetUrl)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http(s) URLs allowed')
    const file = resolveWorkspacePath(relPath, projectRoot)
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = Buffer.from(await res.arrayBuffer())
    if (body.length > 20 * 1024 * 1024) throw new Error('Download exceeds 20MB limit')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, body)
    return { ok: true, path: relPath, bytes: body.length }
  } catch (e) { return { ok: false, path: relPath, bytes: 0, error: e instanceof Error ? e.message : String(e) } }
})

ipcMain.handle('tools:workspaceMkdir', async (_evt, relPath: string, projectRoot?: string) => {
  try { fs.mkdirSync(resolveWorkspacePath(relPath, projectRoot), { recursive: true }); return { ok: true, path: relPath } }
  catch (e) { return { ok: false, path: relPath, error: e instanceof Error ? e.message : String(e) } }
})

ipcMain.handle('tools:workspaceMove', async (_evt, from: string, to: string, projectRoot?: string) => {
  try {
    const source = resolveWorkspacePath(from, projectRoot); const dest = resolveWorkspacePath(to, projectRoot)
    if (!fs.existsSync(source)) throw new Error(`Not found: ${from}`)
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.renameSync(source, dest)
    return { ok: true, from, to }
  } catch (e) { return { ok: false, from, to, error: e instanceof Error ? e.message : String(e) } }
})

ipcMain.handle('tools:workspaceDelete', async (_evt, relPath: string, recursive = false, projectRoot?: string) => {
  try {
    const file = resolveWorkspacePath(relPath, projectRoot)
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

/** Decrypted customToolSecrets from the settings file (main-side only). */
function currentCustomToolSecrets(): Record<string, string> {
  try {
    const file = settingsPath()
    if (!fs.existsSync(file)) return {}
    const s = settingsForRenderer(JSON.parse(fs.readFileSync(file, 'utf-8'))) as {
      customToolSecrets?: Record<string, string>
    }
    return s?.customToolSecrets || {}
  } catch {
    return {}
  }
}

ipcMain.handle('tools:httpRequest', async (_evt, input: { url: string; method?: string; headers?: Record<string, string>; body?: string; maxChars?: number }) => {
  try {
    // P1-A: resolve {{secret:key}} placeholders MAIN-side — raw tokens never
    // travel through / persist in the renderer.
    const custom = currentCustomToolSecrets()
    const missing: string[] = []
    const resolveText = (t: string | undefined): string | undefined => {
      if (!t || !hasSecretPlaceholder(t)) return t
      const r = resolveSecretPlaceholders(t, custom)
      missing.push(...r.missing)
      return r.text
    }
    const urlText = resolveText(input.url) || input.url
    const headers = Object.fromEntries(
      Object.entries(input.headers || {}).map(([k, v]) => [k, resolveText(v) ?? v]),
    )
    const body = resolveText(input.body)
    if (missing.length) {
      return {
        ok: false,
        text: `缺少 secret：${[...new Set(missing)].join(', ')} — 請在 Marketplace 授權或 Settings 補填`,
        status: 0,
      }
    }
    const url = new URL(urlText)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http(s) URLs allowed')
    const res = await fetch(url, { method: input.method || 'GET', headers, body, redirect: 'follow' })
    return { ok: res.ok, text: (await res.text()).slice(0, Math.min(Number(input.maxChars) || 50_000, 200_000)), status: res.status }
  } catch (e) { return { ok: false, text: e instanceof Error ? e.message : String(e), status: 0 } }
})

// ── P1-A: connector credential vault (renderer sees metadata only) ──

ipcMain.handle('secrets:list', async () => listVaultMeta())

ipcMain.handle(
  'secrets:store',
  async (
    _evt,
    input: {
      id: string
      token: string
      refreshToken?: string
      expiresIn?: number
      expiresAt?: number
      tokenType?: string
      keepRefreshToken?: boolean
    },
  ) => {
    if (!input?.id || !input?.token?.trim()) {
      return { ok: false as const, error: 'id 與 token 必填' }
    }
    const meta = setVaultSecret(input.id, input.token, input)
    return { ok: true as const, meta }
  },
)

ipcMain.handle('secrets:clear', async (_evt, id: string) => {
  clearVaultSecret(String(id || ''))
  return { ok: true }
})

ipcMain.handle(
  'secrets:migrate',
  async (_evt, map: Record<string, { token: string; refreshToken?: string; expiresAt?: number; tokenType?: string; updatedAt?: string }>) => {
    const imported = migrateIntoVault(
      (map || {}) as Record<string, import('./secretsVault').VaultRecord>,
    )
    return { ok: true, imported }
  },
)

/** Refresh using the vault's refresh_token — token never leaves main. */
ipcMain.handle(
  'secrets:refresh',
  async (
    _evt,
    input: {
      pluginId: string
      clientId: string
      clientSecret?: string
      tokenUrl: string
      tokenAuth?: 'body' | 'basic'
    },
  ) => {
    const rec = getVaultSecret(String(input?.pluginId || ''))
    if (!rec?.refreshToken) {
      return { ok: false as const, error: 'vault 中沒有 refresh_token' }
    }
    const r = await refreshOAuthToken({
      pluginId: input.pluginId,
      refreshToken: rec.refreshToken,
      clientId: String(input?.clientId || ''),
      clientSecret: input?.clientSecret,
      tokenUrl: String(input?.tokenUrl || ''),
      tokenAuth: input?.tokenAuth,
    })
    if (!r.ok || !r.accessToken) {
      return { ok: false as const, error: r.error || 'refresh 失敗' }
    }
    const meta = setVaultSecret(input.pluginId, r.accessToken, {
      refreshToken: r.refreshToken,
      expiresIn: r.expiresIn,
      tokenType: r.tokenType,
      keepRefreshToken: true,
    })
    return { ok: true as const, meta }
  },
)

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
