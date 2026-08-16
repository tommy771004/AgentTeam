/**
 * i18n reconciliation smoke (spec 6/6) — fail-closed both ways.
 *
 * Two failure modes this guards, both of which rot silently otherwise:
 *  - a `t('key')` in the source with no entry in zh-TW → the UI renders the raw key
 *  - an entry in zh-TW nobody uses → dead weight the next translator still pays for
 *
 * Run: node --experimental-strip-types scripts/smoke-i18n.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  interpolate,
  missingKeys,
  registerCatalog,
  resolveLanguage,
  resolveSystemLanguage,
  translate,
  UI_LANGUAGES,
} from '../src/i18n/index.ts'
import { zhTW } from '../src/i18n/locales/zh-TW.ts'
import { en } from '../src/i18n/locales/en.ts'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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

console.log('\ni18n reconciliation')

/** 掃描原始碼裡所有 `t('…')` 使用點。 */
function collectUsedKeys(): Map<string, string[]> {
  const used = new Map<string, string[]>()
  const walk = (rel: string) => {
    const abs = path.join(appRoot, rel)
    if (!fs.existsSync(abs)) return
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const next = `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        walk(next)
        continue
      }
      if (!/\.tsx?$/.test(entry.name)) continue
      if (/\.test\.tsx?$/.test(entry.name)) continue
      const source = fs.readFileSync(path.join(appRoot, next), 'utf8')
      for (const match of source.matchAll(/\bt\(\s*'([^']+)'/g)) {
        const key = match[1]
        used.set(key, [...(used.get(key) || []), next])
      }
      // key 也可能以物件屬性（registry 宣告）或 JSX 屬性（元件）的形式出現
      const keyProps = /(?:labelKey|summaryKey|titleKey)\s*(?::\s*'([^']+)'|=\s*"([^"]+)")/g
      for (const match of source.matchAll(keyProps)) {
        const key = match[1] || match[2]
        if (key) used.set(key, [...(used.get(key) || []), next])
      }
    }
  }
  walk('src')
  return used
}

const used = collectUsedKeys()
const declared = new Set(Object.keys(zhTW))

test('每個 t() 使用點都在 zh-TW 檔裡有對應（否則畫面會顯示 raw key）', () => {
  const missing = [...used.keys()].filter((key) => !declared.has(key))
  assert.deepEqual(
    missing,
    [],
    `這些 key 有使用點但 zh-TW 檔沒有：\n` +
      missing.map((key) => `  - ${key}（${used.get(key)?.join(', ')}）`).join('\n'),
  )
})

test('zh-TW 檔沒有孤兒 key（沒人用的字串是下一個翻譯者的白工）', () => {
  const orphans = [...declared].filter((key) => !used.has(key))
  assert.deepEqual(orphans, [], `這些 key 沒有任何使用點：\n${orphans.map((k) => `  - ${k}`).join('\n')}`)
})

test('zh-TW 沒有空字串（空翻譯等於畫面空白）', () => {
  const empty = Object.entries(zhTW).filter(([, value]) => !String(value).trim())
  assert.deepEqual(empty.map(([key]) => key), [])
})

test('內插參數在各語言之間一致（少一個參數就會漏字）', () => {
  registerCatalog('en', en)
  const paramsOf = (text: string) =>
    [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
  const mismatched: string[] = []
  for (const [key, zhText] of Object.entries(zhTW)) {
    const enText = (en as Record<string, string>)[key]
    if (!enText) continue
    if (paramsOf(String(zhText)) !== paramsOf(enText)) mismatched.push(key)
  }
  assert.deepEqual(mismatched, [], `這些 key 的 {param} 在 zh-TW 與 en 不一致：${mismatched.join(', ')}`)
})

test('en 只能少 key，不能多出 zh-TW 沒有的 key', () => {
  const extra = Object.keys(en).filter((key) => !declared.has(key))
  assert.deepEqual(extra, [], `en 有 zh-TW 沒有的 key：${extra.join(', ')}`)
})

test('缺翻 fallback 回 zh-TW，不是空白也不是 raw key', () => {
  registerCatalog('en', {})
  const key = Object.keys(zhTW)[0] as keyof typeof zhTW
  assert.equal(translate('en', key), zhTW[key])
  registerCatalog('en', en)
})

test('內插：具名參數、缺參數保留原樣', () => {
  assert.equal(interpolate('已建立 {name}', { name: '每日摘要' }), '已建立 每日摘要')
  assert.equal(interpolate('待跑 {n}/{max}', { n: 3, max: 24 }), '待跑 3/24')
  // 缺參數時保留 placeholder，而不是變成 undefined
  assert.equal(interpolate('缺 {missing}', {}), '缺 {missing}')
  assert.equal(interpolate('沒有參數'), '沒有參數')
})

test('系統語言解析：zh 系列 → zh-TW，其餘落 en，空清單落 zh-TW', () => {
  assert.equal(resolveSystemLanguage(['zh-Hant-TW', 'en-US']), 'zh-TW')
  assert.equal(resolveSystemLanguage(['zh']), 'zh-TW')
  assert.equal(resolveSystemLanguage(['en-GB']), 'en')
  assert.equal(resolveSystemLanguage(['fr-FR', 'en']), 'en')
  assert.equal(resolveSystemLanguage([]), 'zh-TW')
})

test('偏好覆寫系統：明確選了語言就不再跟隨 OS', () => {
  assert.equal(resolveLanguage('en', ['zh-TW']), 'en')
  assert.equal(resolveLanguage('zh-TW', ['en-US']), 'zh-TW')
  assert.equal(resolveLanguage('system', ['en-US']), 'en')
  assert.equal(resolveLanguage(undefined, ['en-US']), 'en')
})

test('缺翻清單可被列出（給 ticket 10 當進度表）', () => {
  registerCatalog('en', en)
  const missing = missingKeys('en')
  console.log(`      en 尚缺 ${missing.length}/${declared.size} 個 key`)
  assert.ok(Array.isArray(missing))
})

test('支援語言清單與語言檔對得上', () => {
  assert.deepEqual([...UI_LANGUAGES], ['zh-TW', 'en'])
})

console.log(`\n${passed} i18n smoke tests passed`)
console.log(`（zh-TW ${declared.size} keys · 使用點 ${used.size}）`)
console.log('OK')
