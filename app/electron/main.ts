import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  Tray,
  Menu,
  nativeImage,
  Notification,
  dialog,
  powerSaveBlocker,
  safeStorage,
} from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { spawn } from 'node:child_process'
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
  dispatchWebhook,
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
  resolveOpenCodeInstructions,
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
import {
  disconnectContentPublish,
  listContentPublishStatus,
  publishContent,
  runContentPublishOAuth,
  type ContentPublishBridgeInput,
  type ContentPublishOAuthInput,
} from './contentPublishBridge'
import {
  createSubDesignProjectWorkspace,
  isPrivateReferenceHost,
  type SubDesignExportProcess,
  type SubDesignWorkspaceFileStore,
  type SubDesignWorkspaceCrypto,
  type SubDesignVendorFileStore,
} from '../src/agent/subdesign/projectWorkspace'
import type {
  SubDesignArtifact,
  SubDesignExportFormat,
  SubDesignStage,
} from '../src/agent/subdesign/types'
import type { CliConfigSnapshot } from '../src/agent/types'
import {
  abortOpenCodeRun,
  checkOpenCodeServer,
  getOpenCodeServerInfo,
  openCodeServerRequest,
  runOpenCodeServerPrompt,
  startOpenCodeServer,
  stopOpenCodeServers,
  type OpenCodeServerMode,
} from './opencodeServerBridge'

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
  void stopOpenCodeServers()
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

ipcMain.handle(
  'webhook:dispatch',
  async (_evt, request: { target: string; payload: Record<string, unknown> }) =>
    dispatchWebhook(request),
)

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

// ── Content publishing OAuth/API (tokens stay in main vault) ─────

ipcMain.handle(
  'contentPublishing:oauth',
  async (evt, input: ContentPublishOAuthInput) =>
    runContentPublishOAuth(input, evt.sender),
)

ipcMain.handle('contentPublishing:status', async () => listContentPublishStatus())

ipcMain.handle('contentPublishing:disconnect', async (_evt, platform: string) =>
  disconnectContentPublish(platform),
)

