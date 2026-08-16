/**
 * i18n extraction codemod (spec 6/6).
 *
 * Rewrites CJK string literals / JSX text / template literals in one file into
 * `t('key')` calls and prints the catalog entries to add to zh-TW.
 *
 * Deliberately conservative — it skips anything it cannot rewrite safely and
 * reports it, because a silently mangled JSX tree is far worse than a string
 * left behind for a human. Always read the diff.
 *
 *   node --experimental-strip-types scripts/i18n-extract.mts <file> <keyPrefix> [--write]
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const [, , target, prefix, ...flags] = process.argv
const write = flags.includes('--write')

if (!target || !prefix) {
  console.error('usage: i18n-extract.mts <file> <keyPrefix> [--write]')
  process.exit(2)
}

const file = path.resolve(target)
const appSrc = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../src')
let source = fs.readFileSync(file, 'utf8')

const CJK = /[一-鿿]/
const entries = new Map<string, string>()
const skipped: string[] = []
const usedKeys = new Set<string>()

/** 內容雜湊當 key：重排不會churn，新增不會影響既有 key。 */
function keyFor(text: string): string {
  const base = crypto.createHash('sha1').update(text).digest('hex').slice(0, 6)
  let key = `${prefix}.${base}`
  let n = 1
  while (usedKeys.has(key) && entries.get(key) !== text) key = `${prefix}.${base}${n++}`
  usedKeys.add(key)
  entries.set(key, text)
  return key
}

/** 這一段是不是不該碰的東西（import 路徑、class 名、註解…）。 */
function isSkippable(line: string): boolean {
  const trimmed = line.trim()
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('import ') ||
    trimmed.startsWith('export type') ||
    /className=/.test(trimmed) === false && false
  )
}

const lines = source.split('\n')
const commentRanges: Array<[number, number]> = []
{
  let start = -1
  lines.forEach((line, i) => {
    if (/^\s*\/\*/.test(line)) start = i
    if (start >= 0 && /\*\//.test(line)) {
      commentRanges.push([start, i])
      start = -1
    }
  })
}
function inComment(index: number): boolean {
  const line = source.slice(0, index).split('\n').length - 1
  return (
    commentRanges.some(([a, b]) => line >= a && line <= b) ||
    isSkippable(lines[line] ?? '')
  )
}

// 1) JSX 文字節點： >文字<
source = source.replace(/>(\s*)([^<>{}\n][^<>{}]*?)(\s*)</g, (whole, pre, text: string, post, offset: number) => {
  if (!CJK.test(text) || inComment(offset)) return whole
  const trimmed = text.trim()
  if (!trimmed) return whole
  return `>${pre}{t('${keyFor(trimmed)}')}${post}<`
})

// 2) JSX 屬性字串： attr="文字"
source = source.replace(/(\s)([a-zA-Z-]+)="([^"\n]*[一-鿿][^"\n]*)"/g, (whole, sp, attr: string, text: string, offset: number) => {
  if (inComment(offset)) return whole
  if (attr === 'className' || attr === 'id' || attr === 'data-testid') return whole
  return `${sp}${attr}={t('${keyFor(text)}')}`
})

// 2b) 單引號寫的 JSX 屬性： attr='文字'
// 這個要在規則 3 之前處理：否則會被當成一般字串換成 `attr=t('key')`，
// 少了大括號就不是合法 JSX。
source = source.replace(/(\s)([a-zA-Z-]+)='([^'\n]*[一-鿿][^'\n]*)'/g, (whole, sp, attr: string, text: string, offset: number) => {
  if (inComment(offset)) return whole
  if (attr === 'className' || attr === 'id' || attr === 'data-testid') return whole
  return `${sp}${attr}={t('${keyFor(text)}')}`
})

// 3) 一般字串字面值：'文字' / "文字"（非 import、非 class）
source = source.replace(/(?<![\w$])'([^'\n\\]*[一-鿿][^'\n\\]*)'/g, (whole, text: string, offset: number) => {
  if (inComment(offset)) return whole
  return `t('${keyFor(text)}')`
})

