/**
 * Interactive marketplace QA:
 * install bundled + connector → 已安裝 strip grows → manage menu opens.
 * Requires: npm run dev on :5173
 */
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import path from 'node:path'

const out = path.resolve('design-impl-plugin-marketplace-interact.png')

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1668, height: 1224 } })
const page = await context.newPage()

await page.goto('http://localhost:5173/#/learning', { waitUntil: 'networkidle', timeout: 30000 })
await page.waitForTimeout(500)

// Open 外掛 section
await page.getByRole('button', { name: /外掛/ }).first().click()
await page.waitForTimeout(600)

// Baseline: empty strip copy
const emptyHint = page.getByText(/尚未安裝外掛/)
assert.equal(await emptyHint.count(), 1, 'expected empty installed strip')

// npm-mcp without Electron should show gate copy
const fsRow = page.locator('article').filter({ hasText: 'Workspace Files' }).first()
assert.match(await fsRow.innerText(), /需要 Electron/)
assert.equal(await fsRow.getByRole('button', { name: '安裝' }).isDisabled(), true)

// Install bundled: Web Reader (has 安裝 button in Featured)
const webRow = page.locator('article').filter({ hasText: 'Web Reader' }).first()
await webRow.getByRole('button', { name: '安裝' }).click()
await page.waitForTimeout(800)

// Should no longer show empty hint; strip should have a brand tile button
assert.equal(await emptyHint.count(), 0, 'empty strip should clear after install')

// Install connector: Notion → setup-required stub + manage open
const notionRow = page.locator('article').filter({ hasText: 'Notion' }).first()
await notionRow.getByRole('button', { name: '安裝' }).click()
await page.waitForTimeout(800)

// Manage panel should show 需設定 / 啟用 / 移除 + auth form
const managed = page.locator('article').filter({ hasText: 'Notion' }).first()
await managed.getByText('需設定').first().waitFor({ timeout: 3000 })
await managed.getByText('啟用').waitFor({ timeout: 1000 })
await managed.getByRole('button', { name: '移除' }).waitFor({ timeout: 1000 })
await managed.getByRole('button', { name: /儲存並授權/ }).waitFor({ timeout: 1000 })

// Authorize with a dummy token → 已授權
await managed.getByPlaceholder(/ntn_|secret_|token|API/i).fill('ntn_test_token_123456')
await managed.getByRole('button', { name: /儲存並授權/ }).click()
await page.waitForTimeout(500)
await managed.getByText(/已授權|授權已就緒/).first().waitFor({ timeout: 3000 })

// Scope → 個人 should list installed
await page.getByRole('button', { name: '個人' }).click()
await page.waitForTimeout(400)
assert.ok((await page.locator('article').count()) >= 2, 'personal scope should list installed plugins')

// Uninstall Notion via manage
await managed.getByRole('button', { name: '移除' }).click()
await page.waitForTimeout(500)

// Search filter
await page.getByRole('button', { name: '公開' }).click()
await page.getByPlaceholder('搜尋外掛程式').fill('Figma')
await page.waitForTimeout(300)
const articles = page.locator('article')
assert.equal(await articles.count(), 1, 'search Figma should leave one row')
assert.match(await articles.first().innerText(), /Figma/)

// Clear search, open category filter
await page.getByPlaceholder('搜尋外掛程式').fill('')
await page.getByTitle('分類篩選').click()
await page.getByRole('button', { name: 'Creativity' }).click()
await page.waitForTimeout(300)
const creativityHeading = page.locator('h2', { hasText: 'Creativity' })
await creativityHeading.waitFor({ timeout: 2000 })
const body = await page.locator('section.w-full').innerText()
assert.match(body, /Canva|Figma|Image Studio|Adobe/)
assert.doesNotMatch(body, /Featured\n/, 'Featured section should be hidden under Creativity filter')

await page.screenshot({ path: out, fullPage: false })
console.log('OK marketplace interact')
console.log('Wrote', out)

await browser.close()
