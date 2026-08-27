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
  session,
  utilityProcess,
  systemPreferences,
} from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  clearVaultSecret,
  getVaultSecret,
  hasSecretPlaceholder,
  isVaultEncryptionAvailable,
  listVaultMeta,
  migrateIntoVault,
  resolveSecretPlaceholders,
  setVaultSecret,
} from './secretsVault'
import {
  decidePermissionRequest,
  isAllowedNavigationUrl,
  isSafeExternalUrl,
} from './securityPolicy'
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
import { cancelBashAndWait, runBash } from './shellBridge'
import {
  clearRewindEntries,
  listRewindEntries,
  recordRewindEntry,
  restoreRewindEntries,
  sha1 as rewindSha1,
} from './rewindBridge'
import {
  appendOutboundEvidence,
  disposeOutboundRunView,
  ensureOutboundPolicy,
  getOutboundRunViewMeta,
  getOutboundRunViewRoot,
  getOutboundStatus,
  prepareOutboundRunView,
  readOutboundRunEvidence,
} from './outboundBridge'
import { verifyCliFilesystemSandbox } from './cliFilesystemSandbox'
import {
  decideMainCliSpawnAdmission,
  allocateForbiddenCanaryPath,
  type FilesystemIsolationStatus,
} from '../src/agent/outbound/cliSandbox.ts'
import { parseDeployOutboundGuard, type OutboundGuardMode } from '../src/agent/outbound/outboundGate.ts'
import {
  activatePolicyDraft,
  listActivePolicies,
  listPolicyDrafts,
  readPolicyDraft,
  rollbackActivePolicy,
  savePolicyDraft,
  seedDraftFromActive,
} from './policyAdminBridge'
import {
  listMonitors,
  startMonitor,
  stopAllMonitors,
  stopMonitor,
  type MonitorEmit,
} from './monitorBridge'
import {
  detectOpenCodeCli,
  loadOpenCodeBundle,
  runOpenCodePrompt,
  resolveOpenCodeInstructions,
  scanOpenCodeAgents,
  spawnOpenCodeInteractive,
} from './opencodeBridge'
import {
  applyWorktree,
  createWorktree,
  inspectProject,
  listBranches,
  pickProjectFolder,
  removeWorktree,
} from './projectBridge'
import {
  applyDiscoveryToProviders,
  discoverLocalClis,
} from './cliDiscover'
import { runCliDoctor } from './cliDoctor'
import { discoverMcpServers } from './mcpDiscover'
import {
  bindTermWebContents,
  createTermSession,
  killAllTerms,
  killTerm,
  listTermSessions,
  writeTerm,
} from './ptyBridge'
import {
  cancelExternalCliSession,
  externalCliSessions,
  getExternalCliSession,
  interruptExternalCliSessions,
  listExternalCliSessions,
  runLocalCliAgent,
  type LocalCliKind,
} from './localCliRunner'
import {
  configureExternalCliPersistence,
  configureExternalCliTelemetry,
  recoverExternalCliSessions,
  listExternalCliRecovery,
  externalCliRecoveryAction,
} from './externalCliSupervisor'
import { JsonExternalCliCheckpointStore } from './externalCliCheckpointStore'
import { JsonCompactionCheckpointStore } from './compactionCheckpointStore'
import { JournalMirrorStore } from './journalMirrorStore'
import { JsonExternalCliTelemetrySink } from './externalCliTelemetrySink'
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
  codegraphInstall,
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
  isProjectRelativePath,
  validateSubDesignArtifactManifest,
} from '../src/agent/subdesign/artifactManifest'
import { writeLearningExport } from './learningExportWrite.ts'
import { normalizeSubDesignCritique, critiqueAllowsDeliver } from '../src/agent/subdesign/critique'
import { parsePinnedCommentPayload } from '../src/agent/subdesign/pinnedComments'
import { createPinnedPatchScope, resolvePinnedHtmlRanges } from '../src/agent/subdesign/pinnedPatchScope'
import { parseMcpToolCoordinate } from '../src/agent/subdesign/providers/mcpAppsProvider'
import { isSubDesignMetadataKind, type SubDesignMetadataKind } from '../src/agent/subdesign/metadataKinds'
import type {
  SubDesignArtifact,
  SubDesignArtifactPatchOperation,
  SubDesignExportFormat,
} from '../src/agent/subdesign/types'
import type { CliConfigSnapshot } from '../src/agent/types'
import {
  formatExternalCliTerminal,
  normalizeExternalCliRunPolicy,
  classifyExternalCliDiagnostic,
  type ExternalCliConnectorRequirement,
} from '../src/agent/externalCliRunSession'
import {
  captureMigrationSnapshot,
  deferUpdate,
  discoverUpdate,
  downloadUpdate,
  markInstallFailure,
  completeMigration,
  pendingMigration,
  prepareUpdateInstall,
  readUpdateState,
  rollbackUpdate,
  updatePublicKeyFromEnv,
} from './updateManager'
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
import { safeOpenCodeServerOrigin } from '../src/agent/opencodeServerSafety'
import { PiHostSupervisor } from './piHostSupervisor'
import type { PiTurnSettlement } from '../src/agent/piHostRun'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const piHostSupervisor = new PiHostSupervisor(() =>
  utilityProcess.fork(path.join(__dirname, 'pi-host.js'), [], {
    serviceName: 'SubAgents Pi Core Host',
    env: {
      ...process.env,
      SUBAGENTS_PI_VENDOR_DIR: path.resolve(__dirname, '../../vendor/pi'),
      SUBAGENTS_PI_AGENT_DIR: path.join(app.getPath('userData'), 'pi-agent'),
      SUBAGENTS_PI_NATIVE_AGENT_DIR: path.join(app.getPath('home'), '.pi', 'agent'),
      SUBAGENTS_PI_SYNC_CLI_OAUTH: 'true',
      SUBAGENTS_CODEX_AUTH_PATH: path.join(app.getPath('home'), '.codex', 'auth.json'),
      SUBAGENTS_CLAUDE_CREDENTIALS_PATH: path.join(app.getPath('home'), '.claude', '.credentials.json'),
      SUBAGENTS_PI_HOST_STATE_PATH: path.join(app.getPath('userData'), 'pi-host-state.json'),
      SUBAGENTS_PI_SETTINGS_MIGRATION_PATH: path.join(app.getPath('userData'), 'pi-settings-migration.json'),
      SUBAGENTS_LEGACY_SETTINGS_PATH: settingsPath(),
    },
  }),
)
// Policy Admin / outbound policy dir default (node-safe modules read this env).
try {
  process.env.SUBAGENTS_USER_DATA_DIR = app.getPath('userData')
} catch {
  /* app may not be ready in some test loaders */
}

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(process.env.DIST, '../public')

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

piHostSupervisor.onEvent((event) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('pi-host:event', event)
})

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

  // Issue 06 — 視窗開啟/導覽 allowlist：新視窗一律拒絕，安全 scheme 才轉外部瀏覽器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) shell.openExternal(url)
    else console.warn('[security] blocked window.open →', url)
    return { action: 'deny' }
  })
  // 打包後 file: 只允許 app 自己的 index.html
  const appIndexFileUrl = process.env.DIST
    ? pathToFileURL(path.join(process.env.DIST, 'index.html')).href
    : undefined
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (
      !isAllowedNavigationUrl(url, {
        devServerUrl: process.env.VITE_DEV_SERVER_URL,
        appIndexFileUrl,
      })
    ) {
      event.preventDefault()
      console.warn('[security] blocked navigation →', url)
      if (isSafeExternalUrl(url)) shell.openExternal(url)
    }
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

