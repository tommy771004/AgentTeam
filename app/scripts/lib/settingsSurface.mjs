/**
 * 設定畫面的完整渲染面：設定頁本體 + settings 元件與 panel。
 *
 * 設定頁在 spec 3/6 拆成 registry 驅動的 panel 之後，只讀 `SettingsPage.tsx` 的
 * 契約檢查會因為內容搬家而假性失敗——那些檢查要驗的是「這個 UI 還在不在」，
 * 不是「它住在哪一個檔案」。共用這支 helper，下次再拆檔也不會再壞一次。
 */
import fs from 'node:fs'
import path from 'node:path'

const SURFACE_DIRS = ['src/components/settings', 'src/components/settings/panels']

export function settingsSurfaceFiles(appRoot) {
  const files = [path.join(appRoot, 'src/pages/SettingsPage.tsx')]
  for (const dir of SURFACE_DIRS) {
    const abs = path.join(appRoot, dir)
    if (!fs.existsSync(abs)) continue
    for (const name of fs.readdirSync(abs)) {
      if (name.endsWith('.tsx') && !name.endsWith('.test.tsx')) files.push(path.join(abs, name))
    }
  }
  return files
}

/** 全部串成一份字串，供既有的 regex 契約檢查沿用。 */
export function readSettingsSurface(appRoot) {
  return settingsSurfaceFiles(appRoot)
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n')
}
