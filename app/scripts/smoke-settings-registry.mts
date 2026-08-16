/**
 * Settings registry smoke (spec 3/6) — fail-closed metadata coverage.
 *
 * The point of this file: a new settings field must not be able to appear
 * without declaring who sees it and how it is found. Add a key to
 * DEFAULT_LLM_SETTINGS and this fails until the key is declared in the field
 * registry, or explicitly classified as non-UI with a reason.
 *
 * Run: node --experimental-strip-types scripts/smoke-settings-registry.mts
 */
import assert from 'node:assert/strict'

import { DEFAULT_LLM_SETTINGS } from '../src/agent/llm.ts'
import { SETTINGS_SECTIONS, settingsPath } from '../src/commands/settingsSections.ts'
import {
  NON_UI_SETTINGS_KEYS,
  PENDING_SETTINGS_KEYS,
  SETTINGS_FIELDS,
  fieldAnchorId,
  fieldIsVisible,
  fieldsForSection,
  searchSettingsFields,
  sectionHasVisibleFields,
} from '../src/settings/fieldRegistry.ts'

let passed = 0
function test(name: string, fn: () => void) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (error) {
    console.error(`  ✗ ${name}`)
    console.error(error)
    process.exit(1)
  }
}

console.log('\nsettings registry')

const allKeys = Object.keys(DEFAULT_LLM_SETTINGS)
const declaredKeys = new Set(SETTINGS_FIELDS.flatMap((field) => field.settingsKeys))
const nonUiKeys = new Set(Object.keys(NON_UI_SETTINGS_KEYS))
const pendingKeys = new Set(PENDING_SETTINGS_KEYS)

test('fail-closed 覆蓋率：每個設定 key 都必須被歸類', () => {
  const unclassified = allKeys.filter(
    (key) => !declaredKeys.has(key) && !nonUiKeys.has(key) && !pendingKeys.has(key),
  )
  assert.deepEqual(
    unclassified,
    [],
    `這些設定 key 沒有 metadata 宣告：${unclassified.join(', ')}\n` +
      '請在 src/settings/fieldRegistry.ts 宣告欄位（tier／keywords／section／錨點），' +
      '或列入 NON_UI_SETTINGS_KEYS 並寫下理由。',
  )
})

test('分類清單不得腐化：排除／待辦名單不能有不存在的 key', () => {
  const known = new Set(allKeys)
  const staleNonUi = [...nonUiKeys].filter((key) => !known.has(key))
  const stalePending = [...pendingKeys].filter((key) => !known.has(key))
  assert.deepEqual(staleNonUi, [], `NON_UI_SETTINGS_KEYS 有不存在的 key：${staleNonUi.join(', ')}`)
  assert.deepEqual(stalePending, [], `PENDING_SETTINGS_KEYS 有不存在的 key：${stalePending.join(', ')}`)
})

test('分類互斥：一個 key 不能同時是已宣告、非 UI 與待辦', () => {
  for (const key of allKeys) {
    const buckets = [declaredKeys.has(key), nonUiKeys.has(key), pendingKeys.has(key)].filter(Boolean)
    assert.ok(buckets.length <= 1, `${key} 被重複分類`)
  }
})

test('每個已宣告欄位的 metadata 都完整', () => {
  const seen = new Set<string>()
  const sectionIds = new Set(SETTINGS_SECTIONS.map((section) => section.id))
  for (const field of SETTINGS_FIELDS) {
    assert.ok(field.id.trim(), '欄位必須有 id')
    assert.equal(seen.has(field.id), false, `錨點 id 重複：${field.id}`)
    seen.add(field.id)
    assert.ok(sectionIds.has(field.section), `${field.id} 的 section 不存在：${field.section}`)
    assert.ok(field.tier === 'basic' || field.tier === 'advanced', `${field.id} 缺 tier`)
    assert.ok(field.label.trim(), `${field.id} 缺標籤`)
    assert.ok(field.summary.trim(), `${field.id} 缺一句話說明`)
    assert.ok(field.keywords.length >= 2, `${field.id} 關鍵字太少`)
    // 中英文都要找得到：至少一個純 ASCII 關鍵字與一個非 ASCII 關鍵字
    assert.ok(
      field.keywords.some((keyword) => /^[\x20-\x7e]+$/.test(keyword)),
      `${field.id} 缺英文關鍵字`,
    )
    assert.ok(
      field.keywords.some((keyword) => /[^\x00-\x7f]/.test(keyword)),
      `${field.id} 缺中文關鍵字`,
    )
    // 錨點必須是合法的 CSS 選擇器（不得含點號，否則會被讀成 class）
    assert.match(fieldAnchorId(field.id), /^setting-[a-zA-Z0-9_-]+$/)
  }
})

