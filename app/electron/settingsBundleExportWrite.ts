import fs from 'node:fs'
import path from 'node:path'

export const MAX_SETTINGS_BUNDLE_EXPORT_BYTES = 16 * 1024 * 1024

export type SettingsBundleExportWriteResult =
  | { ok: true; path: string; bytes: number }
  | { ok: false; error: string }

/** Write only to the exact JSON path approved by Electron's save dialog. */
export function writeSettingsBundleExport(
  filePath: string,
  content: string,
): SettingsBundleExportWriteResult {
  if (!path.isAbsolute(filePath) || path.extname(filePath).toLowerCase() !== '.json') {
    return { ok: false, error: '設定匯出目的地必須是明確選定的絕對 JSON 路徑。' }
  }
  if (fs.existsSync(filePath) && fs.lstatSync(filePath).isSymbolicLink()) {
    return { ok: false, error: '設定匯出不會覆寫 symlink。' }
  }
  const bytes = Buffer.byteLength(content, 'utf8')
  if (bytes > MAX_SETTINGS_BUNDLE_EXPORT_BYTES) {
    return { ok: false, error: `設定匯出超過 ${MAX_SETTINGS_BUNDLE_EXPORT_BYTES} bytes 大小上限。` }
  }
  fs.writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o600 })
  if (process.platform !== 'win32') fs.chmodSync(filePath, 0o600)
  return { ok: true, path: filePath, bytes }
}