ipcMain.handle(
  'contentPublishing:publish',
  async (_evt, input: ContentPublishBridgeInput) => publishContent(input),
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
    input: { command: string; cwd?: string; timeoutMs?: number; runId?: string },
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
ipcMain.handle('opencode:resolveInstructions', async (_evt, input: { projectRoot?: string; entries?: string[] }) =>
  resolveOpenCodeInstructions(
    input?.projectRoot && fs.existsSync(input.projectRoot) ? input.projectRoot : workspaceRoot(),
    Array.isArray(input?.entries) ? input.entries : [],
  ),
)

// ── OpenCode localhost server adapter ──────────────────────────

ipcMain.handle('opencodeServer:health', async (_evt, url?: string) => checkOpenCodeServer(url))
ipcMain.handle('opencodeServer:info', async (_evt, url?: string) => getOpenCodeServerInfo(url))
ipcMain.handle('opencodeServer:start', async (_evt, opts?: { cwd?: string; port?: number }) =>
  startOpenCodeServer({
    cwd: opts?.cwd && fs.existsSync(opts.cwd) ? opts.cwd : workspaceRoot(),
    port: opts?.port,
  }),
)
ipcMain.handle('opencodeServer:stop', async () => stopOpenCodeServers())
ipcMain.handle('opencodeServer:abort', async (_evt, runId?: string) => abortOpenCodeRun(runId))
ipcMain.handle('opencodeServer:config', async (_evt, url: string) =>
  openCodeServerRequest(url, '/config'),
)
ipcMain.handle('opencodeServer:providers', async (_evt, url: string) =>
  openCodeServerRequest(url, '/config/providers'),
)
ipcMain.handle('opencodeServer:experimentalToolIds', async (_evt, url: string) =>
  openCodeServerRequest(url, '/experimental/tool/ids'),
)
ipcMain.handle('opencodeServer:sessions', async (_evt, url: string) =>
  openCodeServerRequest(url, '/session'),
)
ipcMain.handle('opencodeServer:children', async (_evt, input: { url: string; sessionId: string }) =>
  openCodeServerRequest(input.url, `/session/${encodeURIComponent(input.sessionId)}/children`),
)
ipcMain.handle('opencodeServer:todo', async (_evt, input: { url: string; sessionId: string }) =>
  openCodeServerRequest(input.url, `/session/${encodeURIComponent(input.sessionId)}/todo`),
)
ipcMain.handle('opencodeServer:fork', async (_evt, input: { url: string; sessionId: string; messageId?: string }) =>
  openCodeServerRequest(input.url, `/session/${encodeURIComponent(input.sessionId)}/fork`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input.messageId ? { messageID: input.messageId } : {}),
  }),
)
ipcMain.handle('opencodeServer:diff', async (_evt, input: { url: string; sessionId: string }) =>
  openCodeServerRequest(input.url, `/session/${encodeURIComponent(input.sessionId)}/diff`),
)
ipcMain.handle('opencodeServer:revert', async (_evt, input: { url: string; sessionId: string; messageId: string; partId?: string }) =>
  openCodeServerRequest(input.url, `/session/${encodeURIComponent(input.sessionId)}/revert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messageID: input.messageId, partID: input.partId }),
  }),
)
ipcMain.handle('opencodeServer:lsp', async (_evt, url: string) =>
  openCodeServerRequest(url, '/lsp'),
)
ipcMain.handle('opencodeServer:formatter', async (_evt, url: string) =>
  openCodeServerRequest(url, '/formatter'),
)
ipcMain.handle('opencodeServer:mcp', async (_evt, url: string) =>
  openCodeServerRequest(url, '/mcp'),
)
ipcMain.handle('opencodeServer:agents', async (_evt, url: string) =>
  openCodeServerRequest(url, '/agent'),
)

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
      thinkingVariant?: string
      showThinking?: boolean
      serverMode?: OpenCodeServerMode
      serverUrl?: string
      approvalMode?: 'always' | 'auto' | 'full'
      unattended?: boolean
      timeoutMs?: number
      runId?: string
      configSnapshot?: CliConfigSnapshot
      attachments?: Array<{
        name: string
        mimeType?: string
        kind?: 'image' | 'text' | 'binary'
        dataUrl?: string
        textContent?: string
        filePath?: string
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
        filePath: typeof a.filePath === 'string' ? a.filePath.slice(0, 1200) : undefined,
      }
    })
    if (input.kind === 'opencode' && input.serverMode === 'server' && attachments.length > 0) {
      return {
        ok: false,
        output: '',
        command: 'opencode server',
        kind: 'opencode' as const,
        code: 2,
        error: 'OpenCode server mode 暫不接受附件；請改用 auto/cli 以走一次性 CLI attachment adapter。',
        runId: input.runId,
        configSnapshot: input.configSnapshot,
      }
    }
    if (input.kind === 'opencode' && input.serverMode !== 'cli' && attachments.length === 0) {
      const serverRunId = input.runId || `oc_${Date.now().toString(36)}`
      const externalStartedAt = new Date().toISOString()
      const server = await runOpenCodeServerPrompt({
        mode: input.serverMode || 'auto',
        baseUrl: input.serverUrl,
        prompt: input.prompt,
        cwd,
        model: input.model,
        agent: input.agentMode === 'plan' ? 'plan' : 'build',
        runId: serverRunId,
        timeoutMs: input.timeoutMs,
        onEvent: (event) => {
          try {
            if (!evt.sender.isDestroyed()) evt.sender.send('cli:stream', { ...event, runId: serverRunId })
          } catch {
            /* ignore */
          }
        },
      })
      if (server.used) {
        return {
          ok: server.ok,
          output: server.output,
          command: `opencode server ${server.baseUrl || input.serverUrl || ''} session=${server.sessionId || '—'}`,
          kind: 'opencode' as const,
          code: server.ok ? 0 : 1,
          timedOut: server.timedOut,
          cancelled: server.cancelled,
          error: server.error,
          runId: serverRunId,
          configSnapshot: input.configSnapshot,
          externalRun: {
            provider: 'opencode' as const,
            serverUrl: server.baseUrl,
            sessionId: server.sessionId,
            version: server.version,
            configFingerprint: input.configSnapshot
              ? createHash('sha256').update(JSON.stringify(input.configSnapshot)).digest('hex').slice(0, 16)
              : undefined,
            status: server.ok ? 'success' as const : server.cancelled ? 'aborted' as const : 'failed' as const,
            completionReason: server.completionReason,
            startedAt: externalStartedAt,
            finishedAt: new Date().toISOString(),
          },
        }
      }
    }
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

/** Cancel one CLI specialist run; legacy no-arg calls still cancel the tagged group. */
ipcMain.handle('cli:cancel', async (_evt, runId?: string) => {
  const [cli, server] = await Promise.all([
    Promise.resolve(runId ? cancelBash({ runId }) : cancelBash({ tag: 'cli-agent' })),
    abortOpenCodeRun(runId),
  ])
  return { ok: cli.ok || server.ok, killed: cli.killed + server.killed }
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

function workspaceRootFor(rootOverride?: unknown, options?: { required?: boolean }) {
  const requested = String(rootOverride || '').trim()
  if (requested) {
    const resolved = path.resolve(requested)
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) return resolved
    if (options?.required) throw new Error('projectRoot 必須是存在的 directory')
  }
  return workspaceRoot()
}

function subDesignRootFor(rootOverride?: unknown) {
  return workspaceRootFor(rootOverride, { required: true })
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

function openDesignVendorRoot(): string {
  const candidates = [
    path.join(app.getAppPath(), 'dist', 'open-design'),
    path.join(app.getAppPath(), 'public', 'open-design'),
    path.join(process.cwd(), 'public', 'open-design'),
  ]
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return fs.realpathSync(candidate)
    } catch {
      /* try the next packaging layout */
    }
  }
  throw new Error('找不到 bundled Open Design vendor root')
}

function safeVendorRelative(value: unknown): string {
  const normalized = String(value || '').trim().replaceAll('\\', '/')
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0') || normalized.split('/').some((part) => !part || part === '..' || part === '.')) {
    throw new Error(`不安全的 Open Design vendor path：${normalized}`)
  }
  return normalized
}

function crc32(input: Buffer): number {
  let crc = 0xffffffff
  for (const byte of input) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function createStoredZip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  const now = new Date()
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  for (const file of files) {
    const name = Buffer.from(file.name.replaceAll('\\', '/'), 'utf8')
    const data = file.data
    const checksum = crc32(data)
    const header = Buffer.alloc(30 + name.length)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0x800, 6)
    header.writeUInt16LE(0, 8)
    header.writeUInt16LE(dosTime, 10)
    header.writeUInt16LE(dosDate, 12)
    header.writeUInt32LE(checksum, 14)
    header.writeUInt32LE(data.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(name.length, 26)
    header.writeUInt16LE(0, 28)
    name.copy(header, 30)
    local.push(header, data)

    const directory = Buffer.alloc(46 + name.length)
    directory.writeUInt32LE(0x02014b50, 0)
    directory.writeUInt16LE(20, 4)
    directory.writeUInt16LE(20, 6)
    directory.writeUInt16LE(0x800, 8)
    directory.writeUInt16LE(0, 10)
    directory.writeUInt16LE(dosTime, 12)
    directory.writeUInt16LE(dosDate, 14)
    directory.writeUInt32LE(checksum, 16)
    directory.writeUInt32LE(data.length, 20)
    directory.writeUInt32LE(data.length, 24)
    directory.writeUInt16LE(name.length, 28)
    directory.writeUInt16LE(0, 30)
    directory.writeUInt16LE(0, 32)
    directory.writeUInt16LE(0, 34)
    directory.writeUInt16LE(0, 36)
    directory.writeUInt32LE(0, 38)
    directory.writeUInt32LE(offset, 42)
    name.copy(directory, 46)
    central.push(directory)
    offset += header.length + data.length
  }
  const centralData = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralData.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...local, centralData, end])
}

function htmlDocumentForPdf(artifact: SubDesignArtifact, content: string): string {
  const body = artifact.renderer === 'html' || artifact.renderer === 'deck-html'
    ? content
    : `<pre style="white-space:pre-wrap;font:12px/1.6 ui-monospace,monospace">${content.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</pre>`
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">`
  return /<head[^>]*>/i.test(body)
    ? body.replace(/<head[^>]*>/i, (head) => `${head}${csp}`)
    : `<!doctype html><html><head>${csp}<style>@page{margin:18mm}body{margin:0;color:#292725;background:#fff}</style></head><body>${body}</body></html>`
}

function xmlEscape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

function plainTextFromArtifact(content: string): string[] {
  const text = content
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
  const chunks = text.match(/.{1,110}(?:\s+|$)/g)?.map((line) => line.trim()).filter(Boolean) || []
  return chunks.slice(0, 24)
}

function pptxTextBox(id: number, name: string, x: number, y: number, cx: number, cy: number, text: string, opts?: { size?: number; bold?: boolean; color?: string }) {
  const size = opts?.size || 1800
  const color = opts?.color || 'E8F1F5'
  const bold = opts?.bold ? ' b="1"' : ''
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xmlEscape(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-TW" sz="${size}"${bold}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t>${xmlEscape(text)}</a:t></a:r></a:p></p:txBody></p:sp>`
}

function buildPptxFiles(artifact: SubDesignArtifact, content: string): Array<{ name: string; data: Buffer }> {
  const lines = plainTextFromArtifact(content)
  const title = artifact.title.slice(0, 120)
  const body = lines.length ? lines.join('\n') : `Artifact ${artifact.entry}`
  const slideShapes = [
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>`,
    pptxTextBox(2, 'Title', 720000, 480000, 10500000, 760000, title, { size: 3000, bold: true, color: 'FFFFFF' }),
    pptxTextBox(3, 'Content', 720000, 1450000, 10500000, 4150000, body, { size: 1700, color: 'D6E4EA' }),
    pptxTextBox(4, 'Footer', 720000, 6200000, 10500000, 280000, `SubDesign · ${artifact.id} · revision ${artifact.revision} · source ${artifact.entry}`, { size: 900, color: '8EA6B0' }),
  ].join('')
  const slide = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="${xmlEscape(title)}"><p:spTree>${slideShapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
  const slideLayout = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`
  const slideMaster = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="Master"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`
  const theme = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="SubAgents"><a:themeElements><a:clrScheme name="SubAgents"><a:dk1><a:srgbClr val="11191D"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="18262C"/></a:dk2><a:lt2><a:srgbClr val="E8F1F5"/></a:lt2><a:accent1><a:srgbClr val="7DD8F0"/></a:accent1><a:accent2><a:srgbClr val="F2B48F"/></a:accent2><a:accent3><a:srgbClr val="A5D6A7"/></a:accent3><a:accent4><a:srgbClr val="C5B5F5"/></a:accent4><a:accent5><a:srgbClr val="F1D06B"/></a:accent5><a:accent6><a:srgbClr val="8EA6B0"/></a:accent6><a:hlink><a:srgbClr val="7DD8F0"/></a:hlink><a:folHlink><a:srgbClr val="C5B5F5"/></a:folHlink></a:clrScheme><a:fontScheme name="SubAgents"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface="Noto Sans CJK TC"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface="Noto Sans CJK TC"/></a:minorFont></a:fontScheme><a:fmtScheme name="SubAgents"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>`
  const presentation = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xmlEscape(title)}</dc:title><dc:creator>SubAgents AI</dc:creator><cp:lastModifiedBy>SubAgents AI</cp:lastModifiedBy></cp:coreProperties>`
  const appProps = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>SubAgents AI</Application><PresentationFormat>Widescreen</PresentationFormat><Slides>1</Slides></Properties>`
  return [
    { name: '[Content_Types].xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`, 'utf8') },
    { name: 'ppt/presentation.xml', data: Buffer.from(presentation, 'utf8') },
    { name: 'ppt/_rels/presentation.xml.rels', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`, 'utf8') },
    { name: 'ppt/slides/slide1.xml', data: Buffer.from(slide, 'utf8') },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`, 'utf8') },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: Buffer.from(slideLayout, 'utf8') },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`, 'utf8') },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: Buffer.from(slideMaster, 'utf8') },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`, 'utf8') },
    { name: 'ppt/theme/theme1.xml', data: Buffer.from(theme, 'utf8') },
    { name: 'docProps/core.xml', data: Buffer.from(core, 'utf8') },
    { name: 'docProps/app.xml', data: Buffer.from(appProps, 'utf8') },
    { name: 'subagents-artifact-manifest.json', data: Buffer.from(JSON.stringify(artifact, null, 2), 'utf8') },
  ]
}

