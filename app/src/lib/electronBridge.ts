/**
 * Electron preload bridge diagnostics.
 * When preload fails to load (e.g. ESM .mjs + require), window.subagents is missing
 * and almost every desktop feature silently no-ops.
 */

export type ElectronBridgeStatus = {
  /** navigator reports Electron shell */
  inElectronShell: boolean
  /** contextBridge exposed window.subagents */
  bridgeReady: boolean
  /** native folder picker available */
  hasProjectPick: boolean
  /** short status label (zh) */
  label: string
  /** user-facing detail when unhealthy */
  detail: string | null
}

export function getElectronBridgeStatus(): ElectronBridgeStatus {
  const inElectronShell =
    typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent)

  const api = typeof window !== 'undefined' ? window.subagents : undefined
  const bridgeReady = Boolean(api)
  const hasProjectPick = Boolean(api?.project?.pick)

  if (bridgeReady && hasProjectPick) {
    return {
      inElectronShell: true,
      bridgeReady: true,
      hasProjectPick: true,
      label: 'Electron 橋接正常',
      detail: null,
    }
  }

  if (bridgeReady && !hasProjectPick) {
    return {
      inElectronShell: inElectronShell || true,
      bridgeReady: true,
      hasProjectPick: false,
      label: '橋接部分可用',
      detail: 'window.subagents 已注入，但缺少 project.pick，請重啟應用',
    }
  }

  if (inElectronShell) {
    return {
      inElectronShell: true,
      bridgeReady: false,
      hasProjectPick: false,
      label: 'preload 失敗',
      detail:
        'Electron 視窗內沒有 window.subagents（preload 未載入）。選檔、終端、CLI、MCP、排程 IPC 都會失效。請重啟 npm run dev，並檢查主進程 [preload-error] 日誌。',
    }
  }

  return {
    inElectronShell: false,
    bridgeReady: false,
    hasProjectPick: false,
    label: '瀏覽器預覽',
    detail:
      '目前是瀏覽器分頁，沒有桌面 API。請使用 npm run dev 開出的 Electron 視窗（不要只開 localhost:5173）。',
  }
}

export function isElectronBridgeReady(): boolean {
  return Boolean(window.subagents)
}
