/**
 * Minimal Electron stub for plugin-installer E2E under plain Node.
 * Vite aliases `electron` → this file so secretsVault / bridges do not
 * hit the real CommonJS electron package (named-export ESM break).
 */
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

const userData = path.join(os.tmpdir(), 'subagents-plugin-e2e-userdata')
try {
  fs.mkdirSync(userData, { recursive: true })
} catch {
  /* already exists */
}

export const app = {
  getPath(name) {
    if (name === 'userData') return userData
    if (name === 'temp') return os.tmpdir()
    return os.tmpdir()
  },
  getName: () => 'SubAgents AI E2E',
  getVersion: () => '0.0.0-e2e',
  isReady: () => true,
  whenReady: () => Promise.resolve(),
}

export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s) => Buffer.from(String(s), 'utf8'),
  decryptString: (b) => Buffer.from(b).toString('utf8'),
}

export const shell = {
  openExternal: async () => undefined,
}

export const dialog = {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
}

export const BrowserWindow = class BrowserWindow {
  constructor() {
    this.webContents = { send: () => undefined }
  }
  static getAllWindows() {
    return []
  }
}

export const ipcMain = {
  handle: () => undefined,
  on: () => undefined,
  removeHandler: () => undefined,
}

export const contextBridge = { exposeInMainWorld: () => undefined }
export const ipcRenderer = {
  invoke: async () => undefined,
  on: () => undefined,
  send: () => undefined,
}

export default {
  app,
  safeStorage,
  shell,
  dialog,
  BrowserWindow,
  ipcMain,
  contextBridge,
  ipcRenderer,
}