function runFfmpeg(args: string[]): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.env.FFMPEG_PATH || 'ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr?.on('data', (chunk) => { stderr += String(chunk).slice(0, 3000) })
    child.once('error', (error) => resolve({ ok: false, error: error.message }))
    child.once('close', (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: stderr || `ffmpeg exit=${code}` }))
  })
}

async function exportSubDesignMp4(artifact: SubDesignArtifact, content: string): Promise<{ ok: boolean; output?: Buffer; error?: string }> {
  const tempRoot = fs.mkdtempSync(path.join(app.getPath('temp'), 'subdesign-mp4-'))
  const framePath = path.join(tempRoot, 'frame.png')
  const outputPath = path.join(tempRoot, 'artifact.mp4')
  const previewWindow = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  try {
    await previewWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlDocumentForPdf(artifact, content))}`)
    await previewWindow.webContents.executeJavaScript('document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true')
    await new Promise((resolve) => setTimeout(resolve, 100))
    fs.writeFileSync(framePath, (await previewWindow.webContents.capturePage()).toPNG())
    const ffmpeg = await runFfmpeg(['-y', '-loglevel', 'error', '-loop', '1', '-i', framePath, '-t', '3', '-r', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath])
    if (!ffmpeg.ok || !fs.existsSync(outputPath)) return { ok: false, error: `MP4 export 需要可用的 ffmpeg：${ffmpeg.error || 'encoder 未產生輸出檔案'}` }
    return { ok: true, output: fs.readFileSync(outputPath) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    if (!previewWindow.isDestroyed()) previewWindow.destroy()
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

function evidenceSecret(): Buffer {
  const secretPath = path.join(app.getPath('userData'), 'subdesign-evidence.key')
  try {
    if (fs.existsSync(secretPath)) {
      const existing = fs.readFileSync(secretPath)
      if (existing.length >= 32) return existing
    }
  } catch { /* create a new key below */ }
  const secret = randomBytes(32)
  fs.mkdirSync(path.dirname(secretPath), { recursive: true })
  fs.writeFileSync(secretPath, secret, { mode: 0o600 })
  return secret
}



/**
 * Electron is an environment adapter for the deep SubDesign workspace
 * module. It owns only project-root I/O, OS dialogs, preview capture, vendor
 * access, and process adapters; domain validation and persistence decisions
 * stay in projectWorkspace.ts.
 */
function subDesignFileStore(root: string): SubDesignWorkspaceFileStore {
  const absolute = (relativePath: string) => resolveWorkspacePath(relativePath, root)
  const inside = (relativePath: string): boolean => {
    try {
      const candidate = absolute(relativePath)
      const realRoot = fs.realpathSync(root)
      let existing = candidate
      while (!fs.existsSync(existing)) {
        const parent = path.dirname(existing)
        if (parent === existing) return false
        existing = parent
      }
      const realExisting = fs.realpathSync(existing)
      const remainder = path.relative(existing, candidate)
      return isPathInside(realRoot, path.resolve(realExisting, remainder))
    } catch {
      return false
    }
  }
  return {
    root,
    exists: async (relativePath) => inside(relativePath) && fs.existsSync(absolute(relativePath)),
    readFile: async (relativePath) => { if (!inside(relativePath)) throw new Error(`path escapes workspace：${relativePath}`); return fs.readFileSync(absolute(relativePath)) },
    writeFile: async (relativePath, data) => {
      if (!inside(relativePath)) throw new Error(`path escapes workspace：${relativePath}`)
      const file = absolute(relativePath)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, data)
    },
    writeExternal: async (filePath, data) => {
      const target = path.resolve(filePath)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, data)
    },
    writeFilesAtomically: async (writes) => {
      const previous = new Map<string, Buffer | null>()
      for (const write of writes) {
        const file = absolute(write.path)
        if (!inside(write.path)) throw new Error(`path escapes workspace：${write.path}`)
        previous.set(file, fs.existsSync(file) ? fs.readFileSync(file) : null)
      }
      try {
        for (const write of writes) {
          const file = absolute(write.path)
          fs.mkdirSync(path.dirname(file), { recursive: true })
          fs.writeFileSync(file, write.data)
        }
      } catch (error) {
        for (const [file, data] of previous) {
          if (data == null) {
            try { if (fs.existsSync(file)) fs.rmSync(file, { force: true }) } catch { /* best-effort rollback */ }
          } else {
            try { fs.writeFileSync(file, data) } catch { /* best-effort rollback */ }
          }
        }
        throw error
      }
    },
    list: async (relativePath) => {
      const directory = absolute(relativePath)
      if (!inside(relativePath)) throw new Error(`path escapes workspace：${relativePath}`)
      if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return []
      return fs.readdirSync(directory, { withFileTypes: true }).map((entry) => ({ name: entry.name, dir: entry.isDirectory() }))
    },
    stat: async (relativePath) => {
      if (!inside(relativePath)) throw new Error(`path escapes workspace：${relativePath}`)
      const stat = fs.statSync(absolute(relativePath))
      return { isFile: stat.isFile(), isDirectory: stat.isDirectory(), size: stat.size, mtimeMs: stat.mtimeMs }
    },
    mkdir: async (relativePath) => { if (!inside(relativePath)) throw new Error(`path escapes workspace：${relativePath}`); fs.mkdirSync(absolute(relativePath), { recursive: true }) },
    isPathInside: async (relativePath) => inside(relativePath),
  }
}

function subDesignWorkspaceCrypto(): SubDesignWorkspaceCrypto {
  const bytes = (value: Uint8Array | string) => typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value)
  return {
    sha256: async (value) => createHash('sha256').update(bytes(value)).digest('hex'),
    hmacSha256: async (secret, value) => createHmac('sha256', Buffer.from(secret)).update(value).digest('hex'),
    getSecret: async () => evidenceSecret(),
    randomId: (prefix) => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 24)}`,
  }
}