// 樣板字串一律不自動改寫。
// 試過了：即使排除 `$`，貼近的多個樣板仍會被跨界匹配，把一整段程式碼吃掉。
// tsc 會擋下語法錯誤，但「靜靜改壞一段字串」比留給人處理糟得多，所以不做。

// 樣板字串全部留給人：帶內插的要判斷語序、不帶內插的也不值得冒改壞的風險
for (const match of source.matchAll(/`[^`]*`/g)) {
  if (CJK.test(match[0])) skipped.push(match[0].slice(0, 90).replace(/\n/g, ' '))
}

/** 補上 `useTranslation` 的 import 與 hook 呼叫（元件檔才需要）。 */
function wireHook(code: string, filePath: string): string {
  if (!/\bt\('/.test(code)) return code
  if (code.includes('useTranslation')) return code
  const depth = path.relative(path.dirname(filePath), path.join(appSrc, 'i18n')).replace(/\\/g, '/')
  const importPath = depth.startsWith('.') ? depth : `./${depth}`
  const importLine = `import { useTranslation } from '${importPath}/useTranslation'`

  // 逐行找最後一個 import **語句**的結尾。單行 import 就是那一行；多行 import
  // （`import {` … `} from '…'`）要走到 `} from` 那一行才算結束——只用
  // /^import[^\n]*\n/ 比對會把新 import 插進大括號中間，把檔案切壞。
  const codeLines = code.split('\n')
  let lastImportLine = -1
  let inMultiline = false
  codeLines.forEach((line, i) => {
    if (inMultiline) {
      if (/^\s*\}\s*from\s+['"]/.test(line)) {
        inMultiline = false
        lastImportLine = i
      }
      return
    }
    if (/^import\b/.test(line)) {
      if (/\bfrom\s+['"]/.test(line) || /^import\s+['"]/.test(line)) lastImportLine = i
      else inMultiline = true
    }
  })
  if (inMultiline) {
    console.warn('  ! import 區塊解析不完整，跳過自動接線')
    return code
  }
  codeLines.splice(lastImportLine + 1, 0, importLine)
  let next = codeLines.join('\n')

  // 在元件本體開頭插入 hook
  const body = next.match(/export function \w+\([\s\S]*?\n\}\)?: ?\{[\s\S]*?\n\}\) \{\n|export function \w+\([^)]*\) \{\n/)
  if (body) {
    const at = body.index! + body[0].length
    next = next.slice(0, at) + '  const { t } = useTranslation()\n' + next.slice(at)
  } else {
    console.warn('  ! 找不到元件本體，需手動加入 const { t } = useTranslation()')
  }
  return next
}

if (write) {
  source = wireHook(source, file)
  fs.writeFileSync(file, source, 'utf8')
  // 把 key 追加進 zh-TW 檔（source of truth）
  if (entries.size) {
    const catalogPath = path.join(appSrc, 'i18n/locales/zh-TW.ts')
    let catalog = fs.readFileSync(catalogPath, 'utf8')
    const marker = '} as const'
    const block =
      `\n  // ── ${prefix} ──\n` +
      [...entries].map(([key, text]) => `  '${key}': ${JSON.stringify(text)},`).join('\n') +
      '\n'
    catalog = catalog.replace(marker, block + marker)
    fs.writeFileSync(catalogPath, catalog, 'utf8')
  }
  console.log(`rewrote ${target} (+${entries.size} keys)`)
}

console.log(`\n// ${target} — ${entries.size} keys`)
for (const [key, text] of entries) {
  console.log(`  '${key}': ${JSON.stringify(text)},`)
}
if (skipped.length) {
  console.log(`\n// 需人工處理（含內插）：${skipped.length}`)
  for (const s of skipped) console.log(`//   ${s}`)
}
