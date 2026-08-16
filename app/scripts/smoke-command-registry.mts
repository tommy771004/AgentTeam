/**
 * first-run-honesty ticket 09 — command registry 共用化 smoke。
 *
 * 驗證：條目 id（name+aliases）唯一；navigate 條目的路由存在於 App 路由表；
 * settings 條目與設定節單一真相同步（policyAdmin 排除）；fuzzy 與過濾行為。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PAGE_NAV_ENTRIES,
  commandEntryPath,
  filterCommandEntries,
  fuzzyMatch,
  getAllCommandEntries,
  getLiveSlashCommands,
} from '../src/commands/registry.ts'
import { SETTINGS_SECTIONS, paletteSettingsSections } from '../src/commands/settingsSections.ts'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ── 1. 條目唯一性：name 與 aliases 不重複 ──
{
  const entries = getAllCommandEntries()
  assert.ok(entries.length > 40, `統一條目應涵蓋 slash+導航+設定（實得 ${entries.length}）`)
  const seen = new Set<string>()
  for (const entry of entries) {
    for (const token of [entry.name, ...(entry.aliases || [])]) {
      assert.ok(!seen.has(token), `條目 id 重複：${token}`)
      seen.add(token)
    }
  }
}

// ── 2. navigate 條目的路由存在於 App 路由表 ──
{
  const appSrc = fs.readFileSync(path.join(appRoot, 'src/App.tsx'), 'utf8')
  for (const entry of PAGE_NAV_ENTRIES) {
    assert.strictEqual(entry.action?.kind, 'navigate')
    const route = entry.action.path.replace(/^\//, '')
    assert.ok(
      appSrc.includes(`path="${route}"`) || appSrc.includes(`path="${route}/`),
      `導航條目 ${entry.name} 的路由 "${route}" 不存在於 App.tsx`,
    )
  }
}

// ── 3. settings 條目與設定節單一真相同步 ──
{
  const entries = getAllCommandEntries()
  const settingsEntries = entries.filter((e) => e.action?.kind === 'settings')
  const paletteIds = new Set(paletteSettingsSections().map((s) => s.id))
  const entryIds = new Set(settingsEntries.map((e) => e.action && e.action.kind === 'settings' ? e.action.section : ''))
  assert.deepEqual(
    [...entryIds].sort(),
    [...paletteIds].sort(),
    'settings 條目應與 paletteSettingsSections 一一對應',
  )
  assert.ok(!entryIds.has('policyAdmin'), 'policy-admin build 專屬節不得進 palette')
  for (const id of paletteIds) {
    assert.ok(SETTINGS_SECTIONS.some((s) => s.id === id), `節 ${id} 應存在於 SETTINGS_SECTIONS`)
  }
  // 深連結路徑格式
  const llmEntry = settingsEntries.find((e) => e.name === 'settings:llm')
  assert.ok(llmEntry, 'settings:llm 條目應存在')
  assert.equal(commandEntryPath(llmEntry!), '/settings?section=llm')
  // slash 條目導航路徑為 null（由 slash 執行器處理）
  const runEntry = getLiveSlashCommands().find((c) => c.name === 'run')
  assert.ok(runEntry)
  assert.equal(commandEntryPath(runEntry!), null)
}

// ── 4. fuzzyMatch：子字串、子序列、不命中 ──
{
  assert.equal(fuzzyMatch('llm', 'settings:llm'), true)
  assert.equal(fuzzyMatch('設定', '設定 · 語言模型'), true)
  assert.equal(fuzzyMatch('dsn', 'design-systems'), true, '子序列：d-s-n')
  assert.equal(fuzzyMatch('LLM', 'llm'), true, '大小寫不敏感')
  assert.equal(fuzzyMatch('xyz', 'design-systems'), false)
  assert.equal(fuzzyMatch('', 'anything'), true, '空查詢全過')
}

// ── 5. filterCommandEntries：涵蓋三類條目 ──
{
  const all = getAllCommandEntries()
  const byQuery = (q: string) => filterCommandEntries(q, all)
  assert.ok(byQuery('subdesign').some((e) => e.name === 'subdesign'))
  assert.ok(byQuery('llm').some((e) => e.name === 'settings:llm'))
  assert.ok(byQuery('模型').some((e) => e.name === 'model' || e.name === 'settings:llm'))
  assert.ok(byQuery('').length === all.length, '空查詢回全量')
  assert.ok(byQuery('zzzz-不存在').length === 0)
}

console.log('Command registry smoke: 5 groups passed')
