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

/**
 * 語言檔也是設定畫面的一部分。
 *
 * spec 6/6 把面板字串抽進 `t(key)` 之後，文案本體住在語言檔裡；只讀元件原始碼的
 * 契約檢查會找不到那些字，但那個 UI 明明還在。把 zh-TW 檔一起納入，讓「這段文案
 * 還在不在」的檢查繼續有效，而不是被迫改寫成比對 key。
 */
const CATALOG_FILES = ['src/i18n/locales/zh-TW.ts']

export function settingsSurfaceFiles(appRoot) {
  const files = [path.join(appRoot, 'src/pages/SettingsPage.tsx')]
  for (const rel of CATALOG_FILES) {
    const abs = path.join(appRoot, rel)
    if (fs.existsSync(abs)) files.push(abs)
  }
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