async function subDesignCaptureAdapter(input: {
  artifact: SubDesignArtifact
  kind: 'screenshot' | 'dom'
  content: string
  viewport: { width: number; height: number }
}): Promise<Uint8Array | string> {
  const previewWindow = new BrowserWindow({
    show: false,
    width: input.viewport.width,
    height: input.viewport.height,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  try {
    await previewWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlDocumentForPdf(input.artifact, input.content))}`)
    await previewWindow.webContents.executeJavaScript('document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true')
    await new Promise((resolve) => setTimeout(resolve, 80))
    if (input.kind === 'screenshot') return (await previewWindow.webContents.capturePage()).toPNG()
    return String(await previewWindow.webContents.executeJavaScript('document.documentElement.outerHTML') || '').slice(0, 200_000)
  } finally {
    if (!previewWindow.isDestroyed()) previewWindow.destroy()
  }
}

function subDesignExportProcesses(): Partial<Record<SubDesignExportFormat, SubDesignExportProcess>> {
  const filters = (format: SubDesignExportFormat) => format === 'pdf'
    ? [{ name: 'PDF', extensions: ['pdf'] }]
    : format === 'pptx'
      ? [{ name: 'PowerPoint', extensions: ['pptx'] }]
      : format === 'mp4'
        ? [{ name: 'MP4 video', extensions: ['mp4'] }]
        : format === 'zip'
          ? [{ name: 'ZIP', extensions: ['zip'] }]
          : [{ name: 'HTML', extensions: ['html'] }]
  const save = async (format: SubDesignExportFormat, suggestedName: string) => {
    const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getFocusedWindow()
    const options = { title: `Export SubDesign ${format}`, defaultPath: path.join(app.getPath('downloads'), suggestedName), filters: filters(format) }
    return parent ? dialog.showSaveDialog(parent, options) : dialog.showSaveDialog(options)
  }
  const process = async ({ artifact, files, entryContent, format, suggestedName }: Parameters<SubDesignExportProcess>[0]) => {
    const selected = await save(format, suggestedName)
    if (selected.canceled || !selected.filePath) return { status: 'cancelled' as const, error: '使用者取消 export。' }
    try {
      const sourceFiles = files.map((file) => ({ name: file.path, data: typeof file.data === 'string' ? Buffer.from(file.data, 'utf8') : Buffer.from(file.data) }))
      let output: Buffer
      if (format === 'html') {
        output = Buffer.from(entryContent, 'utf8')
      } else if (format === 'zip') {
        output = createStoredZip([
          { name: 'artifact-manifest.json', data: Buffer.from(JSON.stringify(artifact, null, 2), 'utf8') },
          ...sourceFiles,
        ])
      } else if (format === 'pptx') {
        output = createStoredZip(buildPptxFiles(artifact, entryContent))
      } else if (format === 'mp4') {
        const video = await exportSubDesignMp4(artifact, entryContent)
        if (!video.ok || !video.output) return { status: 'failed' as const, error: video.error || 'MP4 export 失敗。' }
        output = video.output
      } else {
        const previewWindow = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })
        try {
          await previewWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlDocumentForPdf(artifact, entryContent))}`)
          output = await previewWindow.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true })
        } finally {
          if (!previewWindow.isDestroyed()) previewWindow.destroy()
        }
      }
      return { status: 'success' as const, path: selected.filePath, output }
    } catch (error) {
      return { status: 'failed' as const, error: error instanceof Error ? error.message : String(error) }
    }
  }
  return { html: process, zip: process, pdf: process, pptx: process, mp4: process }
}

