import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const OUT_DIR = path.resolve('../docs/audits/subdesign-docsui-integration-2026-08-22')
fs.mkdirSync(OUT_DIR, { recursive: true })

const SECTIONS = [
  ['composer', '01-composer-prompt-bar'],
  ['thinking', '02-thinking-run-narrative'],
  ['tools', '03-tool-chips-loading-state'],
  ['tasks', '04-task-rows-lifecycle'],
  ['direction', '05-approve-direction-choice'],
  ['context', '06-context-cards-references'],
  ['critique', '07-streaming-text-critique'],
  ['diff', '08-diff-table-revision'],
  ['deliver', '09-recommendation-card-deliver'],
  ['code', '10-code-block-export'],
]

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 1440, height: 1200 },
  deviceScaleFactor: 2,
})
const page = await context.newPage()

await page.goto('http://localhost:5173/#/subdesign?prototype=subdesign-docsui', {
  waitUntil: 'networkidle',
  timeout: 60000,
})
await page.waitForTimeout(2500)

// Full page overview
await page.screenshot({ path: path.join(OUT_DIR, '00-full-page.png'), fullPage: true })
console.log('Wrote 00-full-page.png')

// Per-section captures
for (const [section, file] of SECTIONS) {
  const locator = page.locator(`[data-section="${section}"]`)
  await locator.scrollIntoViewIfNeeded()
  await page.waitForTimeout(600)
  await locator.screenshot({ path: path.join(OUT_DIR, `${file}.png`) })
  console.log('Wrote', `${file}.png`)
}

await browser.close()
console.log('Done →', OUT_DIR)