test('錨點在 querySelector 下真的選得到（點號不得殘留）', () => {
  for (const field of SETTINGS_FIELDS) {
    const anchor = fieldAnchorId(field.id)
    assert.doesNotMatch(anchor, /\./, `${field.id} 的錨點含點號，CSS 選擇器會失效`)
  }
  assert.equal(fieldAnchorId('appearance.theme'), 'setting-appearance-theme')
})

test('進階欄位必有說明——不能讓人猜這個參數在調什麼', () => {
  for (const field of SETTINGS_FIELDS.filter((item) => item.tier === 'advanced')) {
    assert.ok(field.summary.length >= 8, `${field.id} 的進階說明過短`)
  }
})

const CTX = { showAdvanced: false, policyAdminBuild: false }
const ADV = { showAdvanced: true, policyAdminBuild: false }

test('tier 過濾：basic 檢視只留基礎欄位，advanced 全展', () => {
  const basic = fieldsForSection('appearance', CTX)
  const advanced = fieldsForSection('appearance', ADV)
  assert.ok(basic.length > 0, 'basic 檢視不該是空的')
  assert.ok(advanced.length > basic.length, 'advanced 必須看得更多')
  assert.equal(
    basic.every((field) => field.tier === 'basic'),
    true,
  )
  // advanced 是 basic 的超集合，不是另一組
  for (const field of basic) {
    assert.ok(advanced.some((item) => item.id === field.id), `${field.id} 在 advanced 消失了`)
  }
})

test('條件可見性以宣告表達：policy-admin build 才看得到的欄位', () => {
  const gated = {
    id: 'test.policyOnly',
    section: 'policyAdmin',
    tier: 'advanced' as const,
    label: 'x',
    summary: 'xxxxxxxx',
    keywords: ['x', '測試'],
    settingsKeys: [],
    visibility: 'policyAdminBuild' as const,
  }
  assert.equal(fieldIsVisible(gated, { showAdvanced: true, policyAdminBuild: false }), false)
  assert.equal(fieldIsVisible(gated, { showAdvanced: true, policyAdminBuild: true }), true)
  // 條件可見性不是分層：即使 policy build，basic 檢視仍依 tier 收起
  assert.equal(fieldIsVisible(gated, { showAdvanced: false, policyAdminBuild: true }), false)
})

test('尚未宣告欄位的節不會被藏起來（過渡期安全）', () => {
  assert.equal(sectionHasVisibleFields('mcp', CTX), true)
  assert.equal(sectionHasVisibleFields('appearance', CTX), true)
})

test('搜尋：中英文關鍵字命中同一個欄位', () => {
  const zh = searchSettingsFields('字級', { policyAdminBuild: false })
  const en = searchSettingsFields('font size', { policyAdminBuild: false })
  assert.ok(zh.some((hit) => hit.field.id === 'appearance.uiFontSize'))
  assert.ok(en.some((hit) => hit.field.id === 'appearance.uiFontSize'))
})

test('搜尋不看 tier：進階欄位在 basic 檢視下仍找得到', () => {
  const hits = searchSettingsFields('半透明', { policyAdminBuild: false })
  const hit = hits.find((item) => item.field.id === 'appearance.translucentSidebar')
  assert.ok(hit, '進階欄位必須搜得到，否則使用者會以為設定不存在')
  assert.equal(hit.field.tier, 'advanced')
  assert.equal(hit.sectionLabel, '外觀')
})

test('搜尋：空字串不回傳整包，避免一開啟就洗版', () => {
  assert.deepEqual(searchSettingsFields('', { policyAdminBuild: false }), [])
  assert.deepEqual(searchSettingsFields('   ', { policyAdminBuild: false }), [])
})

test('欄位深連結：settingsPath 帶欄位時仍是合法路徑，且節深連結行為不變', () => {
  assert.equal(settingsPath('llm'), '/settings?section=llm')
  assert.equal(
    settingsPath('appearance', 'appearance.theme'),
    '/settings?section=appearance&field=appearance.theme',
  )
  // 每個已宣告欄位都組得出深連結，且 section 真的存在
  const sectionIds = new Set(SETTINGS_SECTIONS.map((section) => section.id))
  for (const field of SETTINGS_FIELDS) {
    assert.ok(sectionIds.has(field.section))
    assert.match(settingsPath(field.section, field.id), /^\/settings\?section=[^&]+&field=/)
  }
})

console.log(`\n${passed} settings registry smoke tests passed`)
console.log(`（待宣告 ${PENDING_SETTINGS_KEYS.length} 個 key，由 ticket 03–05 清空）`)
console.log('OK')