function openDesignVendorFileStore(): SubDesignVendorFileStore {
  const root = openDesignVendorRoot()
  const absolute = (relativePath: string) => path.resolve(root, safeVendorRelative(relativePath))
  const inside = (relativePath: string) => {
    try {
      const file = absolute(relativePath)
      return isPathInside(root, fs.existsSync(file) ? fs.realpathSync(file) : file)
    } catch {
      return false
    }
  }
  return {
    exists: async (relativePath) => fs.existsSync(absolute(relativePath)),
    readFile: async (relativePath) => fs.readFileSync(absolute(relativePath)),
    stat: async (relativePath) => {
      const stat = fs.statSync(absolute(relativePath))
      return { isFile: stat.isFile(), isDirectory: stat.isDirectory(), size: stat.size }
    },
    isPathInside: async (relativePath) => inside(relativePath),
  }
}

async function fetchPublicSubDesignReference(url: string): Promise<{ finalUrl?: string; contentType?: string; data: Uint8Array }> {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol) || isPrivateReferenceHost(parsed.hostname)) throw new Error('URL 只支援公開 http/https，禁止 localhost 或 private host。')
  const resolved = await lookup(parsed.hostname)
  if (isPrivateReferenceHost(resolved.address)) throw new Error('URL 解析到 private host，已拒絕匯入。')
  const response = await fetch(parsed.toString(), { redirect: 'follow', headers: { accept: 'text/html,application/xhtml+xml' } })
  if (!response.ok) throw new Error(`URL fetch 失敗：HTTP ${response.status}`)
  const finalUrl = new URL(response.url || parsed.toString())
  if (!['http:', 'https:'].includes(finalUrl.protocol) || isPrivateReferenceHost(finalUrl.hostname)) throw new Error('URL redirect 到不允許的 host。')
  return { finalUrl: finalUrl.toString(), contentType: response.headers.get('content-type') || undefined, data: new Uint8Array(await response.arrayBuffer()) }
}