app.whenReady().then(async () => {
  // Durable external-session checkpoints are Host metadata only: no prompt,
  // credential, or event body is written.  Mark process-owned records
  // interrupted before the renderer starts projecting them.
  configureExternalCliPersistence(
    new JsonExternalCliCheckpointStore(path.join(app.getPath('userData'), 'external-cli', 'checkpoints.json')),
  )
  configureExternalCliTelemetry(
    new JsonExternalCliTelemetrySink(path.join(app.getPath('userData'), 'external-cli', 'telemetry.json')),
  )
  const recoveredExternalSessions = recoverExternalCliSessions()
  if (recoveredExternalSessions.length) {
    console.warn('[external-cli] recovered interrupted sessions', recoveredExternalSessions.map((record) => record.runId))
  }
  // Windows taskbar grouping + correct Jump List icon identity
  if (process.platform === 'win32') {
    app.setAppUserModelId('ai.subagents.desktop')
  }
  // Issue 06 — 權限請求 deny-by-default（白名單見 securityPolicy.ts）
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = decidePermissionRequest(permission)
    if (!allowed) console.warn('[security] denied permission request →', permission)
    callback(allowed)
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    decidePermissionRequest(permission),
  )
  try {
    await piHostSupervisor.start()
  } catch (error) {
    console.error('[pi-host] failed to start', error)
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
  interruptExternalCliSessions('Electron host stopping; external session requires recovery')
  piHostSupervisor.stop()
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
      /** Outbound metadata only — main records evidence (ticket 24); never logs content. */
      runId?: string
      effectiveMode?: OutboundGuardMode
      providerConnectionId?: string
      outboundProfileSource?: 'company' | 'baseline' | 'none'
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
      usage?: {
        total_tokens?: number
        prompt_tokens?: number
        completion_tokens?: number
        prompt_tokens_details?: { cached_tokens?: number }
      }
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

    // Ticket 24: main-only egress evidence at true LLM transport (metadata only).
    const mode = req.effectiveMode
    if (mode && mode !== 'off') {
      try {
        const { buildLlmEgressEvidenceMeta } = await import(
          '../src/agent/outbound/llmEgress.ts'
        )
        const meta = buildLlmEgressEvidenceMeta({
          runId: req.runId,
          connectionId: req.providerConnectionId,
          effectiveMode: mode,
          action: data ? 'llm-transport' : 'llm-block',
          profileSource: req.outboundProfileSource || 'none',
        })
        void appendOutboundEvidence(meta)
      } catch {
        /* evidence must not break transport */
      }
    }

    if (!data) throw new Error(lastError || 'LLM request failed')

    const choice = data.choices?.[0]
    const msg = choice?.message
    const toolCalls = (msg?.tool_calls || []).map((tc) => ({
      id: tc.id,
      name: tc.function?.name || '',
      arguments: tc.function?.arguments || '{}',
    }))

    // The split the provider reported travels intact. Only `total_tokens` used
    // to survive this boundary, so nothing downstream could ever say whether a
    // run was expensive because the context was long or because the answer
    // was. `buildRecordedUsage` is the shared builder — it keeps only fields
    // the provider actually reported, so an unreported one stays absent rather
    // than becoming a 0 the panel would render as a measurement.
    const { buildRecordedUsage } = await import('../src/agent/usagePricing.ts')
    const usage = buildRecordedUsage({
      input: data.usage?.prompt_tokens,
      output: data.usage?.completion_tokens,
      total: data.usage?.total_tokens,
      cachedRead: data.usage?.prompt_tokens_details?.cached_tokens,
    })

    return {
      content: (msg?.content || '').trim(),
      tokensUsed: data.usage?.total_tokens ?? 0,
      ...(usage ? { usage } : {}),
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
  if (!isSafeExternalUrl(url)) {
    throw new Error('無效的 URL（僅允許 http/https/mailto）')
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
    input: {
      channel: 'telegram' | 'webhook' | 'system'
      chatId: string
      text: string
      token?: string
      runId?: string
    },
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
// G9 worktree 隔離
ipcMain.handle('project:worktreeCreate', async (_evt, root: string, branchPrefix?: string) =>
  createWorktree(String(root || ''), branchPrefix),
)
ipcMain.handle('project:worktreeApply', async (_evt, root: string, worktreePath: string) =>
  applyWorktree(String(root || ''), String(worktreePath || '')),
)
ipcMain.handle('project:worktreeRemove', async (_evt, root: string, worktreePath: string) =>
  removeWorktree(String(root || ''), String(worktreePath || '')),
)

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
  'cli:doctor',
  async (_evt, currentProviders: Array<Record<string, unknown>> = []) => runCliDoctor(currentProviders),
)

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
      conversationId?: string
      externalCliPolicy?: Record<string, number>
      requiredConnectors?: ExternalCliConnectorRequirement[]
      configSnapshot?: CliConfigSnapshot
      attachments?: Array<{
        name: string
        mimeType?: string
        kind?: 'image' | 'text' | 'binary'
        dataUrl?: string
        textContent?: string
        filePath?: string
      }>
      sandboxWrap?: {
        engine: 'seatbelt' | 'bwrap'
        viewRoot: string
      }
      /** Renderer effective mode; main still re-enforces under required (ticket 20). */
      effectiveMode?: OutboundGuardMode
      /** External CLI delegate/continue contract; metadata only. */
      externalCliContract?: unknown
    },
  ) => {
    const cwd =
      input.cwd && fs.existsSync(input.cwd) ? input.cwd : workspaceRoot()

    // Ticket 20: main-enforced sandbox — do not trust renderer-only wrap omission.
    let deployMode: OutboundGuardMode = 'off'
    try {
      deployMode = parseDeployOutboundGuard(process.env.SUBAGENTS_OUTBOUND_GUARD)
    } catch {
      deployMode = 'required' // invalid deploy → fail closed for CLI
    }
    // Prefer renderer effective mode (includes optional user toggle); fall back to deploy.
    const effectiveMode: OutboundGuardMode = input.effectiveMode || deployMode

    const boundMeta = input.runId ? getOutboundRunViewMeta(String(input.runId)) : null
    const boundViewRoot = boundMeta?.viewRoot || input.sandboxWrap?.viewRoot || null

    let isolationStatus: FilesystemIsolationStatus = 'unavailable'
    if (
      input.sandboxWrap &&
      (input.sandboxWrap.engine === 'seatbelt' || input.sandboxWrap.engine === 'bwrap') &&
      input.sandboxWrap.viewRoot
    ) {
      try {
        const canary = allocateForbiddenCanaryPath({
          viewRoot: input.sandboxWrap.viewRoot,
          originalRoot: boundMeta?.originalRoot,
        })
        const probe = verifyCliFilesystemSandbox({
          viewRoot: input.sandboxWrap.viewRoot,
          forbiddenCanaryPath: canary,
        })
        isolationStatus = probe.status
      } catch {
        isolationStatus = 'unavailable'
      }
    } else if (effectiveMode === 'optional' || effectiveMode === 'demo') {
      isolationStatus = 'unverified'
    }

    const admission = decideMainCliSpawnAdmission({
      effectiveMode,
      cwd,
      boundViewRoot,
      sandboxWrap: input.sandboxWrap || null,
      isolationStatus,
    })
    if (!admission.allow) {
      // Ticket 23: main records CLI sandbox deny (not renderer)
      void appendOutboundEvidence({
        eventType: 'outbound-decision',
        runId: input.runId,
        providerId: boundMeta?.connectionId,
        effectiveGuardMode: effectiveMode,
        policySource: 'local',
        action: 'cli-sandbox-deny',
        filesystemIsolation: admission.isolationStatus,
      })
      return {
        ok: false,
        output: '',
        command: '',
        kind: input.kind,
        code: 1,
        error: admission.reason || 'Main 拒絕未通過 filesystem sandbox 的 CLI spawn',
        runId: input.runId,
        configSnapshot: input.configSnapshot,
      }
    }

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
      const serverPolicy = normalizeExternalCliRunPolicy(input.externalCliPolicy)
      const serverSession = externalCliSessions.create({
        runId: serverRunId,
        conversationId: input.conversationId || serverRunId,
        adapter: 'opencode',
        policy: serverPolicy,
        unattended: input.unattended,
        requiredConnectors: input.requiredConnectors,
        processId: `opencode-server:${serverRunId}`,
        transport: {
          processId: `opencode-server:${serverRunId}`,
          terminateTree: async () => {
            const result = await abortOpenCodeRun(serverRunId)
            return { confirmed: result.ok }
          },
        },
      })
      serverSession.start()
      let server
      try {
        server = await runOpenCodeServerPrompt({
          mode: input.serverMode || 'auto',
          baseUrl: input.serverUrl,
          prompt: input.prompt,
          cwd,
          model: input.model,
          agent: input.agentMode === 'plan' ? 'plan' : 'build',
          runId: serverRunId,
          timeoutMs: serverPolicy.absoluteMs,
          onStarted: (providerSessionId) => {
            // A server health check is not a provider lifecycle event.  Only
            // the created session identity proves this run has started.
            serverSession.observe({
              type: 'process_started',
              processId: `opencode-server:${serverRunId}`,
              providerSessionId,
              detail: 'OpenCode provider session created',
            })
          },
          onEvent: (event) => {
            if (event.sessionPhase === 'waiting_for_user' || event.sessionPhase === 'waiting_for_approval') {
              serverSession.observe({ type: event.sessionPhase, detail: event.detail || event.title })
            } else if (event.kind === 'text') {
              serverSession.observe({ type: 'model_activity', detail: event.delta || event.detail })
            } else if (event.kind === 'tool' || event.kind === 'file') {
              serverSession.observe({ type: 'tool_completed', tool: event.tool, detail: event.detail, ok: event.ok })
            } else if (event.kind === 'error') {
              const detail = event.detail || event.title || 'OpenCode server error'
              const diagnostic = classifyExternalCliDiagnostic(detail, {
                adapter: 'opencode',
                operation: event.tool,
                headless: true,
              })
              if (diagnostic.kind === 'connector-authentication-required') {
                const required = diagnostic.required === true || serverSession.isRequiredConnector(diagnostic)
                serverSession.observe({
                  type: 'connector_authentication_required',
                  connector: diagnostic.connector,
                  server: diagnostic.server,
                  operation: diagnostic.operation,
                  required,
                  detail: diagnostic.detail,
                })
              } else {
                serverSession.observe({ type: 'diagnostic', detail, severity: 'error' })
              }
            } else {
              serverSession.observe({ type: 'provider_activity', detail: event.detail || event.title })
            }
            const cursor = serverSession.snapshot().eventCursor
            try {
              const target = mainWindow?.webContents
              if (target && !target.isDestroyed()) target.send('cli:stream', {
                ...event,
                runId: serverRunId,
                sequence: cursor,
                sessionPhase: serverSession.snapshot().phase,
                providerSessionId: serverSession.snapshot().providerSessionId,
              })
            } catch {
              /* ignore */
            }
          },
        })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        if (!serverSession.snapshot().terminal) serverSession.failTransport(detail)
        const sessionSnapshot = serverSession.snapshot()
        return {
          ok: false,
          output: sessionSnapshot.output.head,
          command: `opencode server ${safeOpenCodeServerOrigin(input.serverUrl) || 'loopback'}`,
          kind: 'opencode' as const,
          code: 1,
          error: formatExternalCliTerminal(sessionSnapshot.terminal || {
            classification: 'transport-failure',
            phase: 'failed',
            at: Date.now(),
            reason: detail,
          }, { headless: true }),
          runId: serverRunId,
          terminalClassification: sessionSnapshot.terminal?.classification || 'transport-failure',
          configSnapshot: input.configSnapshot,
          externalRun: {
            provider: 'opencode' as const,
            adapter: 'opencode',
            runId: serverRunId,
            conversationId: input.conversationId || serverRunId,
            processId: sessionSnapshot.processId,
            status: 'failed' as const,
            completionReason: detail,
            terminalClassification: sessionSnapshot.terminal?.classification || 'transport-failure',
            eventCursor: sessionSnapshot.eventCursor,
            outputOmittedBytes: sessionSnapshot.output.omittedBytes,
            startedAt: externalStartedAt,
            finishedAt: new Date().toISOString(),
          },
        }
      }
      if (server.used) {
        if (server.sessionId) {
          serverSession.observe({
            type: 'provider_activity',
            providerSessionId: server.sessionId,
            detail: 'OpenCode provider session identity observed',
          })
        }
        if (server.timedOut && !serverSession.snapshot().terminal) {
          serverSession.forceTimeout(serverSession.snapshot().firstValidLifecycleAt === undefined ? 'startup-timeout' : 'absolute-timeout')
        }
        else if (server.cancelled && !serverSession.snapshot().terminal) serverSession.cancelObserved('使用者取消')
        else if (!serverSession.snapshot().terminal) serverSession.observe({ type: 'process_exit', code: server.ok ? 0 : 1, detail: server.error })
        const sessionSnapshot = serverSession.snapshot()
        const terminal = sessionSnapshot.terminal
        const safeServerOrigin = safeOpenCodeServerOrigin(server.baseUrl || input.serverUrl) || 'loopback'
        // The Host session classification wins over an adapter's raw HTTP
        // result, including a provider that exits zero after required auth or
        // cancellation has already settled the run.
        const resultOk = terminal ? terminal.classification === 'success' : server.ok
        const result = {
          ok: resultOk,
          output: server.output,
          command: `opencode server ${safeServerOrigin} session=${server.sessionId || '—'}`,
          kind: 'opencode' as const,
          code: resultOk ? 0 : 1,
          timedOut: server.timedOut,
          cancelled: server.cancelled,
          error: terminal ? formatExternalCliTerminal(terminal, { headless: true }) : server.error,
          runId: serverRunId,
          terminalClassification: terminal?.classification,
          configSnapshot: input.configSnapshot,
          externalRun: {
            provider: 'opencode' as const,
            serverUrl: safeServerOrigin,
            sessionId: server.sessionId,
            version: server.version,
            configFingerprint: input.configSnapshot
              ? createHash('sha256').update(JSON.stringify(input.configSnapshot)).digest('hex').slice(0, 16)
              : undefined,
            status: terminal?.classification === 'success' ? 'success' as const : terminal?.classification === 'user-cancelled' ? 'aborted' as const : terminal?.classification === 'interrupted' ? 'interrupted' as const : 'failed' as const,
            completionReason: server.completionReason,
            runId: serverRunId,
            adapter: 'opencode',
            conversationId: input.conversationId || serverRunId,
            processId: sessionSnapshot.processId,
            terminalClassification: terminal?.classification,
            eventCursor: sessionSnapshot.eventCursor,
            outputOmittedBytes: sessionSnapshot.output.omittedBytes,
            startedAt: externalStartedAt,
            finishedAt: new Date().toISOString(),
          },
        }
        return result
      }
      if (!serverSession.snapshot().terminal) {
        serverSession.failTransport(server.error || 'OpenCode server unavailable; falling back to CLI')
      }
      // This terminal session represents only the failed server attempt; the
      // same run id is handed to the one-shot CLI adapter below. Explicitly
      // acknowledge that internal attempt before replacing its live owner.
      externalCliSessions.acknowledgeTerminal(serverRunId)
    }
    return runLocalCliAgent({
      ...input,
      cwd,
      requiredConnectors: input.requiredConnectors,
      attachments,
      onStream: (ev) => {
        try {
            const target = mainWindow?.webContents
            if (target && !target.isDestroyed()) {
            target.send('cli:stream', ev)
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
  if (runId) {
    const sessionCancel = await cancelExternalCliSession(runId)
    if (sessionCancel.ok) return { ok: true, killed: 1, confirmed: sessionCancel.confirmed === true }
  }
  const [cli, server] = await Promise.all([
    cancelBashAndWait(runId ? { runId } : { tag: 'cli-agent' }),
    abortOpenCodeRun(runId),
  ])
  return { ok: cli.ok || server.ok, killed: cli.killed + server.killed, confirmed: cli.confirmed || server.ok }
})

/** Reconnect to a Host-owned external session after renderer reload. */
ipcMain.handle('cli:sessionSnapshot', async (_evt, runId: string) => {
  externalCliSessions.pruneTerminalSessions()
  const session = getExternalCliSession(String(runId || ''))
  return session?.snapshot() || null
})

ipcMain.handle('cli:sessionSnapshots', async () => {
  externalCliSessions.pruneTerminalSessions()
  return listExternalCliSessions()
})

ipcMain.handle('cli:sessionRecovery', async () => listExternalCliRecovery())

ipcMain.handle('cli:sessionEvents', async (_evt, input: { runId: string; cursor?: number }) => {
  externalCliSessions.pruneTerminalSessions()
  return externalCliSessions.reconnect(String(input?.runId || ''), Number(input?.cursor || 0)) || null
})

ipcMain.handle('cli:sessionAck', async (_evt, runId: string) =>
  externalCliSessions.acknowledgeTerminal(String(runId || '')),
)

ipcMain.handle('cli:sessionRecoveryAction', async (_evt, input: { runId: string; action: 'resume' | 'retry' }) =>
  externalCliRecoveryAction({
    runId: String(input?.runId || ''),
    action: input?.action === 'resume' ? 'resume' : 'retry',
  }),
)

ipcMain.handle('cli:sessionYield', async (_evt, runId: string) => {
  const session = getExternalCliSession(String(runId || ''))
  return session?.yieldObservation() || null
})

ipcMain.handle('cli:sessionInput', async (_evt, input: { runId: string; value: string; providerSessionId?: string }) =>
  externalCliSessions.interact(String(input?.runId || ''), (session) =>
    session.provideInput(String(input?.value || ''), input?.providerSessionId),
  ),
)

ipcMain.handle('cli:sessionApproval', async (_evt, input: { runId: string; approved: boolean; providerSessionId?: string }) =>
  externalCliSessions.interact(String(input?.runId || ''), (session) =>
    session.provideApproval(input?.approved === true, input?.providerSessionId),
  ),
)

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

ipcMain.handle('tools:toolOutputSpillWrite', async (_evt, input: unknown) => {
  try {
    const value = input && typeof input === 'object' ? input as {
      runId?: string; threadId?: string; tool?: string; output?: string; projectRoot?: string
    } : {}
    const { writeToolOutputSpill } = await import('./attachmentStore')
    return {
      ok: true,
      ...writeToolOutputSpill({
        runId: String(value.runId || ''),
        threadId: value.threadId,
        tool: String(value.tool || 'tool'),
        output: String(value.output || ''),
        projectRoot: value.projectRoot,
      }),
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('tools:toolOutputSpillRead', async (_evt, input: unknown) => {
  try {
    const value = input && typeof input === 'object' ? input as {
      locator?: string; runId?: string; projectRoot?: string; offset?: number; maxBytes?: number
    } : {}
    const { readToolOutputSpill } = await import('./attachmentStore')
    return readToolOutputSpill({
      locator: String(value.locator || ''),
      runId: String(value.runId || ''),
      projectRoot: value.projectRoot,
      offset: value.offset,
      maxBytes: value.maxBytes,
    })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('tools:toolOutputSpillDispose', async (_evt, input: unknown) => {
  const value = input && typeof input === 'object' ? input as { runId?: string; projectRoot?: string } : {}
  const { disposeToolOutputSpills } = await import('./attachmentStore')
  return { ok: disposeToolOutputSpills(String(value.runId || ''), value.projectRoot) }
})

// ── CodeGraph (https://github.com/colbymchenry/codegraph) ────────

ipcMain.handle('codegraph:detect', async () => codegraphDetect())

ipcMain.handle('codegraph:status', async (_evt, projectRoot?: string) =>
  codegraphStatus(projectRoot || workspaceRoot()),
)

ipcMain.handle('codegraph:install', async () => codegraphInstall())

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

ipcMain.handle('subdesign:harnessStatus', async (_evt, binaryPath?: string) => {
  const binary = String(binaryPath || 'harness-mcp').trim()
  if (binary !== 'harness-mcp' && !path.isAbsolute(binary)) return { available: false, platform: process.platform, version: null, reason: 'binary path 必須是 harness-mcp 或絕對路徑。', screenRecording: 'not-required', accessibility: 'not-required' }
  const permissions = process.platform === 'darwin' ? {
    screenRecording: systemPreferences.getMediaAccessStatus('screen'),
    accessibility: systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied',
  } : { screenRecording: 'unsupported', accessibility: 'unsupported' }
  const version = await new Promise<{ ok: boolean; output: string }>((resolve) => {
    const child = spawn(binary, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] })
    let output = ''
    const timer = setTimeout(() => { child.kill('SIGTERM'); resolve({ ok: false, output: 'version check timeout' }) }, 2_000)
    child.stdout?.on('data', (chunk) => { output += String(chunk).slice(0, 200) })
    child.once('error', (error) => { clearTimeout(timer); resolve({ ok: false, output: error.message }) })
    child.once('exit', (code) => { clearTimeout(timer); resolve({ ok: code === 0, output: output.trim() }) })
  })
  const expected = 'harness-mcp 0.7.0'
  return { available: process.platform === 'darwin' && version.ok && version.output === expected, platform: process.platform, version: version.output || null, reason: process.platform !== 'darwin' ? 'Harness autonomous run 目前僅支援 macOS。' : version.ok && version.output === expected ? null : `需要 ${expected}；${version.output || 'binary unavailable'}`, ...permissions }
})
ipcMain.handle('app:version', () => app.getVersion())
ipcMain.handle('pi-host:status', () => piHostSupervisor.status())
ipcMain.handle('pi-host:health', async () => piHostSupervisor.health())
ipcMain.handle('pi-host:settings:get', async () => piHostSupervisor.getSettingsSnapshot())
ipcMain.handle('pi-host:settings:update', async (_evt, patch: Record<string, unknown>) => piHostSupervisor.updateSettingsSnapshot(patch || {}))
ipcMain.handle('pi-host:settings:profile', async (_evt, role?: Record<string, unknown>, taskOverride?: Record<string, unknown>) => ({ profile: await piHostSupervisor.profile(role, taskOverride) }))
ipcMain.handle('pi-host:sessions:create', async (_evt, title?: string, threadId?: string) => piHostSupervisor.createSession(title, threadId))
ipcMain.handle('pi-host:sessions:create-child', async (_evt, input: Record<string, unknown>) => piHostSupervisor.createChildSession(input || {}))
ipcMain.handle('pi-host:sessions:list', async () => ({ sessions: await piHostSupervisor.listSessions() }))
ipcMain.handle('pi-host:sessions:record', async (_evt, sessionId: string, before?: number, limit?: number) => ({ page: await piHostSupervisor.readSessionRecord(sessionId, before, limit) }))
ipcMain.handle('pi-host:runs:list', async () => ({ queue: await piHostSupervisor.listQueuedRuns() }))
ipcMain.handle('pi-host:runs:active', async () => piHostSupervisor.listAttachmentRuns())
ipcMain.handle('pi-host:runs:attach', async (_evt, runId: string, before?: number, limit?: number) => ({ page: await piHostSupervisor.attachRun(runId, before, limit) }))
ipcMain.handle('pi-host:runs:finalize-claim', async (_evt, runId: string, claimantId: string, leaseMs?: number) => piHostSupervisor.claimRunFinalization(runId, claimantId, leaseMs))
ipcMain.handle('pi-host:runs:finalize-complete', async (_evt, runId: string, claimantId: string, claimEpoch: number) => piHostSupervisor.completeRunFinalization(runId, claimantId, claimEpoch))
ipcMain.handle('pi-host:runs:ack', async (_evt, runId: string) => ({ runId, resolved: await piHostSupervisor.acknowledgeRun(runId) }))
ipcMain.handle('pi-host:runs:enqueue', async (_evt, input: Record<string, unknown>) => ({ queue: await piHostSupervisor.enqueueRun(input || {}) }))
ipcMain.handle('pi-host:runs:cancel', async (_evt, runId: string) => ({ queue: await piHostSupervisor.cancelQueuedRun(runId) }))
ipcMain.handle('pi-host:runs:claim', async (_evt, runId?: string) => piHostSupervisor.claimQueuedRun(runId))
ipcMain.handle('pi-host:runs:settle', async (_evt, runId: string, settlement: PiTurnSettlement) => piHostSupervisor.settleQueuedRun(runId, settlement))
ipcMain.handle('pi-host:resources:list', async () => ({ resources: await piHostSupervisor.listResources() }))
ipcMain.handle('pi-host:resources:reload', async (_evt, resources: unknown[]) => ({ resources: await piHostSupervisor.reloadResources(resources || []) }))
ipcMain.handle('pi-host:memory:list', async () => ({ memories: await piHostSupervisor.listMemories() }))
ipcMain.handle('pi-host:memory:add', async (_evt, memory: Record<string, unknown>) => ({ memories: await piHostSupervisor.addMemory(memory || {}) }))
ipcMain.handle('pi-host:memory:delete', async (_evt, id: string) => ({ memories: await piHostSupervisor.deleteMemory(id) }))
ipcMain.handle('pi-host:memory:clear', async () => ({ memories: await piHostSupervisor.clearMemories() }))
ipcMain.handle('pi-host:memory:recall', async (_evt, query: string, project?: string, limit?: number) => ({ memories: await piHostSupervisor.recallMemory(query, project, limit) }))
ipcMain.handle('pi-host:capabilities:list', async () => ({ items: await piHostSupervisor.listCapabilities() }))
ipcMain.handle('pi-host:capabilities:load', async (_evt, id: string) => piHostSupervisor.loadCapability(id))
ipcMain.handle('pi-host:capabilities:search', async (_evt, query: string) => ({ items: await piHostSupervisor.searchCapabilities(query) }))
ipcMain.handle('pi-host:extensions:list', async () => ({ extensions: await piHostSupervisor.listExtensions() }))
ipcMain.handle('pi-host:extensions:install', async (_evt, input: Record<string, unknown>) => piHostSupervisor.mutateExtension('extensions/install', input || {}))
ipcMain.handle('pi-host:extensions:update', async (_evt, input: Record<string, unknown>) => piHostSupervisor.mutateExtension('extensions/update', input || {}))
ipcMain.handle('pi-host:extensions:reload', async (_evt, id: string) => piHostSupervisor.mutateExtension('extensions/reload', { id }))
ipcMain.handle('pi-host:extensions:set-enabled', async (_evt, input: { id: string; enabled: boolean }) => piHostSupervisor.mutateExtension('extensions/set-enabled', input))
ipcMain.handle('pi-host:extensions:uninstall', async (_evt, id: string) => piHostSupervisor.mutateExtension('extensions/uninstall', { id }))
ipcMain.handle('pi-host:tools:list', async () => ({ builtinTools: await piHostSupervisor.listTools() }))
ipcMain.handle('pi-host:tools:catalog', async () => ({ catalog: await piHostSupervisor.listCatalog() }))
ipcMain.handle('pi-host:resources:sync-skills', async (_evt, skills: Array<{ name?: string; description?: string; body?: string; status?: string }>) => piHostSupervisor.syncSkills(skills || []))
ipcMain.handle('pi-host:resources:list-skill-files', async () => piHostSupervisor.readSkillFiles())
ipcMain.handle('pi-host:approvals:resolve', async (_evt, input: { runId: string; callId: string; decision: 'allow' | 'deny'; answer?: string }) => {
  const response = await piHostSupervisor.resolveApproval(input)
  return response
})
ipcMain.handle('pi-host:sessions:fork', async (_evt, sessionId: string) => piHostSupervisor.forkSession(sessionId))
ipcMain.handle('pi-host:sessions:reset', async (_evt, sessionId: string) => piHostSupervisor.resetSession(sessionId))
ipcMain.handle('pi-host:sessions:archive', async (_evt, sessionId: string) => piHostSupervisor.archiveSession(sessionId))
ipcMain.handle('pi-host:sessions:compact', async (_evt, sessionId: string) => piHostSupervisor.compactSession(sessionId))
ipcMain.handle('pi-host:tools:execute', async (_evt, input: { tool: 'read' | 'grep' | 'find' | 'ls' | 'write' | 'edit' | 'bash' | 'code' | 'mcp'; params?: Record<string, unknown> }) => piHostSupervisor.executeTool(input.tool, input.params || {}))
ipcMain.handle('pi-host:turn:submit', async (_evt, input: { sessionId: string; prompt: string; runId?: string; cwd?: string; profile?: Record<string, unknown>; contextPolicy?: Record<string, unknown>; pattern?: string; maxIterations?: number; definitionOfDone?: string; timeoutMs?: number; mode?: 'steer' | 'queue'; queue?: boolean; pluginExecution?: unknown }) => piHostSupervisor.submitTurn(input.sessionId, input.prompt, input.runId, input.cwd, input.profile, { contextPolicy: input.contextPolicy, pattern: input.pattern, maxIterations: input.maxIterations, definitionOfDone: input.definitionOfDone, timeoutMs: input.timeoutMs, mode: input.mode, queue: input.queue, pluginExecution: input.pluginExecution }))
ipcMain.handle('pi-host:turn:cancel', async (_evt, runId: string) => piHostSupervisor.cancelTurn(runId))
ipcMain.handle('pi-host:turn:interrupt', async (_evt, input: { runId: string; reason?: 'user' | 'timeout' }) => piHostSupervisor.interruptTurn(input.runId, input.reason))

// ── Durable compaction checkpoints (ADR-0040 storage layer, ADR-0042 resume) ──
const compactionCheckpoints = new JsonCompactionCheckpointStore(
  path.join(app.getPath('userData'), 'run-checkpoints'),
)
ipcMain.handle('checkpoints:save', async (_evt, input: { runId: string; threadId?: string; summary: string; messages: unknown[] }) =>
  compactionCheckpoints.save(input || { runId: '', summary: '', messages: [] }))
ipcMain.handle('checkpoints:load', async (_evt, runId: string) => compactionCheckpoints.load(runId))
ipcMain.handle('checkpoints:list', async (_evt, runId?: string) => compactionCheckpoints.list(runId))
ipcMain.handle('checkpoints:remove', async (_evt, runId: string) => compactionCheckpoints.remove(runId))
ipcMain.handle('checkpoints:claim-resume', async (_evt, runId: string) => compactionCheckpoints.claimResume(runId))

// ── Durable run-journal mirror (localStorage eviction / torn-write recovery) ──
// The renderer journal stays the schema owner; this only mirrors its serialized
// state into userData so an evicted localStorage can be restored at startup.
const runJournalMirror = new JournalMirrorStore(path.join(app.getPath('userData'), 'journal'))
ipcMain.handle('journal:mirror:write', (_evt, state: unknown) => {
  if (typeof state !== 'string') return { ok: false, error: 'state must be a string' }
  return runJournalMirror.save(state)
})
ipcMain.handle('journal:mirror:read', () => runJournalMirror.read())

// ── Signed Beta updates + N-1→N migration transaction ─────────
// The channel is deliberately opt-in through SUBAGENTS_UPDATE_PUBLIC_KEY;
// without a pinned key the app fails closed instead of accepting unsigned code.
ipcMain.handle('updates:state', async () => readUpdateState())
ipcMain.handle('updates:check', async (_evt, input?: { url?: string }) => {
  try {
    return { ok: true, state: await discoverUpdate({ url: input?.url, publicKeyPem: updatePublicKeyFromEnv() }) }
  } catch (error) {
    return { ok: false, state: readUpdateState(), error: error instanceof Error ? error.message : String(error) }
  }
})
ipcMain.handle('updates:defer', async (_evt, version: string) => {
  try { return { ok: true, state: deferUpdate(String(version || ''), 7) } }
  catch (error) { return { ok: false, state: readUpdateState(), error: error instanceof Error ? error.message : String(error) } }
})
ipcMain.handle('updates:download', async (evt) => {
  try {
    const state = await downloadUpdate({
      publicKeyPem: updatePublicKeyFromEnv(),
      onProgress: (progress) => evt.sender.send('updates:progress', { progress }),
    })
    return { ok: true, state }
  } catch (error) {
    const state = markInstallFailure(error)
    return { ok: false, state, error: error instanceof Error ? error.message : String(error) }
  }
})
ipcMain.handle('updates:captureMigration', async (_evt, input: {
  appVersion?: string
  rendererStorage?: Record<string, string>
  projects?: Array<{ root: string; name?: string; branch?: string | null }>
  queue?: unknown
  schedules?: unknown[]
  artifactIndex?: unknown
}) => captureMigrationSnapshot({
  appVersion: String(input?.appVersion || app.getVersion()),
  rendererStorage: input?.rendererStorage || {},
  vaultMetadata: listVaultMeta(),
  projects: input?.projects || [],
  queue: input?.queue || [],
  schedules: (() => {
    try {
      const file = jobsPath()
      if (!fs.existsSync(file)) return []
      const jobs = JSON.parse(fs.readFileSync(file, 'utf8'))
      return Array.isArray(jobs) ? jobs : []
    } catch { return [] }
  })(),
  artifactIndex: input?.artifactIndex ?? null,
}))
ipcMain.handle('updates:install', async (_evt, snapshot: unknown) => {
  try {
    const state = prepareUpdateInstall(snapshot as Parameters<typeof prepareUpdateInstall>[0], updatePublicKeyFromEnv())
    if (!state.downloadedPath) throw new Error('更新檔案路徑遺失')
    const openError = await shell.openPath(state.downloadedPath)
    if (openError) throw new Error(openError)
    return { ok: true, restartRequired: true, state }
  } catch (error) {
    const state = markInstallFailure(error)
    return { ok: false, restartRequired: false, state, error: error instanceof Error ? error.message : String(error) }
  }
})
ipcMain.handle('updates:rollback', async () => {
  try { return rollbackUpdate() }
  catch (error) { return { ok: false, launchable: true, state: readUpdateState(), error: error instanceof Error ? error.message : String(error) } }
})
ipcMain.handle('updates:pendingMigration', async () => pendingMigration())
ipcMain.handle('updates:completeMigration', async (_evt, snapshot?: unknown) => completeMigration(snapshot))

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

const SUBDESIGN_ARTIFACT_ROOT = '.subagents/subdesign/artifacts'
const SUBDESIGN_METADATA_ROOT = '.subagents/subdesign'
const SUBDESIGN_MAX_EXPORT_FILES = 80
const SUBDESIGN_MAX_EXPORT_BYTES = 50 * 1024 * 1024
const SUBDESIGN_MAX_METADATA_BYTES = 2 * 1024 * 1024

function safeSubDesignExportName(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return (normalized || 'subdesign-artifact').slice(0, 80)
}

function artifactFile(root: string, relativePath: string): string {
  if (!isProjectRelativePath(relativePath)) throw new Error(`不安全的 artifact path：${relativePath}`)
  const file = resolveWorkspacePath(relativePath, root)
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`找不到 artifact file：${relativePath}`)
  const realRoot = fs.realpathSync(root)
  const realFile = fs.realpathSync(file)
  if (!isPathInside(realRoot, realFile)) throw new Error(`artifact symlink escapes workspace：${relativePath}`)
  return realFile
}

function preparePinnedPatchScope(input: {
  artifact: unknown
  pins: unknown
  projectRoot?: string
}) {
  const submitted = validateSubDesignArtifactManifest(input.artifact)
  if (!submitted.ok) return { ok: false as const, error: `artifact manifest invalid：${submitted.errors.join('；')}` }
  const parsedPins = parsePinnedCommentPayload({ pins: input.pins })
  if (!parsedPins.ok) return { ok: false as const, error: parsedPins.errors.join('；') }
  const root = workspaceRootFor(input.projectRoot)
  const manifestPath = resolveWorkspacePath(
    `${SUBDESIGN_ARTIFACT_ROOT}/${safeSubDesignMetadataId(submitted.manifest.id)}/manifest.json`,
    root,
  )
  const canonical = validateSubDesignArtifactManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')))
  if (!canonical.ok) return { ok: false as const, error: `Host artifact manifest invalid：${canonical.errors.join('；')}` }
  if (canonical.manifest.revision !== submitted.manifest.revision) {
    return { ok: false as const, error: `artifact revision 已變更：目前為 ${canonical.manifest.revision}。請重新選取 pin。` }
  }
  const content = fs.readFileSync(artifactFile(root, canonical.manifest.entry), 'utf8')
  const selectors = parsedPins.pins.map((pin) => pin.selector)
  const resolved = resolvePinnedHtmlRanges(content, selectors)
  if (!resolved.ok) return { ok: false as const, error: resolved.reason }
  const scopeId = `pin_${randomUUID().replaceAll('-', '')}`
  const scope = createPinnedPatchScope({
    scopeId,
    artifactId: canonical.manifest.id,
    revision: canonical.manifest.revision,
    path: canonical.manifest.entry,
    pins: parsedPins.pins,
  })
  const scopePath = resolveWorkspacePath(
    `${SUBDESIGN_METADATA_ROOT}/pin-scopes/${safeSubDesignMetadataId(canonical.manifest.id)}.json`,
    root,
  )
  fs.mkdirSync(path.dirname(scopePath), { recursive: true })
  fs.writeFileSync(scopePath, `${JSON.stringify(scope, null, 2)}\n`, 'utf8')
  return { ok: true as const, scopeId }
}

function patchSubDesignArtifact(input: {
  artifact: unknown
  operations: unknown
  projectRoot?: string
}) {
  const validation = validateSubDesignArtifactManifest(input.artifact)
  if (!validation.ok) return { ok: false as const, error: `artifact manifest invalid：${validation.errors.join('；')}` }
  const root = workspaceRootFor(input.projectRoot)
  const directionGateError = subDesignPatchDirectionGateError(root, validation.manifest.briefId)
  if (directionGateError) return { ok: false as const, error: directionGateError }
  const operations = Array.isArray(input.operations) ? input.operations.slice(0, 12) : []
  if (!operations.length) return { ok: false as const, error: 'operations 必須至少包含一個 exact replacement。' }
  const allowedPaths = new Set([validation.manifest.entry, ...validation.manifest.supportingFiles])
  const nextByPath = new Map<string, string>()
  for (const raw of operations) {
    if (!raw || typeof raw !== 'object') return { ok: false as const, error: 'patch operation 必須是 object。' }
    const operation = raw as Partial<SubDesignArtifactPatchOperation>
    const relativePath = String(operation.path || '').trim().replaceAll('\\', '/')
    const find = String(operation.find || '')
    const replace = String(operation.replace ?? '')
    const expectedMatches = Math.max(1, Math.min(12, Math.floor(Number(operation.expectedMatches) || 1)))
    if (!isProjectRelativePath(relativePath) || !allowedPaths.has(relativePath)) return { ok: false as const, error: `patch path 不是 artifact entry/supporting file：${relativePath}` }
    if (!find || find.length > 12_000 || replace.length > 12_000) return { ok: false as const, error: 'patch find/replace 不合法或超過 12KB。' }
    const file = artifactFile(root, relativePath)
    let content = nextByPath.get(relativePath)
    if (content == null) {
      const bytes = fs.readFileSync(file)
      if (bytes.includes(0)) return { ok: false as const, error: `patch 只支援文字 artifact file：${relativePath}` }
      content = bytes.toString('utf8')
    }
    let matches = 0
    let cursor = 0
    while (true) {
      const index = content.indexOf(find, cursor)
      if (index < 0) break
      matches += 1
      cursor = index + find.length
    }
    if (matches !== expectedMatches) return { ok: false as const, error: `patch ${relativePath} 找到 ${matches} 個匹配，預期 ${expectedMatches} 個；為避免誤改已停止。` }
    content = content.split(find).join(replace)
    if (Buffer.byteLength(content, 'utf8') > 5 * 1024 * 1024) return { ok: false as const, error: `patch 後檔案過大：${relativePath}` }
    nextByPath.set(relativePath, content)
  }
  for (const [relativePath, content] of nextByPath) {
    fs.writeFileSync(artifactFile(root, relativePath), content, 'utf8')
  }
  const artifact = {
    ...validation.manifest,
    revision: validation.manifest.revision + 1,
    updatedAt: new Date().toISOString(),
  }
  return { ok: true as const, artifact, paths: [...nextByPath.keys()], operationCount: operations.length }
}

function normalizeSubDesignTweakValue(tweak: { kind: string; options?: string[]; min?: number; max?: number }, raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const value = String(raw ?? '').trim()
  if (!value || value.length > 12_000 || value.includes('\0')) return { ok: false, error: 'tweak value 不可為空、含 NUL 或超過 12KB。' }
  if (tweak.kind === 'boolean') {
    if (value !== 'true' && value !== 'false') return { ok: false, error: 'boolean tweak 只能是 true 或 false。' }
    return { ok: true, value }
  }
  if (tweak.kind === 'number') {
    const number = Number(value)
    if (!Number.isFinite(number)) return { ok: false, error: 'number tweak 必須是有限數字。' }
    if (tweak.min != null && number < tweak.min) return { ok: false, error: `數值不可小於 ${tweak.min}。` }
    if (tweak.max != null && number > tweak.max) return { ok: false, error: `數值不可大於 ${tweak.max}。` }
    return { ok: true, value: String(number) }
  }
  if (tweak.kind === 'select') {
    if (!tweak.options?.includes(value)) return { ok: false, error: 'select tweak value 不在 options 內。' }
    return { ok: true, value }
  }
  if (tweak.kind === 'color' && !(/^(?:#[0-9a-f]{3,8}|rgba?\([^<>]{1,120}\)|hsla?\([^<>]{1,120}\))$/i.test(value))) {
    return { ok: false, error: 'color tweak 只接受 hex、rgb/rgba 或 hsl/hsla 色值。' }
  }
  return { ok: true, value }
}

function applySubDesignArtifactTweak(input: { artifact: unknown; tweakId: unknown; value: unknown; projectRoot?: string }) {
  const validation = validateSubDesignArtifactManifest(input.artifact)
  if (!validation.ok) return { ok: false as const, error: `artifact manifest invalid：${validation.errors.join('；')}` }
  const tweak = validation.manifest.tweaks?.find((item) => item.id === String(input.tweakId || '').trim())
  if (!tweak) return { ok: false as const, error: '找不到 artifact 宣告的 structured tweak。' }
  const normalized = normalizeSubDesignTweakValue(tweak, input.value)
  if (!normalized.ok) return normalized
  const replacement = tweak.replaceTemplate.replaceAll('{{value}}', normalized.value)
  const result = patchSubDesignArtifact({
    artifact: validation.manifest,
    operations: [{ path: tweak.path, find: tweak.find, replace: replacement, expectedMatches: 1 }],
    projectRoot: input.projectRoot,
  })
  if (!result.ok) return result
  const nextTweaks = (result.artifact.tweaks || []).map((item) => item.id === tweak.id ? { ...item, value: normalized.value, find: replacement } : item)
  return { ...result, artifact: { ...result.artifact, tweaks: nextTweaks } }
}

function safeSubDesignMetadataId(value: unknown): string {
  const id = String(value || '').trim()
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(id)) throw new Error('不安全的 SubDesign metadata id')
  return id
}

function subDesignMetadataFile(root: string, kind: SubDesignMetadataKind, payload: Record<string, unknown>): string {
  if (kind === 'brief') return resolveWorkspacePath(`${SUBDESIGN_METADATA_ROOT}/briefs/${safeSubDesignMetadataId(payload.id)}.json`, root)
  if (kind === 'artifact') return resolveWorkspacePath(`${SUBDESIGN_ARTIFACT_ROOT}/${safeSubDesignMetadataId(payload.id)}/manifest.json`, root)
  if (kind === 'critique') return resolveWorkspacePath(`${SUBDESIGN_METADATA_ROOT}/critiques/${safeSubDesignMetadataId(payload.artifactId)}-r${Math.max(1, Math.floor(Number(payload.revision) || 1))}.json`, root)
  if (kind === 'open-design-pack') {
    // Pack ids are "open-design:<catalog-id>" and the catalog id itself uses ':'
    // as a path separator (e.g. "open-design:design-templates:web-prototype"),
    // so they fail safeSubDesignMetadataId's stricter check. Slug instead of
    // rejecting — this mirrors the targetId sanitization in copyOpenDesignVendorPack.
    const slug = String(payload.id || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 160)
    if (!slug) throw new Error('不安全的 SubDesign metadata id')
    return resolveWorkspacePath(`${SUBDESIGN_METADATA_ROOT}/open-design-packs/${slug}.json`, root)
  }
  if (kind === 'open-design-snapshot') {
    const relativePath = String(payload.projectRelativePath || '').trim().replaceAll('\\', '/')
    if (!/^\.subagents\/open-design\/snapshots\/[a-zA-Z0-9._-]+\.json$/.test(relativePath)) {
      throw new Error('不安全的 OpenDesign snapshot path')
    }
    return resolveWorkspacePath(relativePath, root)
  }
  if (kind === 'open-design-provider-settings') {
    return resolveWorkspacePath(`${SUBDESIGN_METADATA_ROOT}/providers/${safeSubDesignMetadataId(payload.id)}.json`, root)
  }
  if (kind === 'open-design-provider-run') {
    return resolveWorkspacePath(`${SUBDESIGN_METADATA_ROOT}/provider-runs/${safeSubDesignMetadataId(payload.runId)}.json`, root)
  }
  return resolveWorkspacePath(`${SUBDESIGN_METADATA_ROOT}/exports/${safeSubDesignMetadataId(payload.id)}.json`, root)
}

function readJsonDirectory(root: string, relativeDir: string, limit = 160): unknown[] {
  const dir = resolveWorkspacePath(relativeDir, root)
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return []
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .slice(0, limit)
    .map((entry) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, entry.name), 'utf8')) as unknown
      } catch {
        return null
      }
    })
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
}

function readStoredSubDesignArtifacts(root: string): SubDesignArtifact[] {
  const dir = resolveWorkspacePath(SUBDESIGN_ARTIFACT_ROOT, root)
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return []
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .slice(0, 120)
    .map((entry) => {
      try {
        const manifestPath = path.join(dir, entry.name, 'manifest.json')
        if (!fs.existsSync(manifestPath)) return null
        const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown
        const result = validateSubDesignArtifactManifest(parsed)
        return result.ok ? result.manifest : null
      } catch {
        return null
      }
    })
    .filter((artifact): artifact is SubDesignArtifact => Boolean(artifact))
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

function copyOpenDesignVendorPack(input: {
  sourcePath?: string
  assetPaths?: string[]
  targetId?: string
  digest?: string
  kind?: 'template' | 'skill' | 'prompt' | 'craft' | 'media'
  projectRoot?: string
}) {
  const root = workspaceRootFor(input.projectRoot)
  const vendorRoot = openDesignVendorRoot()
  const sourcePath = safeVendorRelative(input.sourcePath)
  const sourceDir = path.resolve(vendorRoot, sourcePath)
  if (!isPathInside(vendorRoot, sourceDir) || !fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    throw new Error('Open Design sourcePath 不存在或不是資料夾')
  }
  const targetId = String(input.targetId || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 120)
  if (!targetId) throw new Error('targetId 必填')
  const digest = String(input.digest || '').trim()
  if (!/^[a-f0-9]{16,128}$/i.test(digest)) throw new Error('Open Design digest 不合法')
  const assets = Array.isArray(input.assetPaths) ? input.assetPaths.slice(0, 160).map(safeVendorRelative) : []
  if (!assets.length) throw new Error('Open Design pack 沒有可複製 assets')
  const targetRel = `.subagents/subdesign/vendor-packs/${targetId}`
  const targetDir = resolveWorkspacePath(targetRel, root)
  fs.mkdirSync(targetDir, { recursive: true })
  let bytes = 0
  let files = 0
  for (const asset of assets) {
    const sourceFile = path.resolve(vendorRoot, asset)
    const relToSource = path.relative(sourceDir, sourceFile)
    if (!isPathInside(sourceDir, sourceFile) || relToSource.startsWith('..') || !fs.existsSync(sourceFile) || !fs.statSync(sourceFile).isFile()) continue
    const realFile = fs.realpathSync(sourceFile)
    if (!isPathInside(vendorRoot, realFile)) throw new Error('Open Design asset symlink escapes vendor root')
    const stat = fs.statSync(realFile)
    bytes += stat.size
    files += 1
    if (files > 160 || bytes > 50 * 1024 * 1024) throw new Error('Open Design pack 超過複製大小限制')
    const destination = path.resolve(targetDir, relToSource)
    if (!isPathInside(targetDir, destination)) throw new Error('Open Design target path escapes project')
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(realFile, destination)
  }
  if (!files) throw new Error('Open Design pack 沒有可複製的檔案')
  const copiedAt = new Date().toISOString()
  fs.writeFileSync(path.join(targetDir, 'pack-manifest.json'), JSON.stringify({ sourcePath, digest, kind: input.kind || 'media', files, bytes, copiedAt }, null, 2), 'utf8')
  return {
    ok: true as const,
    path: `${targetRel}/pack-manifest.json`,
    files,
    bytes,
  }
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

const SUBDESIGN_EVIDENCE_ROOT = `${SUBDESIGN_METADATA_ROOT}/critiques`
const SUBDESIGN_MAX_EVIDENCE_BYTES = 20 * 1024 * 1024

type SubDesignEvidenceAttestation = {
  evidenceId: string
  artifactId: string
  revision: number
  kind: string
  path: string
  source: string
  sha256: string
  createdAt: string
  signature: string
}

function sha256File(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
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

function evidenceAttestationFile(evidenceFile: string): string {
  return `${evidenceFile}.attestation.json`
}

function attestSubDesignEvidence(input: {
  root: string
  artifact: SubDesignArtifact
  kind: string
  file: string
  source: string
  createdAt?: string
}): SubDesignEvidenceAttestation {
  const createdAt = input.createdAt || new Date().toISOString()
  const payload = {
    evidenceId: `evidence_${randomUUID().replaceAll('-', '').slice(0, 24)}`,
    artifactId: input.artifact.id,
    revision: input.artifact.revision,
    kind: input.kind,
    path: path.relative(input.root, input.file).replaceAll(path.sep, '/'),
    source: input.source,
    sha256: sha256File(input.file),
    createdAt,
  }
  const signature = createHmac('sha256', evidenceSecret()).update(JSON.stringify(payload)).digest('hex')
  const attestation = { ...payload, signature }
  fs.writeFileSync(evidenceAttestationFile(input.file), JSON.stringify(attestation, null, 2), 'utf8')
  return attestation
}

function readAndVerifyEvidenceAttestation(root: string, artifact: SubDesignArtifact, kind: string, relativePath: string, file: string): SubDesignEvidenceAttestation {
  const attestationPath = evidenceAttestationFile(file)
  if (!fs.existsSync(attestationPath)) throw new Error('缺少 main process attestation；請重新 capture 或 lint。')
  const parsed = JSON.parse(fs.readFileSync(attestationPath, 'utf8')) as Partial<SubDesignEvidenceAttestation>
  const payload = {
    evidenceId: String(parsed.evidenceId || ''),
    artifactId: String(parsed.artifactId || ''),
    revision: Number(parsed.revision),
    kind: String(parsed.kind || ''),
    path: String(parsed.path || '').replaceAll('\\', '/'),
    source: String(parsed.source || ''),
    sha256: String(parsed.sha256 || ''),
    createdAt: String(parsed.createdAt || ''),
  }
  if (!/^evidence_[a-zA-Z0-9]{12,64}$/.test(payload.evidenceId) || !/^[a-f0-9]{64}$/i.test(payload.sha256) || !payload.createdAt) throw new Error('attestation 欄位不合法')
  const signature = createHmac('sha256', evidenceSecret()).update(JSON.stringify(payload)).digest('hex')
  if (signature !== parsed.signature) throw new Error('attestation signature 不正確')
  if (payload.artifactId !== artifact.id || payload.revision !== artifact.revision || payload.kind !== kind || payload.path !== relativePath) throw new Error('attestation 與目前 artifact revision/kind/path 不一致')
  if (!['subdesign:captureEvidence', 'subdesign:lintArtifact', 'subdesign:contrastGate'].includes(payload.source)) throw new Error('evidence source 不可信')
  const actualHash = sha256File(file)
  if (actualHash !== payload.sha256) throw new Error('evidence sha256 與檔案內容不一致')
  return { ...payload, signature: String(parsed.signature) }
}

function verifySubDesignEvidenceContent(kind: string, file: string): void {
  const stat = fs.statSync(file)
  if (stat.size <= 0) throw new Error('evidence 檔案是空的')
  if (stat.size > SUBDESIGN_MAX_EVIDENCE_BYTES) throw new Error('evidence 檔案過大')
  const bytes = fs.readFileSync(file)
  if (kind === 'screenshot') {
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(pngSignature) || bytes.toString('ascii', 12, 16) !== 'IHDR') {
      throw new Error('screenshot evidence 不是有效的 PNG 檔案')
    }
    return
  }
  if (bytes.includes(0)) throw new Error('文字 evidence 含有 binary NUL')
  const text = bytes.toString('utf8').trim()
  if (text.length < 3) throw new Error('文字 evidence 內容過短')
  if (kind === 'dom' && !/(?:<!doctype\s+html|<html[\s>])/i.test(text)) {
    throw new Error('dom evidence 不是 HTML snapshot')
  }
  if (kind === 'gate') {
    try {
      const gate = JSON.parse(text) as Record<string, unknown>
      if (!gate || typeof gate.gateId !== 'string' || !gate.gateId) throw new Error('missing gateId')
    } catch {
      throw new Error('gate evidence 不是有效的 JSON 或缺少 gateId')
    }
  }
}

function subDesignPatchDirectionGateError(root: string, briefId: string): string | null {
  try {
    const briefFile = subDesignMetadataFile(root, 'brief', { id: briefId })
    if (!fs.existsSync(briefFile) || !fs.statSync(briefFile).isFile()) {
      return 'SubDesign direction gate：找不到 canonical brief，請先選定 direction。'
    }
    const brief = JSON.parse(fs.readFileSync(briefFile, 'utf8')) as Record<string, unknown>
    if (String(brief.selectedDirectionId || '').trim()) return null
  } catch {
    return 'SubDesign direction gate：canonical brief 無法驗證，請先選定 direction。'
  }
  return 'SubDesign direction gate：請先選定 direction，再使用 design_artifact_patch。'
}

function verifySubDesignEvidence(input: {
  artifact: unknown
  evidence: unknown
  projectRoot?: string
}) {
  const validation = validateSubDesignArtifactManifest(input.artifact)
  if (!validation.ok) return { ok: false as const, validKinds: [], errors: validation.errors }
  const artifact = validation.manifest
  const root = workspaceRootFor(input.projectRoot)
  const requiredKinds = ['screenshot', 'dom', 'lint'] as const
  const validKinds = new Set<string>()
  const errors: string[] = []
  const rawEvidence = Array.isArray(input.evidence) ? input.evidence : []
  const allowedFiles = new Set<string>()
  for (const relativePath of [artifact.entry, ...artifact.supportingFiles]) {
    try {
      const file = resolveWorkspacePath(relativePath, root)
      if (fs.existsSync(file)) allowedFiles.add(path.resolve(file))
    } catch {
      /* manifest validation already filters traversal */
    }
  }
  const evidenceDir = path.resolve(root, `${SUBDESIGN_EVIDENCE_ROOT}/${artifact.id}/evidence`)
  const artifactUpdatedAt = Date.parse(artifact.updatedAt)

  for (const kind of requiredKinds) {
    const item = rawEvidence.find((candidate) => candidate && typeof candidate === 'object' && (candidate as Record<string, unknown>).kind === kind) as Record<string, unknown> | undefined
    const relativePath = String(item?.path || '').trim().replaceAll('\\', '/')
    if (!relativePath) {
      errors.push(`${kind} evidence 缺少由工具產生的 path。`)
      continue
    }
    try {
      if (!isProjectRelativePath(relativePath)) throw new Error('path 不是 project-relative')
      const file = resolveWorkspacePath(relativePath, root)
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('檔案不存在')
      const realRoot = fs.realpathSync(root)
      const realFile = fs.realpathSync(file)
      if (!isPathInside(realRoot, realFile)) throw new Error('symlink escapes workspace')
      const allowed = isPathInside(evidenceDir, realFile) || allowedFiles.has(path.resolve(file))
      if (!allowed) throw new Error('path 不在 artifact evidence 或 supporting files 範圍')
      const stat = fs.statSync(realFile)
      if (Number.isFinite(artifactUpdatedAt) && stat.mtimeMs + 2_000 < artifactUpdatedAt) throw new Error('檔案早於本次 artifact revision')
      const attestation = readAndVerifyEvidenceAttestation(root, artifact, kind, relativePath, realFile)
      if (item?.sha256 && String(item.sha256).toLowerCase() !== attestation.sha256) throw new Error('提交的 sha256 與 attestation 不一致')
      if (item?.evidenceId && String(item.evidenceId) !== attestation.evidenceId) throw new Error('提交的 evidenceId 與 attestation 不一致')
      verifySubDesignEvidenceContent(kind, realFile)
      if (kind === 'lint') {
        const lint = JSON.parse(fs.readFileSync(realFile, 'utf8')) as Record<string, unknown>
        if (lint.kind !== 'lint' || lint.source !== 'subdesign:lintArtifact' || lint.artifactId !== artifact.id || Number(lint.revision) !== artifact.revision) throw new Error('lint evidence 語意欄位不一致')
        const entryFile = artifactFile(root, artifact.entry)
        if (lint.entrySha256 !== sha256File(entryFile)) throw new Error('lint evidence 對應的 artifact entry 已變更')
      }
      validKinds.add(kind)
    } catch (error) {
      errors.push(`${kind} evidence ${relativePath} 無效：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  for (const candidate of rawEvidence) {
    if (!candidate || typeof candidate !== 'object') continue
    const item = candidate as Record<string, unknown>
    const relativePath = String(item.path || '').trim().replaceAll('\\', '/')
    if (!relativePath || requiredKinds.includes(item.kind as typeof requiredKinds[number])) continue
    try {
      if (!isProjectRelativePath(relativePath)) throw new Error('path 不是 project-relative')
      const file = resolveWorkspacePath(relativePath, root)
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('檔案不存在')
      const realRoot = fs.realpathSync(root)
      const realFile = fs.realpathSync(file)
      if (!isPathInside(realRoot, realFile)) throw new Error('symlink escapes workspace')
      if (!isPathInside(evidenceDir, realFile) && !allowedFiles.has(path.resolve(file))) throw new Error('path 不在 artifact evidence 或 supporting files 範圍')
      const candidateKind = String(item.kind || 'evidence')
      if (isPathInside(evidenceDir, realFile)) readAndVerifyEvidenceAttestation(root, artifact, candidateKind, relativePath, realFile)
      verifySubDesignEvidenceContent(candidateKind, realFile)
      if (candidateKind === 'gate') {
        const gate = JSON.parse(fs.readFileSync(realFile, 'utf8')) as Record<string, unknown>
        const entryFile = artifactFile(root, artifact.entry)
        verifyGateEvidenceSemantics(gate, artifact, entryFile)
      }
    } catch (error) {
      errors.push(`${String(item.kind || 'evidence')} path ${relativePath} 無效：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return {
    ok: requiredKinds.every((kind) => validKinds.has(kind)) && errors.length === 0,
    validKinds: [...validKinds],
    errors,
  }
}

async function captureSubDesignEvidence(input: {
  artifact: unknown
  kind: 'screenshot' | 'dom'
  viewport?: { width?: number; height?: number }
  projectRoot?: string
}) {
  const validation = validateSubDesignArtifactManifest(input.artifact)
  if (!validation.ok) return { ok: false as const, error: `artifact manifest invalid：${validation.errors.join('；')}` }
  if (input.kind !== 'screenshot' && input.kind !== 'dom') return { ok: false as const, error: 'capture kind 不支援。' }
  try {
    const root = workspaceRootFor(input.projectRoot)
    const entryFile = artifactFile(root, validation.manifest.entry)
    const content = fs.readFileSync(entryFile, 'utf8').slice(0, 200_000)
    const width = Math.max(320, Math.min(2400, Math.floor(Number(input.viewport?.width) || 1440)))
    const height = Math.max(240, Math.min(1800, Math.floor(Number(input.viewport?.height) || 900)))
    const previewWindow = new BrowserWindow({
      show: false,
      width,
      height,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    try {
      await previewWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlDocumentForPdf(validation.manifest, content))}`)
      await previewWindow.webContents.executeJavaScript('document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true')
      await new Promise((resolve) => setTimeout(resolve, 80))
      const evidenceDir = resolveWorkspacePath(`${SUBDESIGN_EVIDENCE_ROOT}/${validation.manifest.id}/evidence`, root)
      fs.mkdirSync(evidenceDir, { recursive: true })
      const suffix = input.kind === 'screenshot' ? 'png' : 'html'
      const evidenceFile = path.join(evidenceDir, `${validation.manifest.id}-r${validation.manifest.revision}-${input.kind}.${suffix}`)
      if (input.kind === 'screenshot') {
        fs.writeFileSync(evidenceFile, (await previewWindow.webContents.capturePage()).toPNG())
      } else {
        const dom = await previewWindow.webContents.executeJavaScript('document.documentElement.outerHTML')
        fs.writeFileSync(evidenceFile, String(dom || '').slice(0, 200_000), 'utf8')
      }
      const attestation = attestSubDesignEvidence({ root, artifact: validation.manifest, kind: input.kind, file: evidenceFile, source: 'subdesign:captureEvidence' })
      return {
        ok: true as const,
        capturedAt: new Date().toISOString(),
        ...attestation,
      }
    } finally {
      if (!previewWindow.isDestroyed()) previewWindow.destroy()
    }
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 共用的 hidden preview runner：載入 artifact entry、等待 fonts ready，
 * 執行量測腳本後銷毀視窗。所有渲染型 gates 走同一條路，避免各自開窗。
 */
async function runArtifactPreviewMeasurement(
  input: { artifact: unknown; projectRoot?: string; width?: number; height?: number },
  measure: (previewWindow: BrowserWindow, context: { artifact: SubDesignArtifact; root: string; entryFile: string }) => Promise<Record<string, unknown>>,
): Promise<{ ok: true; result: Record<string, unknown>; artifact: SubDesignArtifact; entrySha256: string } | { ok: false; error: string }> {
  const validation = validateSubDesignArtifactManifest(input.artifact)
  if (!validation.ok) return { ok: false, error: `artifact manifest invalid：${validation.errors.join('；')}` }
  const previewWindow = new BrowserWindow({
    show: false,
    width: Math.max(320, Math.min(2400, Math.floor(Number(input.width) || 1440))),
    height: Math.max(240, Math.min(1800, Math.floor(Number(input.height) || 900))),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  try {
    const root = workspaceRootFor(input.projectRoot)
    const artifact = validation.manifest
    const entryFile = artifactFile(root, artifact.entry)
    const content = fs.readFileSync(entryFile, 'utf8').slice(0, 200_000)
    await previewWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlDocumentForPdf(artifact, content))}`)
    await previewWindow.webContents.executeJavaScript('document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true')
    await new Promise((resolve) => setTimeout(resolve, 80))
    const result = await measure(previewWindow, { artifact, root, entryFile })
    return { ok: true, result, artifact, entrySha256: sha256File(entryFile) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    if (!previewWindow.isDestroyed()) previewWindow.destroy()
  }
}

function writeGateEvidence(
  artifact: SubDesignArtifact,
  root: string,
  entrySha256: string,
  gateId: string,
  passed: boolean,
  summary: string,
  extra: Record<string, unknown>,
): { path: string; attestation: SubDesignEvidenceAttestation; payload: Record<string, unknown> } {
  const checkedAt = new Date().toISOString()
  const evidenceDir = resolveWorkspacePath(`${SUBDESIGN_EVIDENCE_ROOT}/${artifact.id}/evidence`, root)
  fs.mkdirSync(evidenceDir, { recursive: true })
  const evidenceFile = path.join(evidenceDir, `${artifact.id}-r${artifact.revision}-gate-${gateId}.json`)
  const payload = {
    kind: 'gate',
    gateId,
    source: `subdesign:${gateId}Gate`,
    artifactId: artifact.id,
    revision: artifact.revision,
    entrySha256,
    checkedAt,
    passed,
    summary,
    ...extra,
  }
  fs.writeFileSync(evidenceFile, JSON.stringify(payload, null, 2), 'utf8')
  const attestation = attestSubDesignEvidence({ root, artifact, kind: 'gate', file: evidenceFile, source: `subdesign:${gateId}Gate`, createdAt: checkedAt })
  return { path: path.relative(root, evidenceFile).replaceAll(path.sep, '/'), attestation, payload }
}


const CONTRAST_GATE_SOURCES: Record<string, string> = {
  contrast: 'subdesign:contrastGate',
  'console-error': 'subdesign:console-errorGate',
  'build-success': 'subdesign:build-successGate',
  'responsive-overflow': 'subdesign:responsive-overflowGate',
  'token-consistency': 'subdesign:token-consistencyGate',
}

/**
 * State-aware WCAG 對比量測：量測可見文字的 base 狀態，再從 stylesheets 抽出
 * :hover/:focus/:active 的 color 宣告，對相同元素量測該狀態下的前/背景對比。
 * 回傳 JSON 字串 { measured, violations[] }；任何單點失敗不中斷整體量測。
 */
const CONTRAST_GATE_SCRIPT = `
(() => {
  function parseColor(value) {
    const m = /rgba?\\(([^)]+)\\)/i.exec(String(value || ''))
    if (!m) return null
    const parts = m[1].split(',').map((p) => parseFloat(p))
    if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 }
  }
  function channel(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  function luminance(c) { if (!c || c.a <= 0) return null; return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b) }
  function ratio(fg, bg) {
    const l1 = luminance(fg); const l2 = luminance(bg)
    if (l1 == null || l2 == null) return null
    const hi = Math.max(l1, l2); const lo = Math.min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)
  }
  function effectiveBg(el) {
    let node = el.parentElement
    while (node) {
      const c = parseColor(getComputedStyle(node).backgroundColor)
      if (c && c.a > 0.85) return c
      node = node.parentElement
    }
    return { r: 255, g: 255, b: 255, a: 1 }
  }
  function describe(el) {
    const id = el.id ? '#' + el.id : ''
    const cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''
    return el.tagName.toLowerCase() + id + cls
  }
  function thresholdFor(style) {
    const size = parseFloat(style.fontSize) || 16
    const weight = parseInt(style.fontWeight, 10) || 400
    const large = size >= 24 || (size >= 18.66 && weight >= 700)
    return large ? 3 : 4.5
  }
  const stateRules = []
  try {
    for (const sheet of document.styleSheets) {
      let rules
      try { rules = sheet.cssRules } catch { continue }
      if (!rules) continue
      for (const rule of rules) {
        if (!rule.selectorText || !rule.style || !rule.style.color) continue
        const m = /^([^:]+):(?:hover|focus|active)\\b/i.exec(rule.selectorText)
        if (!m) continue
        const state = (/:(hover|focus|active)/i.exec(rule.selectorText) || [])[1] || 'state'
        stateRules.push({ baseSelector: m[1].trim(), state: state.toLowerCase(), color: rule.style.color })
      }
    }
  } catch {}
  const seen = new Set()
  const violations = []
  let measured = 0
  let elements = document.body ? document.body.querySelectorAll('*') : []
  for (const el of elements) {
    if (measured >= 400) break
    try {
      const hasText = Array.from(el.childNodes || []).some((n) => n.nodeType === 3 && n.textContent && n.textContent.trim())
      if (!hasText) continue
      const style = getComputedStyle(el)
      if (style.visibility === 'hidden' || style.display === 'none' || parseFloat(style.opacity) === 0) continue
      const rect = el.getBoundingClientRect()
      if (!rect.width && !rect.height) continue
      const bg = effectiveBg(el)
      const threshold = thresholdFor(style)
      const desc = describe(el)
      const fgBase = parseColor(style.color)
      if (fgBase) {
        measured++
        const r = ratio(fgBase, bg)
        const key = desc + '|base|' + style.color
        if (r != null && !seen.has(key)) {
          seen.add(key)
          if (r < threshold) violations.push({ selector: desc, state: 'base', ratio: Math.round(r * 100) / 100, threshold, sample: (el.textContent || '').trim().slice(0, 40) })
        }
      }
      for (const rule of stateRules) {
        if (measured >= 400) break
        let matches = false
        try { matches = el.matches(rule.baseSelector) } catch { continue }
        if (!matches) continue
        const fgState = parseColor(rule.color)
        if (!fgState) continue
        const key = desc + '|' + rule.state + '|' + rule.color
        if (seen.has(key)) continue
        seen.add(key)
        measured++
        const r = ratio(fgState, bg)
        if (r != null && r < threshold) violations.push({ selector: desc, state: rule.state, ratio: Math.round(r * 100) / 100, threshold, sample: (el.textContent || '').trim().slice(0, 40) })
      }
    } catch {}
  }
  return JSON.stringify({ measured, violations })
})()
`

function verifyGateEvidenceSemantics(gate: Record<string, unknown>, artifact: SubDesignArtifact, entryFile: string): void {
  if (gate.kind !== 'gate' || typeof gate.gateId !== 'string' || !gate.gateId) throw new Error('gate evidence 語意欄位不一致')
  const trustedSource = CONTRAST_GATE_SOURCES[gate.gateId]
  if (!trustedSource || gate.source !== trustedSource) throw new Error('gate evidence source 不可信')
  if (gate.artifactId !== artifact.id || Number(gate.revision) !== artifact.revision) throw new Error('gate evidence 與目前 artifact revision 不一致')
  if (gate.entrySha256 !== sha256File(entryFile)) throw new Error('gate evidence 對應的 artifact entry 已變更')
}

async function contrastGateSubDesignArtifact(input: { artifact: unknown; projectRoot?: string }) {
  const validation = validateSubDesignArtifactManifest(input.artifact)
  if (!validation.ok) return { ok: false as const, error: `artifact manifest invalid：${validation.errors.join('；')}` }
  const previewWindow = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  try {
    const root = workspaceRootFor(input.projectRoot)
    const artifact = validation.manifest
    const entryFile = artifactFile(root, artifact.entry)
    const content = fs.readFileSync(entryFile, 'utf8').slice(0, 200_000)
    await previewWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlDocumentForPdf(artifact, content))}`)
    await previewWindow.webContents.executeJavaScript('document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true')
    await new Promise((resolve) => setTimeout(resolve, 80))
    const raw = await previewWindow.webContents.executeJavaScript(CONTRAST_GATE_SCRIPT) as { measured?: unknown; violations?: unknown }
    const measured = Math.max(0, Math.floor(Number(raw?.measured) || 0))
    const violations = Array.isArray(raw?.violations)
      ? raw.violations
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
          .slice(0, 50)
          .map((item) => ({
            selector: String(item.selector || '').slice(0, 200),
            state: String(item.state || 'base').slice(0, 20),
            ratio: Number(item.ratio) || 0,
            threshold: Number(item.threshold) || 4.5,
            sample: String(item.sample || '').slice(0, 80),
          }))
      : []
    if (!measured && !violations.length) return { ok: false as const, error: '對比度 gate 沒有量測到任何可見文字。' }
    const checkedAt = new Date().toISOString()
    const passed = violations.length === 0
    const evidenceDir = resolveWorkspacePath(`${SUBDESIGN_EVIDENCE_ROOT}/${artifact.id}/evidence`, root)
    fs.mkdirSync(evidenceDir, { recursive: true })
    const evidenceFile = path.join(evidenceDir, `${artifact.id}-r${artifact.revision}-gate-contrast.json`)
    const payload = {
      kind: 'gate',
      gateId: 'contrast',
      source: 'subdesign:contrastGate',
      artifactId: artifact.id,
      revision: artifact.revision,
      entrySha256: sha256File(entryFile),
      checkedAt,
      passed,
      measured,
      violations,
      summary: passed
        ? `對比度 gate 通過：${measured} 個量測、0 個違規（含 hover/focus/active 狀態）。`
        : `對比度 gate 未通過：${violations.length} 個違規（共 ${measured} 個量測，含 hover/focus/active 狀態）。`,
    }
    fs.writeFileSync(evidenceFile, JSON.stringify(payload, null, 2), 'utf8')
    const attestation = attestSubDesignEvidence({ root, artifact, kind: 'gate', file: evidenceFile, source: 'subdesign:contrastGate', createdAt: checkedAt })
    return {
      ok: true as const,
      evidence: { summary: payload.summary, capturedAt: checkedAt, gateId: 'contrast', passed, ...attestation },
      violations,
    }
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
  } finally {
    if (!previewWindow.isDestroyed()) previewWindow.destroy()
  }
}


async function consoleErrorGateSubDesignArtifact(input: { artifact: unknown; projectRoot?: string }) {
  const validation = validateSubDesignArtifactManifest(input.artifact)
  if (!validation.ok) return { ok: false as const, error: `artifact manifest invalid：${validation.errors.join('；')}` }
  const previewWindow = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  try {
    const root = workspaceRootFor(input.projectRoot)
    const artifact = validation.manifest
    const entryFile = artifactFile(root, artifact.entry)
    const content = fs.readFileSync(entryFile, 'utf8').slice(0, 200_000)
    const errors: Array<{ message: string; line?: number }> = []
    previewWindow.webContents.on('console-message', (_event, level, message, line) => {
      if (level === 3 && errors.length < 20) errors.push({ message: String(message || '').slice(0, 300), line })
    })
    await previewWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlDocumentForPdf(artifact, content))}`)
    await new Promise((resolve) => setTimeout(resolve, 400))
    const passed = errors.length === 0
    const summary = passed
      ? 'console-error gate 通過：載入期間沒有 console error。'
      : `console-error gate 未通過：${errors.length} 個 console error。`
    const evidence = writeGateEvidence(artifact, root, sha256File(entryFile), 'console-error', passed, summary, {
      errors,
    })
    return { ok: true as const, evidence: { summary, capturedAt: evidence.attestation.createdAt, gateId: 'console-error', passed, ...evidence.attestation }, errors }
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
  } finally {
    if (!previewWindow.isDestroyed()) previewWindow.destroy()
  }
}

async function buildSuccessGateSubDesignArtifact(input: { artifact: unknown; projectRoot?: string }) {
  try {
    const root = workspaceRootFor(input.projectRoot)
    const validation = validateSubDesignArtifactManifest(input.artifact)
    if (!validation.ok) return { ok: false as const, error: `artifact manifest invalid：${validation.errors.join('；')}` }
    const artifact = validation.manifest
    const entryFile = artifactFile(root, artifact.entry)
    const content = fs.readFileSync(entryFile, 'utf8').slice(0, 500_000).trim()
    const problems: string[] = []
    if (!content) problems.push('entry 是空的。')
    const isHtmlLike = ['html', 'deck-html'].includes(artifact.renderer) || ['html', 'deck'].includes(artifact.kind)
    if (isHtmlLike && !/<\s*html[\s>]/i.test(content)) problems.push('HTML 缺少 html 根節點。')
    if (artifact.renderer === 'svg' && !/<svg[\s>]/i.test(content)) problems.push('SVG 缺少 svg 根節點。')
    const passed = problems.length === 0
    const summary = passed
      ? 'build-success gate 通過：entry 存在且結構完整。'
      : `build-success gate 未通過：${problems.join(' ')}`
    const evidence = writeGateEvidence(artifact, root, sha256File(entryFile), 'build-success', passed, summary, { problems })
    return { ok: true as const, evidence: { summary, capturedAt: evidence.attestation.createdAt, gateId: 'build-success', passed, ...evidence.attestation }, problems }
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
  }
}

const OVERFLOW_SCRIPT = `
(() => {
  const doc = document.documentElement
  const body = document.body
  const scrollWidth = Math.max(doc.scrollWidth || 0, body ? body.scrollWidth : 0)
  const innerWidth = window.innerWidth
  return JSON.stringify({ scrollWidth, innerWidth, overflow: scrollWidth > innerWidth + 1 })
})()
`

async function responsiveOverflowGateSubDesignArtifact(input: { artifact: unknown; widths?: number[]; projectRoot?: string }) {
  const widths = (input.widths && input.widths.length ? input.widths : [320, 768]).map((width) => Math.max(280, Math.min(2400, Math.floor(Number(width))))).slice(0, 4)
  const measurements: Array<{ width: number; scrollWidth: number; innerWidth: number }> = []
  for (const width of widths) {
    const run = await runArtifactPreviewMeasurement({ artifact: input.artifact, projectRoot: input.projectRoot, width, height: 900 }, async (previewWindow) => {
      const raw = await previewWindow.webContents.executeJavaScript(OVERFLOW_SCRIPT)
      return JSON.parse(String(raw || '{}')) as Record<string, unknown>
    })
    if (!run.ok) return { ok: false as const, error: run.error }
    measurements.push({
      width,
      scrollWidth: Math.floor(Number(run.result.scrollWidth) || 0),
      innerWidth: Math.floor(Number(run.result.innerWidth) || width),
    })
  }
  try {
    const root = workspaceRootFor(input.projectRoot)
    const validation = validateSubDesignArtifactManifest(input.artifact)
    if (!validation.ok) return { ok: false as const, error: `artifact manifest invalid：${validation.errors.join('；')}` }
    const violations = measurements.filter((item) => item.scrollWidth > item.innerWidth + 1)
    const passed = violations.length === 0
    const summary = passed
      ? `responsive-overflow gate 通過：${measurements.map((item) => item.width + 'px').join('/')} 無水平溢出。`
      : `responsive-overflow gate 未通過：${violations.map((item) => item.width + 'px 溢出').join('、')}。`
    const entryFile = artifactFile(root, validation.manifest.entry)
    const evidence = writeGateEvidence(validation.manifest, root, sha256File(entryFile), 'responsive-overflow', passed, summary, { measurements })
    return { ok: true as const, evidence: { summary, capturedAt: evidence.attestation.createdAt, gateId: 'responsive-overflow', passed, ...evidence.attestation }, violations }
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
  }
}

async function tokenConsistencyGateSubDesignArtifact(input: { artifact: unknown; projectRoot?: string }) {
  try {
    const root = workspaceRootFor(input.projectRoot)
    const validation = validateSubDesignArtifactManifest(input.artifact)
    if (!validation.ok) return { ok: false as const, error: `artifact manifest invalid：${validation.errors.join('；')}` }
    const artifact = validation.manifest
    const entryFile = artifactFile(root, artifact.entry)
    const content = fs.readFileSync(entryFile, 'utf8').slice(0, 500_000)
    // DTCG tokens 檔案存在時，artifact 內的 hex 色彩必須收錄於 palette；不存在則 not-applicable 通過並註記。
    let palette: string[] | null = null
    for (const candidate of ['subdesign/tokens.json', 'tokens.json']) {
      try {
        const file = artifactFile(root, candidate)
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
        const colors = Array.isArray(parsed.palette) ? parsed.palette : null
        if (colors) {
          palette = colors.map((value) => String(value).toLowerCase())
          break
        }
      } catch {}
    }
    const usedColors = [...new Set((content.match(/#[0-9a-f]{3,8}\b/gi) || []).map((value) => value.toLowerCase()))].slice(0, 60)
    const violations = palette ? usedColors.filter((color) => !palette.includes(color)) : []
    const passed = !palette || violations.length === 0
    const summary = !palette
      ? 'token-consistency gate 不適用：專案沒有 tokens.json palette；已視為通過並註記。'
      : passed
        ? `token-consistency gate 通過：${usedColors.length} 個色彩全部收錄於 palette。`
        : `token-consistency gate 未通過：${violations.length} 個色彩不在 palette（${violations.slice(0, 5).join('、')}…）。`
    const evidence = writeGateEvidence(artifact, root, sha256File(entryFile), 'token-consistency', passed, summary, {
      applicable: Boolean(palette),
      usedColors,
      violations,
    })
    return { ok: true as const, evidence: { summary, capturedAt: evidence.attestation.createdAt, gateId: 'token-consistency', passed, ...evidence.attestation }, violations }
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
  }
}

function lintSubDesignArtifact(input: { artifact: unknown; projectRoot?: string }) {
  const validation = validateSubDesignArtifactManifest(input.artifact)
  if (!validation.ok) return { ok: false as const, error: `artifact manifest invalid：${validation.errors.join('；')}` }
  try {
    const root = workspaceRootFor(input.projectRoot)
    const artifact = validation.manifest
    const entryFile = artifactFile(root, artifact.entry)
    const content = fs.readFileSync(entryFile, 'utf8').slice(0, 500_000)
    const findings: Array<{ severity: 'blocker' | 'warning' | 'note'; message: string; path?: string }> = []
    const isHtml = artifact.renderer === 'html' || artifact.renderer === 'deck-html' || artifact.kind === 'html' || artifact.kind === 'deck'
    if (isHtml) {
      if (!/<html[\s>]/i.test(content)) findings.push({ severity: 'blocker', message: 'HTML artifact 缺少 html 根節點。', path: artifact.entry })
      if (!/<head[\s>]/i.test(content)) findings.push({ severity: 'warning', message: 'HTML artifact 缺少 head。', path: artifact.entry })
      if (!/<body[\s>]/i.test(content)) findings.push({ severity: 'blocker', message: 'HTML artifact 缺少 body。', path: artifact.entry })
      if (!/<title[^>]*>[^<]+<\/title>/i.test(content)) findings.push({ severity: 'warning', message: 'HTML 缺少有意義的 title。', path: artifact.entry })
      for (const match of content.matchAll(/<img\b([^>]*)>/gi)) if (!/\balt\s*=\s*["'][^"']*["']/i.test(match[1])) findings.push({ severity: 'warning', message: 'img 缺少 alt 屬性。', path: artifact.entry })
      for (const match of content.matchAll(/<(?:button|a)\b([^>]*)>([\s\S]*?)<\/(?:button|a)>/gi)) {
        const label = `${match[1]} ${match[2]}`.replace(/<[^>]+>/g, '').trim()
        if (!label && !/aria-label\s*=\s*["'][^"']+["']/i.test(match[1])) findings.push({ severity: 'warning', message: 'button/link 缺少可讀名稱。', path: artifact.entry })
      }
    } else if (!content.trim()) {
      findings.push({ severity: 'blocker', message: 'artifact entry 是空的。', path: artifact.entry })
    }
    const checkedAt = new Date().toISOString()
    const evidenceDir = resolveWorkspacePath(`${SUBDESIGN_EVIDENCE_ROOT}/${artifact.id}/evidence`, root)
    fs.mkdirSync(evidenceDir, { recursive: true })
    const evidenceFile = path.join(evidenceDir, `${artifact.id}-r${artifact.revision}-lint.json`)
    const payload = { kind: 'lint', source: 'subdesign:lintArtifact', artifactId: artifact.id, revision: artifact.revision, entry: artifact.entry, entrySha256: sha256File(entryFile), checkedAt, findings, summary: findings.length ? `語意 lint 發現 ${findings.length} 個問題。` : '語意 lint 通過基本結構與可及性檢查。' }
    fs.writeFileSync(evidenceFile, JSON.stringify(payload, null, 2), 'utf8')
    const attestation = attestSubDesignEvidence({ root, artifact, kind: 'lint', file: evidenceFile, source: 'subdesign:lintArtifact', createdAt: checkedAt })
    return { ok: true as const, evidence: { summary: payload.summary, capturedAt: checkedAt, ...attestation }, findings }
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
  }
}

function imageReferenceInfo(bytes: Buffer): { extension: 'png' | 'jpg' | 'webp'; dimensions?: string } | null {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR') {
    return { extension: 'png', dimensions: `${bytes.readUInt32BE(16)} × ${bytes.readUInt32BE(20)}` }
  }
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return { extension: 'webp' }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return { extension: 'jpg' }
  return null
}

function referenceTokens(html: string): { colors: string[]; fonts: string[]; spacing: string[]; radii: string[]; headings: string[] } {
  const unique = (values: string[], limit: number) => [...new Set(values.map((item) => item.trim()).filter(Boolean))].slice(0, limit)
  return {
    colors: unique(html.match(/(?:#[0-9a-f]{3,8}\b|rgba?\([^)]{3,100}\)|hsla?\([^)]{3,100}\))/gi) || [], 16),
    fonts: unique([...html.matchAll(/font-family\s*:\s*([^;}{]+)/gi)].map((match) => match[1]), 10),
    spacing: unique([...html.matchAll(/(?:padding|margin|gap|space-[xy])\s*:\s*([^;}{]+)/gi)].map((match) => match[1]), 12),
    radii: unique([...html.matchAll(/border-radius\s*:\s*([^;}{]+)/gi)].map((match) => match[1]), 10),
    headings: unique([...html.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)].map((match) => match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()), 12),
  }
}

function safeReferenceId(value: string): string {
  const id = value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  if (!id) throw new Error('reference id 無法建立')
  return id
}

function isPrivateReferenceHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true
  const octets = host.split('.').map(Number)
  if (octets.length !== 4 || octets.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) return false
  return octets[0] === 0 || octets[0] === 10 || octets[0] === 127 || (octets[0] === 169 && octets[1] === 254) || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
}

async function importSubDesignReference(input: { briefId?: string; kind?: 'screenshot' | 'url'; source?: string; suggestedTitle?: string; projectRoot?: string }) {
  try {
    const root = workspaceRootFor(input.projectRoot)
    const briefId = safeSubDesignMetadataId(input.briefId)
    const kind = input.kind
    const source = String(input.source || '').trim()
    if (kind !== 'screenshot' && kind !== 'url') throw new Error('reference kind 只支援 screenshot 或 url')
    if (!source || source.length > 4_000) throw new Error('reference source 不合法')
    const briefFile = subDesignMetadataFile(root, 'brief', { id: briefId })
    if (!fs.existsSync(briefFile)) throw new Error('找不到 canonical brief，請先建立 SubDesign brief。')
    let bytes: Buffer
    let storedSource = source
    let title = String(input.suggestedTitle || '').trim().slice(0, 240)
    let analysis = ''
    let visualNote = ''
    if (kind === 'screenshot') {
      if (source.startsWith('data:image/')) {
        const match = source.match(/^data:image\/(png|jpeg|jpg|webp);base64,([a-zA-Z0-9+/=]+)$/)
        if (!match) throw new Error('screenshot data URL 只支援 PNG/JPEG/WebP base64')
        bytes = Buffer.from(match[2], 'base64')
        storedSource = 'data:image/' + match[1]
      } else {
        const file = artifactFile(root, source.replaceAll('\\', '/'))
        bytes = fs.readFileSync(file)
      }
      const image = imageReferenceInfo(bytes)
      if (!image) throw new Error('screenshot 必須是有效 PNG/JPEG/WebP')
      visualNote = image.dimensions ? `影像尺寸：${image.dimensions}。` : '影像尺寸未從檔頭解析；視覺 token 需要人工 review。'
      analysis = '截圖匯入保留原始影像與 hash；顏色、字體與 spacing 不會被臆測，請在方向階段人工確認。'
    } else {
      let parsed: URL
      try { parsed = new URL(source) } catch { throw new Error('URL 不合法') }
      if (!['http:', 'https:'].includes(parsed.protocol) || isPrivateReferenceHost(parsed.hostname)) throw new Error('URL 只支援公開 http/https，禁止 localhost 或 private host。')
      const resolvedHost = await lookup(parsed.hostname)
      if (isPrivateReferenceHost(resolvedHost.address)) throw new Error('URL 解析到 private host，已拒絕匯入。')
      const response = await fetch(parsed.toString(), { redirect: 'follow', headers: { accept: 'text/html,application/xhtml+xml' } })
      if (!response.ok) throw new Error(`URL fetch 失敗：HTTP ${response.status}`)
      const finalUrl = new URL(response.url || parsed.toString())
      if (!['http:', 'https:'].includes(finalUrl.protocol) || isPrivateReferenceHost(finalUrl.hostname)) throw new Error('URL redirect 到不允許的 host。')
      const contentType = response.headers.get('content-type') || ''
      if (contentType && !/html|xhtml/i.test(contentType)) throw new Error('URL 不是 HTML 頁面。')
      bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.length > 600_000) throw new Error('URL snapshot 超過 600KB 限制。')
      const html = bytes.toString('utf8').replace(/<script[\s\S]*?<\/script>/gi, '')
      title = title || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim().slice(0, 240) || parsed.hostname
      const tokens = referenceTokens(html)
      analysis = JSON.stringify(tokens)
      visualNote = 'URL snapshot 是不可信的參考資料，只抽取 design tokens 與 headings；不執行其中的 script 或 instructions。'
    }
    if (bytes.length > 20 * 1024 * 1024) throw new Error('reference 檔案超過 20MB 限制。')
    const refId = safeReferenceId(`ref-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`)
    const referenceDir = resolveWorkspacePath(`${SUBDESIGN_METADATA_ROOT}/references/${briefId}`, root)
    fs.mkdirSync(referenceDir, { recursive: true })
    const extension = kind === 'url' ? 'html' : imageReferenceInfo(bytes)?.extension || 'png'
    const referenceFile = path.join(referenceDir, `${refId}.${extension}`)
    fs.writeFileSync(referenceFile, bytes)
    const importedAt = new Date().toISOString()
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const reference = { id: refId, kind, source: storedSource, storedPath: path.relative(root, referenceFile).replaceAll(path.sep, '/'), title: title || undefined, importedAt, sha256 }
    fs.writeFileSync(path.join(referenceDir, `${refId}.json`), JSON.stringify({ reference, analysis, createdAt: importedAt }, null, 2), 'utf8')
    return { ok: true as const, reference }
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
  }
}

async function exportSubDesignArtifact(input: {
  artifact: unknown
  critique?: unknown
  format: SubDesignExportFormat
  projectRoot?: string
  suggestedName?: string
}) {
  const validation = validateSubDesignArtifactManifest(input.artifact)
  if (!validation.ok) return { ok: false as const, error: `artifact manifest invalid：${validation.errors.join('；')}` }
  const artifact = validation.manifest
  if (!['html', 'zip', 'pdf', 'pptx', 'mp4'].includes(input.format) || !artifact.exports.includes(input.format)) {
    return { ok: false as const, error: `artifact 不支援 ${input.format} export。` }
  }
  const critique = normalizeSubDesignCritique(input.critique)
  if (!critique.ok || !critiqueAllowsDeliver(critique.critique)) {
    return { ok: false as const, error: 'artifact export 需要通過 critique。' }
  }
  try {
    const root = workspaceRootFor(input.projectRoot)
    const evidenceCheck = verifySubDesignEvidence({ artifact, evidence: critique.critique.evidence, projectRoot: input.projectRoot })
    if (!evidenceCheck.ok) return { ok: false as const, error: `Evidence 未通過驗證：${evidenceCheck.errors.join('；')}` }
    const entryFile = artifactFile(root, artifact.entry)
    const related = [...new Set([artifact.entry, ...artifact.supportingFiles])]
    if (related.length > SUBDESIGN_MAX_EXPORT_FILES) throw new Error('export file count exceeds limit')
    const files = related.map((relativePath) => {
      const file = artifactFile(root, relativePath)
      const data = fs.readFileSync(file)
      return { name: relativePath, data }
    })
    const totalBytes = files.reduce((sum, file) => sum + file.data.length, 0)
    if (totalBytes > SUBDESIGN_MAX_EXPORT_BYTES) throw new Error('export exceeds 50MB limit')
    const extension = input.format === 'zip' ? 'zip' : input.format
    const defaultPath = path.join(app.getPath('downloads'), `${safeSubDesignExportName(input.suggestedName || artifact.title)}-r${artifact.revision}.${extension}`)
    const filters = input.format === 'pdf'
      ? [{ name: 'PDF', extensions: ['pdf'] }]
      : input.format === 'zip'
        ? [{ name: 'ZIP', extensions: ['zip'] }]
        : input.format === 'pptx'
          ? [{ name: 'PowerPoint', extensions: ['pptx'] }]
          : input.format === 'mp4'
            ? [{ name: 'MP4 video', extensions: ['mp4'] }]
            : [{ name: 'HTML', extensions: ['html'] }]
    const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getFocusedWindow()
    const saveOptions = { title: `Export ${artifact.title}`, defaultPath, filters }
    const save = parent
      ? await dialog.showSaveDialog(parent, saveOptions)
      : await dialog.showSaveDialog(saveOptions)
    if (save.canceled || !save.filePath) return { ok: false as const, cancelled: true as const }

    let output: Buffer
    if (input.format === 'html') {
      output = fs.readFileSync(entryFile)
    } else if (input.format === 'zip') {
      output = createStoredZip([
        { name: 'artifact-manifest.json', data: Buffer.from(JSON.stringify(artifact, null, 2), 'utf8') },
        ...files,
      ])
    } else if (input.format === 'pptx') {
      const content = fs.readFileSync(entryFile, 'utf8').slice(0, 200_000)
      output = createStoredZip(buildPptxFiles(artifact, content))
    } else if (input.format === 'mp4') {
      const content = fs.readFileSync(entryFile, 'utf8').slice(0, 200_000)
      const video = await exportSubDesignMp4(artifact, content)
      if (!video.ok || !video.output) throw new Error(video.error || 'MP4 export 失敗。')
      output = video.output
    } else {
      const previewWindow = new BrowserWindow({
        show: false,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
      })
      try {
        const content = fs.readFileSync(entryFile, 'utf8').slice(0, 200_000)
        await previewWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlDocumentForPdf(artifact, content))}`)
        output = await previewWindow.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true })
      } finally {
        if (!previewWindow.isDestroyed()) previewWindow.destroy()
      }
    }
    fs.writeFileSync(save.filePath, output)
    return {
      ok: true as const,
      path: save.filePath,
      bytes: output.length,
      sha256: createHash('sha256').update(output).digest('hex'),
      artifactId: artifact.id,
      revision: artifact.revision,
      format: input.format,
    }
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
  }
}

ipcMain.handle('subdesign:listArtifacts', async (_evt, projectRoot?: string) => {
  try {
    const root = workspaceRootFor(projectRoot)
    return { ok: true, artifacts: readStoredSubDesignArtifacts(root) }
  } catch (error) {
    return { ok: false, artifacts: [], error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('subdesign:readMetadata', async (_evt, projectRoot?: string) => {
  try {
    const root = workspaceRootFor(projectRoot)
    return {
      ok: true,
      briefs: readJsonDirectory(root, `${SUBDESIGN_METADATA_ROOT}/briefs`, 80),
      artifacts: readStoredSubDesignArtifacts(root),
      critiques: readJsonDirectory(root, `${SUBDESIGN_METADATA_ROOT}/critiques`, 160),
      exports: readJsonDirectory(root, `${SUBDESIGN_METADATA_ROOT}/exports`, 160),
      openDesignPacks: readJsonDirectory(root, `${SUBDESIGN_METADATA_ROOT}/open-design-packs`, 500),
      openDesignSnapshots: readJsonDirectory(root, '.subagents/open-design/snapshots', 500),
      openDesignProviderSettings: readJsonDirectory(root, `${SUBDESIGN_METADATA_ROOT}/providers`, 40),
      openDesignProviderRuns: readJsonDirectory(root, `${SUBDESIGN_METADATA_ROOT}/provider-runs`, 160),
    }
  } catch (error) {
    return { ok: false, briefs: [], artifacts: [], critiques: [], exports: [], openDesignPacks: [], openDesignSnapshots: [], openDesignProviderSettings: [], openDesignProviderRuns: [], error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('subdesign:writeMetadata', async (_evt, input: { kind?: string; payload?: unknown; projectRoot?: string }) => {
  try {
    const kind = input?.kind
    if (!isSubDesignMetadataKind(kind)) throw new Error('不支援的 SubDesign metadata kind')
    if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) throw new Error('metadata payload 必須是 object')
    const payload = input.payload as Record<string, unknown>
    if (kind === 'artifact') {
      const validation = validateSubDesignArtifactManifest(payload)
      if (!validation.ok) throw new Error(`artifact manifest invalid：${validation.errors.join('；')}`)
    }
    const content = JSON.stringify(payload, null, 2)
    if (Buffer.byteLength(content, 'utf8') > SUBDESIGN_MAX_METADATA_BYTES) throw new Error('metadata exceeds 2MB limit')
    const root = workspaceRootFor(input.projectRoot)
    const file = subDesignMetadataFile(root, kind, payload)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content, 'utf8')
    return { ok: true, path: path.relative(root, file).replaceAll(path.sep, '/'), bytes: Buffer.byteLength(content, 'utf8') }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('subdesign:readArtifact', async (_evt, input: { entry?: string; projectRoot?: string }) => {
  try {
    const root = workspaceRootFor(input?.projectRoot)
    const file = artifactFile(root, String(input?.entry || ''))
    return { ok: true, content: fs.readFileSync(file, 'utf8').slice(0, 200_000) }
  } catch (error) {
    return { ok: false, content: '', error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('subdesign:revealProviderAttachment', async (_evt, input: { locator?: string; projectRoot?: string }) => {
  try {
    const root = workspaceRootFor(input?.projectRoot)
    const locator = String(input?.locator || '').trim().replaceAll('\\', '/')
    if (!/^\.subagents\/open-design\/runs\/[a-zA-Z0-9._:@-]+\/[a-zA-Z0-9._:@-]+\/attachments\/(?:screenshot|trace|harness-replay|harness-step-[0-9]{3})\.(?:png|json)$/.test(locator)) {
      throw new Error('不安全的 provider attachment locator')
    }
    const file = resolveWorkspacePath(locator, root)
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('找不到 provider attachment')
    shell.showItemInFolder(file)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('subdesign:patchArtifact', async (_evt, input: Parameters<typeof patchSubDesignArtifact>[0]) => {
  try {
    return patchSubDesignArtifact(input)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('subdesign:preparePinnedPatchScope', async (_evt, input: Parameters<typeof preparePinnedPatchScope>[0]) => {
  try {
    return preparePinnedPatchScope(input)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('subdesign:mcpAppToolCall', async (_evt, input: {
  coordinate?: unknown
  allowlist?: unknown
  arguments?: unknown
  runId?: unknown
  threadId?: unknown
  projectRoot?: unknown
}) => {
  try {
    const coordinate = String(input?.coordinate || '')
    const parsed = parseMcpToolCoordinate(coordinate)
    const allowlist = Array.isArray(input?.allowlist) ? input.allowlist.map(String) : []
    if (!parsed || !allowlist.includes(coordinate)) return { ok: false, error: 'MCP App tool 不在 surface allowlist。' }
    const args = input.arguments && typeof input.arguments === 'object' && !Array.isArray(input.arguments)
      ? input.arguments as Record<string, unknown>
      : {}
    const content = await piHostSupervisor.callPackTool('mcp_call', {
      extensionId: parsed.extensionId,
      toolName: parsed.toolName,
      arguments: args,
    }, {
      cwd: workspaceRootFor(typeof input.projectRoot === 'string' ? input.projectRoot : undefined),
      ...(typeof input.runId === 'string' ? { runId: input.runId, callId: `mcp-app:${input.runId}:${coordinate}` } : {}),
      approval: 'allow',
    })
    return { ok: true, content }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('subdesign:applyTweak', async (_evt, input: Parameters<typeof applySubDesignArtifactTweak>[0]) => {
  try {
    return applySubDesignArtifactTweak(input)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('subdesign:verifyEvidence', async (_evt, input: Parameters<typeof verifySubDesignEvidence>[0]) => {
  try {
    return verifySubDesignEvidence(input)
  } catch (error) {
    return { ok: false, validKinds: [], errors: [error instanceof Error ? error.message : String(error)] }
  }
})

ipcMain.handle('subdesign:captureEvidence', async (_evt, input: Parameters<typeof captureSubDesignEvidence>[0]) => {
  return captureSubDesignEvidence(input)
})

ipcMain.handle('subdesign:lintEvidence', async (_evt, input: Parameters<typeof lintSubDesignArtifact>[0]) => {
  return lintSubDesignArtifact(input)
})

ipcMain.handle('subdesign:contrastGate', async (_evt, input: Parameters<typeof contrastGateSubDesignArtifact>[0]) => {
  return contrastGateSubDesignArtifact(input)
})

ipcMain.handle('subdesign:consoleErrorGate', async (_evt, input: Parameters<typeof consoleErrorGateSubDesignArtifact>[0]) => {
  return consoleErrorGateSubDesignArtifact(input)
})

ipcMain.handle('subdesign:buildSuccessGate', async (_evt, input: Parameters<typeof buildSuccessGateSubDesignArtifact>[0]) => {
  return buildSuccessGateSubDesignArtifact(input)
})

ipcMain.handle('subdesign:responsiveOverflowGate', async (_evt, input: Parameters<typeof responsiveOverflowGateSubDesignArtifact>[0]) => {
  return responsiveOverflowGateSubDesignArtifact(input)
})

ipcMain.handle('subdesign:tokenConsistencyGate', async (_evt, input: Parameters<typeof tokenConsistencyGateSubDesignArtifact>[0]) => {
  return tokenConsistencyGateSubDesignArtifact(input)
})

ipcMain.handle('subdesign:importReference', async (_evt, input: Parameters<typeof importSubDesignReference>[0]) => {
  return importSubDesignReference(input)
})

ipcMain.handle('subdesign:exportCapabilities', async () => {
  const ffmpeg = await runFfmpeg(['-version'])
  return { ok: true, pptx: true, mp4: ffmpeg.ok, mp4Error: ffmpeg.ok ? undefined : ffmpeg.error }
})

ipcMain.handle('subdesign:copyVendorPack', async (_evt, input: Parameters<typeof copyOpenDesignVendorPack>[0]) => {
  try {
    return copyOpenDesignVendorPack(input)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('subdesign:exportArtifact', async (_evt, input: Parameters<typeof exportSubDesignArtifact>[0]) => {
  return exportSubDesignArtifact(input)
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
  // Read-only: never mkdir missing paths (trust-03). Explicit create → workspace_mkdir.
  const { listWorkspaceDirectory } = await import('./workspaceFs')
  return listWorkspaceDirectory(dir, relPath, {
    projectRoot: projectRoot || activeProjectRoot,
  })
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

ipcMain.handle('tools:workspaceGrep', async (_evt, input: unknown, projectRoot?: unknown) => {
  try {
    const value = input && typeof input === 'object' ? input as { query?: string; path?: string; glob?: string; maxResults?: number } : {}
    const root = workspaceRootFor(projectRoot)
    const baseDir = resolveWorkspacePath(String(value.path || '.'), root)
    if (!fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()) {
      return { ok: false, root, matches: [], files: [], truncated: false, error: `Not a directory: ${value.path || '.'}` }
    }
    const { grepWorkspaceFiles } = await import('./workspaceFs')
    return grepWorkspaceFiles(root, String(value.query || ''), {
      baseDir,
      glob: value.glob,
      maxResults: value.maxResults,
    })
  } catch (error) {
    return { ok: false, root: workspaceRoot(), matches: [], files: [], truncated: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('tools:workspaceGlob', async (_evt, input: unknown, projectRoot?: unknown) => {
  try {
    const value = input && typeof input === 'object' ? input as { pattern?: string; path?: string; maxResults?: number } : {}
    const root = workspaceRootFor(projectRoot)
    const baseDir = resolveWorkspacePath(String(value.path || '.'), root)
    if (!fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()) {
      return { ok: false, root, matches: [], files: [], truncated: false, error: `Not a directory: ${value.path || '.'}` }
    }
    const { globWorkspaceFiles } = await import('./workspaceFs')
    return globWorkspaceFiles(root, String(value.pattern || ''), {
      baseDir,
      maxResults: value.maxResults,
    })
  } catch (error) {
    return { ok: false, root: workspaceRoot(), matches: [], files: [], truncated: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('learning:export', async (_evt, input: unknown) => {
  try {
    const value = input && typeof input === 'object' ? input as {
      relativePath?: string
      content?: string
      projectRoot?: string
      overwrite?: boolean
    } : {}
    // Confinement (traversal / absolute / symlink) lives in the writer so it
    // is covered by smoke-learning-export.mts rather than only by review.
    return writeLearningExport(value, workspaceRootFor)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
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

// ── Rewind 檔案快照(G5,grok rewind_points 輕量版)──────────────

const rewindBaseDir = () => path.join(app.getPath('userData'), 'rewind')

ipcMain.handle(
  'rewind:record',
  (
    _evt,
    payload: {
      threadId: string
      runId?: string
      kind: 'write' | 'delete' | 'move'
      relPath: string
      toPath?: string
      before: string | null
      after?: string | null
    },
  ) =>
    recordRewindEntry(rewindBaseDir(), {
      threadId: String(payload?.threadId || ''),
      runId: payload?.runId,
      kind: payload?.kind || 'write',
      relPath: String(payload?.relPath || ''),
      toPath: payload?.toPath,
      before: payload?.before ?? null,
      afterSha1: payload?.after == null ? null : rewindSha1(String(payload.after)),
    }),
)

ipcMain.handle('rewind:list', (_evt, threadId: string) =>
  listRewindEntries(rewindBaseDir(), String(threadId || '')),
)

ipcMain.handle(
  'rewind:restore',
  (_evt, threadId: string, toEntryId: string, projectRoot?: string, force?: boolean) =>
    restoreRewindEntries(
      rewindBaseDir(),
      String(threadId || ''),
      String(toEntryId || ''),
      (rel) => resolveWorkspacePath(rel, projectRoot),
      { force: force === true },
    ),
)

ipcMain.handle('rewind:clear', (_evt, threadId: string) =>
  clearRewindEntries(rewindBaseDir(), String(threadId || '')),
)

// ── Outbound Data Gate (policy / evidence / sanitized views) ──
ipcMain.handle('outbound:status', (_evt, opts?: { apiProvider?: string; baseUrl?: string }) =>
  getOutboundStatus(opts || {}),
)
ipcMain.handle('outbound:ensurePolicy', async (_evt, connectionId: string) =>
  ensureOutboundPolicy(String(connectionId || '')),
)
ipcMain.handle(
  'outbound:prepareRunView',
  async (
    _evt,
    opts: {
      runId: string
      projectRoot: string
      apiProvider?: string
      baseUrl?: string
      connectionId?: string
    },
  ) => prepareOutboundRunView(opts || ({} as never)),
)
ipcMain.handle(
  'outbound:disposeRunView',
  async (_evt, runId: string, opts?: { writeback?: boolean }) =>
    disposeOutboundRunView(String(runId || ''), opts || {}),
)
ipcMain.handle('outbound:viewRoot', (_evt, runId: string) =>
  getOutboundRunViewRoot(String(runId || '')),
)
ipcMain.handle('outbound:viewMeta', (_evt, runId: string) =>
  getOutboundRunViewMeta(String(runId || '')),
)
ipcMain.handle('outbound:runEvidence', (_evt, runId: string) =>
  readOutboundRunEvidence(String(runId || '')),
)
ipcMain.handle(
  'outbound:appendEvidence',
  async (
    _evt,
    input: {
      eventType: string
      runId?: string
      providerId?: string
      effectiveGuardMode?: string
      policySource?: string
      policyVersion?: string
      action?: string
      exclusions?: Array<{ source: string; startLine: number; endLine: number }>
    },
    sealed?: boolean,
  ) =>
    appendOutboundEvidence(input as never, {
      sealed: sealed == null ? undefined : Boolean(sealed),
      fromIpc: true,
    }),
)
ipcMain.handle(
  'outbound:sandboxProbe',
  (
    _evt,
    opts: { viewRoot: string; forbiddenCanaryPath: string },
  ) =>
    verifyCliFilesystemSandbox({
      viewRoot: String(opts?.viewRoot || ''),
      forbiddenCanaryPath: String(opts?.forbiddenCanaryPath || ''),
    }),
)
ipcMain.handle('outbound:policyListActive', () => listActivePolicies())
ipcMain.handle('outbound:policyListDrafts', () => listPolicyDrafts())
ipcMain.handle('outbound:policyReadDraft', (_evt, draftId: string) =>
  readPolicyDraft(String(draftId || '')),
)
ipcMain.handle(
  'outbound:policySaveDraft',
  (
    _evt,
    input: {
      id: string
      kind: 'company-base' | 'provider-supplement'
      connectionId?: string
      body: unknown
    },
  ) => savePolicyDraft(input || ({} as never)),
)
ipcMain.handle('outbound:policyActivateDraft', (_evt, draftId: string) =>
  activatePolicyDraft({ draftId: String(draftId || '') }),
)
ipcMain.handle(
  'outbound:policyRollback',
  (
    _evt,
    input: {
      kind: 'company-base' | 'provider-supplement'
      connectionId?: string
      reason: string
      targetBody?: unknown
    },
  ) => rollbackActivePolicy(input || ({} as never)),
)
ipcMain.handle(
  'outbound:policySeedDraft',
  (
    _evt,
    input: {
      kind: 'company-base' | 'provider-supplement'
      connectionId?: string
      draftId: string
    },
  ) => seedDraftFromActive(input || ({} as never)),
)


// ── Monitor 事件流(G10)──────────────────────────────────────────

const emitMonitor: MonitorEmit = (channel, payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

ipcMain.handle(
  'monitor:start',
  (_evt, input: { command: string; description: string; cwd?: string }) =>
    startMonitor(
      {
        command: String(input?.command || ''),
        description: String(input?.description || ''),
        cwd: input?.cwd ? String(input.cwd) : undefined,
      },
      emitMonitor,
    ),
)
ipcMain.handle('monitor:stop', (_evt, id: string) => stopMonitor(String(id || ''), emitMonitor))
ipcMain.handle('monitor:list', () => listMonitors())
app.on('before-quit', () => stopAllMonitors(emitMonitor))

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
      allowPlaintext?: boolean
    },
  ) => {
    if (!input?.id || !input?.token?.trim()) {
      return { ok: false as const, error: 'id 與 token 必填' }
    }
    try {
      const meta = setVaultSecret(input.id, input.token, input)
      return { ok: true as const, meta }
    } catch (e) {
      const err = e as Error & { code?: string }
      return { ok: false as const, error: err.message, code: err.code }
    }
  },
)

ipcMain.handle('secrets:clear', async (_evt, id: string) => {
  clearVaultSecret(String(id || ''))
  return { ok: true }
})

ipcMain.handle(
  'secrets:migrate',
  async (_evt, map: Record<string, { token: string; refreshToken?: string; expiresAt?: number; tokenType?: string; updatedAt?: string }>) => {
    // 無 OS 鑰匙圈：拒絕把 legacy 明文轉寫成新明文檔；renderer 需保留 localStorage
    if (Object.keys(map || {}).length && !isVaultEncryptionAvailable()) {
      return { ok: false, imported: 0, error: 'OS 安全儲存不可用，暫不匯入 legacy 憑證' }
    }
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
