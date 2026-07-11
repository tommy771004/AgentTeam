import { chromium } from 'playwright'
import path from 'node:path'

const out = path.resolve('design-impl-plugin-marketplace.png')
const outInstalled = path.resolve('design-impl-plugin-marketplace-installed.png')

const SEEDED_PLUGINS = [
  { id: 'web-reader', name: 'Web Reader', enabled: true, version: '1.0.0' },
  { id: 'data-toolkit', name: 'Data Analytics', enabled: true, version: '1.0.0' },
  { id: 'spreadsheets-connector', name: 'Spreadsheets', enabled: true, version: '1.0.0' },
  { id: 'presentations-connector', name: 'Presentations', enabled: true, version: '1.0.0' },
  { id: 'github-connector', name: 'GitHub', enabled: true, version: '1.0.0' },
  { id: 'notion-connector', name: 'Notion', enabled: true, version: '1.0.0' },
  { id: 'calendar-connector', name: 'Google Calendar', enabled: true, version: '1.0.0' },
  { id: 'linear-connector', name: 'Linear', enabled: true, version: '1.0.0' },
  { id: 'dropbox-connector', name: 'Dropbox', enabled: true, version: '1.0.0' },
  { id: 'canva-connector', name: 'Canva', enabled: true, version: '1.0.0' },
  { id: 'figma-connector', name: 'Figma', enabled: true, version: '1.0.0' },
  { id: 'browser-connector', name: 'Browser Control', enabled: true, version: '1.0.0' },
]

async function openPlugins(page) {
  await page.goto('http://localhost:5173/#/learning', {
    waitUntil: 'networkidle',
    timeout: 30000,
  })
  await page.waitForTimeout(500)

  const candidates = [
    page.getByRole('button', { name: /外掛/ }),
    page.locator('button', { hasText: '外掛' }),
  ]
  for (const loc of candidates) {
    try {
      const el = loc.first()
      if (await el.count()) {
        await el.click({ timeout: 3000 })
        break
      }
    } catch {
      // try next
    }
  }
  await page.waitForTimeout(800)
}

const browser = await chromium.launch({ headless: true })

// Pass 1 — empty public state
{
  const context = await browser.newContext({ viewport: { width: 1668, height: 1224 } })
  const page = await context.newPage()
  await openPlugins(page)
  await page.screenshot({ path: out, fullPage: false })
  console.log('Wrote', out)
  await context.close()
}

// Pass 2 — seeded installed strip
{
  const context = await browser.newContext({ viewport: { width: 1668, height: 1224 } })
  const page = await context.newPage()
  await page.addInitScript((plugins) => {
    localStorage.setItem(
      'subagents.hermes.v1',
      JSON.stringify({
        plugins,
        memory: { userProfile: '', memory: '', entries: [] },
        skills: [],
      }),
    )
  }, SEEDED_PLUGINS)

  await openPlugins(page)

  const pluginIds = await page.evaluate(() => {
    try {
      const data = JSON.parse(localStorage.getItem('subagents.hermes.v1') || '{}')
      return (data.plugins || []).map((p) => p.id)
    } catch {
      return []
    }
  })
  console.log('Seeded plugin ids in localStorage:', pluginIds)

  // If strip still empty, force-import via UI store after hydrate
  const stripText = await page.locator('text=尚未安裝').count()
  if (stripText > 0) {
    console.log('Strip still empty — calling install via page evaluate refresh')
    await page.evaluate((plugins) => {
      localStorage.setItem(
        'subagents.hermes.v1',
        JSON.stringify({
          plugins,
          memory: { userProfile: '', memory: '', entries: [] },
          skills: [],
        }),
      )
    }, SEEDED_PLUGINS)
    await page.reload({ waitUntil: 'networkidle' })
    await openPlugins(page)
  }

  await page.screenshot({ path: outInstalled, fullPage: false })
  console.log('Wrote', outInstalled)
  await context.close()
}

await browser.close()