function subDesignWorkspaceFor(root: string) {
  return createSubDesignProjectWorkspace({
    files: subDesignFileStore(root),
    clock: () => new Date().toISOString(),
    crypto: subDesignWorkspaceCrypto(),
    exportProcesses: subDesignExportProcesses(),
  })
}

ipcMain.handle('subdesign:listArtifacts', async (_evt, projectRoot?: string) => {
  try {
    const root = subDesignRootFor(projectRoot)
    const snapshot = await subDesignWorkspaceFor(root).readMetadata()
    return { ok: true, artifacts: snapshot.artifacts }
  } catch (error) {
    return { ok: false, artifacts: [], error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('subdesign:readMetadata', async (_evt, projectRoot?: string) => {
  try {
    const root = subDesignRootFor(projectRoot)
    return { ok: true, ...(await subDesignWorkspaceFor(root).readMetadata()) }
  } catch (error) {
    return { ok: false, briefs: [], artifacts: [], critiques: [], exports: [], openDesignPacks: [], error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('subdesign:createBrief', async (_evt, input: { brief: unknown; runId?: string; threadId?: string; projectRoot?: string }) => {
  try {
    const root = subDesignRootFor(input.projectRoot)
    return await subDesignWorkspaceFor(root).createBrief(input)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('subdesign:updateBrief', async (_evt, input: { briefId: string; patch: unknown; runId?: string; threadId?: string; projectRoot?: string }) => {
  try {
    const root = subDesignRootFor(input.projectRoot)
    return await subDesignWorkspaceFor(root).updateBrief(input)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('subdesign:selectDirection', async (_evt, input: { briefId: string; directionId: string; fallback?: Record<string, unknown>; runId?: string; threadId?: string; projectRoot?: string }) => {
  try {
    const root = subDesignRootFor(input.projectRoot)
    return await subDesignWorkspaceFor(root).selectDirection(input)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('subdesign:setBriefStage', async (_evt, input: { briefId: string; stage: string; runId?: string; threadId?: string; projectRoot?: string }) => {
  try {
    const root = subDesignRootFor(input.projectRoot)
    return await subDesignWorkspaceFor(root).setBriefStage({ ...input, stage: input.stage as SubDesignStage })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('subdesign:recordCritique', async (_evt, input: { artifact: unknown; critique: unknown; critiqueSession?: unknown; runId?: string; threadId?: string; projectRoot?: string }) => {
  try {
    const root = subDesignRootFor(input.projectRoot)
    return await subDesignWorkspaceFor(root).recordCritique(input)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('subdesign:createDesignSystem', async (_evt, input: { id: string; title: string; category?: string; content?: string; briefId?: string; runId?: string; threadId?: string; projectRoot?: string }) => {
  try {
    const root = subDesignRootFor(input.projectRoot)
    return await subDesignWorkspaceFor(root).createDesignSystem(input)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('subdesign:updateDesignSystem', async (_evt, input: { id: string; content: string; briefId?: string; runId?: string; threadId?: string; projectRoot?: string }) => {
  try {
    const root = subDesignRootFor(input.projectRoot)
    return await subDesignWorkspaceFor(root).updateDesignSystem(input)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('subdesign:recordOpenDesignPack', async (_evt, input: { pack: unknown; runId?: string; threadId?: string; projectRoot?: string }) => {
  try {
    const root = subDesignRootFor(input.projectRoot)
    return await subDesignWorkspaceFor(root).recordOpenDesignPack(input)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('subdesign:registerArtifact', async (_evt, input: { artifact: unknown; briefId?: string; designSystemId?: string; runId?: string; threadId?: string; projectRoot?: string }) => {
  try {
    const root = subDesignRootFor(input.projectRoot)
    return await subDesignWorkspaceFor(root).registerArtifact(input)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), code: 'ARTIFACT_REGISTER_FAILED' }
  }
})

ipcMain.handle('subdesign:readArtifact', async (_evt, input: { entry?: string; projectRoot?: string }) => {
  try {
    const root = subDesignRootFor(input?.projectRoot)
    return await subDesignWorkspaceFor(root).readArtifact({ entry: String(input?.entry || '') })
  } catch (error) {
    return { ok: false, content: '', error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('subdesign:patchArtifact', async (_evt, input: { artifact: unknown; operations: unknown; runId?: string; threadId?: string; projectRoot?: string }) => {
  try {
    const root = subDesignRootFor(input.projectRoot)
    return await subDesignWorkspaceFor(root).patchArtifact(input)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('subdesign:applyTweak', async (_evt, input: { artifact: unknown; tweakId: unknown; value: unknown; runId?: string; threadId?: string; projectRoot?: string }) => {
  try {
    const root = subDesignRootFor(input.projectRoot)
    return await subDesignWorkspaceFor(root).applyTweak(input)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('subdesign:verifyEvidence', async (_evt, input: { artifact: unknown; evidence: unknown; runId?: string; threadId?: string; projectRoot?: string }) => {
  try {
    const root = subDesignRootFor(input.projectRoot)
    return await subDesignWorkspaceFor(root).verifyEvidence(input)
  } catch (error) {
    return { ok: false, validKinds: [], errors: [error instanceof Error ? error.message : String(error)] }
  }
})

ipcMain.handle('subdesign:captureEvidence', async (_evt, input: { artifact: unknown; kind: 'screenshot' | 'dom'; viewport?: { width?: number; height?: number }; runId?: string; threadId?: string; projectRoot?: string }) => {
  try {
    const root = subDesignRootFor(input.projectRoot)
    return await subDesignWorkspaceFor(root).captureEvidence({ ...input, capture: subDesignCaptureAdapter })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), code: 'EVIDENCE_CAPTURE_FAILED' }
  }
})

ipcMain.handle('subdesign:lintEvidence', async (_evt, input: { artifact: unknown; runId?: string; threadId?: string; projectRoot?: string }) => {
  try {
    const root = subDesignRootFor(input.projectRoot)
    return await subDesignWorkspaceFor(root).lintArtifact(input)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), code: 'LINT_FAILED' }
  }
})

ipcMain.handle('subdesign:importReference', async (_evt, input: { briefId?: string; kind?: 'screenshot' | 'url'; source?: string; suggestedTitle?: string; runId?: string; threadId?: string; projectRoot?: string }) => {
  try {
    const root = subDesignRootFor(input.projectRoot)
    return await subDesignWorkspaceFor(root).importReference({ ...input, briefId: String(input.briefId || ''), kind: input.kind || 'url', source: String(input.source || ''), fetchPublicUrl: fetchPublicSubDesignReference })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), code: 'REFERENCE_IMPORT_FAILED' }
  }
})

ipcMain.handle('subdesign:exportCapabilities', async () => {
  const ffmpeg = await runFfmpeg(['-version'])
  return { ok: true, pptx: true, mp4: ffmpeg.ok, mp4Error: ffmpeg.ok ? undefined : ffmpeg.error }
})

ipcMain.handle('subdesign:copyVendorPack', async (_evt, input: { sourcePath?: string; assetPaths?: string[]; targetId?: string; digest?: string; kind?: 'template' | 'skill' | 'design-system' | 'prompt' | 'craft' | 'media'; runId?: string; threadId?: string; projectRoot?: string }) => {
  try {
    const root = subDesignRootFor(input.projectRoot)
    return await subDesignWorkspaceFor(root).installDesignSystemPack({ ...input, sourcePath: String(input.sourcePath || ''), assetPaths: input.assetPaths || [], targetId: String(input.targetId || ''), digest: String(input.digest || ''), vendor: openDesignVendorFileStore() })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('subdesign:exportArtifact', async (_evt, input: { artifact: unknown; critique?: unknown; critiqueSession?: unknown; format: SubDesignExportFormat; runId?: string; threadId?: string; projectRoot?: string; suggestedName?: string }) => {
  try {
    const root = subDesignRootFor(input.projectRoot)
    const result = await subDesignWorkspaceFor(root).exportArtifact({ ...input, critique: input.critique ?? null, critiqueSession: input.critiqueSession })
    if (!result.ok) return { ...result, cancelled: result.code === 'EXPORT_CANCELLED' }
    return { ok: true, ...result.record, record: result.record }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), code: 'EXPORT_FAILED' }
  }
})

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
