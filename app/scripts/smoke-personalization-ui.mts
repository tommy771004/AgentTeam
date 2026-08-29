import assert from 'node:assert/strict'

console.log('[personalization-ui] script:start')
const appRoot = new URL('..', import.meta.url).pathname
const trace: string[] = []
const bounded = async <T>(stage: string, operation: Promise<T>, timeoutMs = 10_000): Promise<T> => {
  trace.push(`${stage}:start`)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${stage} exceeded ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
    trace.push(`${stage}:done`)
  }
}
const tabTo = async (page: any, target: any, label: string) => {
  await page.evaluate(() => {
    document.body.tabIndex = 0
    document.body.focus()
  })
  for (let step = 0; step < 160; step += 1) {
    await page.keyboard.press('Tab')
    if (await target.evaluate((element: Element) => element === document.activeElement)) return
  }
  throw new Error(`Tab traversal could not reach ${label}`)
}

let server: any
let browser: any
try {
  const [{ createServer }, { default: react }, { default: tailwindcss }, { chromium }] = await bounded(
    'module imports',
    Promise.all([import('vite'), import('@vitejs/plugin-react'), import('@tailwindcss/vite'), import('playwright')]),
  )
  server = await bounded('vite create', createServer({
    configFile: false,
    root: appRoot,
    plugins: [react(), tailwindcss()],
    server: { host: '127.0.0.1', port: 0 },
  }))
  await bounded('vite listen', server.listen())
  const address = server.httpServer?.address()
  const port = typeof address === 'object' && address ? address.port : 0
  assert.ok(port > 0, 'fixture server must bind an ephemeral loopback port')
  browser = await bounded('chromium launch', chromium.launch({ headless: true }))
  for (const viewport of [{ name: 'desktop', width: 1200 }, { name: 'narrow', width: 280 }]) {
    const page = await bounded(`${viewport.name} newPage`, browser.newPage({ viewport: { width: viewport.width, height: 900 } }))
    await bounded(`${viewport.name} navigation`, page.goto(`http://127.0.0.1:${port}/scripts/personalization-ui-fixture.html`, { waitUntil: 'networkidle', timeout: 10_000 }))
    await bounded(`${viewport.name} projection mount`, page.getByLabel('Host instruction snapshot').waitFor({ state: 'visible', timeout: 10_000 }))

    const body = await page.locator('body').innerText()
    for (const text of [
      'Project root · AGENTS.md',
      'Included local file · shared-guidance.md',
      'include depth 1',
      'effective order 1',
      'effective order 4',
      'delivery mode explicit',
      'budget：global personalization',
      'exact snapshot',
      'shadowed · not applied',
    ]) assert.ok(body.includes(text), `${viewport.name} projection visibly presents ${text}`)
    assert.equal((body.match(/budget：global personalization 34\/512 B · project instructions 83\/1024 B · total 117\/1536 B/g) || []).length, 1, `${viewport.name} budget numerators and denominators are exact and singular`)
    assert.equal(await page.locator('details').count(), 0, `${viewport.name} projection is visible without expansion`)
    assert.equal(await page.locator('[aria-hidden="true"]').count(), 0, `${viewport.name} projection is not aria-hidden`)
    assert.equal(await page.locator('body').evaluate((node) => node.scrollWidth <= window.innerWidth + 1), true, `${viewport.name} projection has no horizontal clipping`)

    assert.equal(await page.getByRole('combobox', { name: '預設人格' }).inputValue(), 'professional')
    assert.equal(await page.getByRole('textbox', { name: '關於你' }).inputValue(), '工程師；偏好繁體中文。')
    assert.equal(await page.getByRole('textbox', { name: '希望如何回覆' }).inputValue(), '結構清楚，避免冗長寒暄。')
    assert.equal(await page.getByRole('textbox', { name: '全域自訂指令' }).inputValue(), '使用繁體中文，先給結論再列出可執行步驟。')
    assert.equal(await page.getByRole('textbox', { name: '進階人格指令' }).inputValue(), '保持直接、精確且尊重的語氣。')
    assert.equal((body.match(/ui-snapshot-12/g) || []).length, 1, `${viewport.name} snapshot id appears once`)
    assert.equal((body.match(/effective hash e{64}/g) || []).length, 1, `${viewport.name} effective hash appears once`)
    for (const [letter, label] of [['a', 'global source'], ['b', 'personality source'], ['c', 'project source'], ['d', 'include source'], ['f', 'shadowed source']]) {
      assert.equal((body.match(new RegExp(`hash ${letter.repeat(12)}`, 'g')) || []).length, 1, `${viewport.name} ${label} hash appears once`)
    }
    assert.equal((body.match(/delivery mode explicit/g) || []).length, 1, `${viewport.name} delivery mode is not duplicated`)
    assert.equal((body.match(/revision 12/g) || []).length >= 1, true, `${viewport.name} revision is visible`)
    const sourceRows = page.locator('[data-source-id]')
    assert.equal(await sourceRows.count(), 5, `${viewport.name} every Host source has one row`)
    const sourceIds = await sourceRows.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-source-id')))
    assert.equal(new Set(sourceIds).size, 5, `${viewport.name} source rows are unique`)
    assert.equal(await sourceRows.evaluateAll((rows) => rows.every((row) => !/pill|chip|badge/i.test(row.className) && !row.getAttribute('role'))), true, `${viewport.name} source metadata has no decorative chip treatment`)
    const textRegions = page.locator('h3:visible, p:visible, label:visible, [role="status"]:visible, [data-source-id]:visible')
    const textFacts = await textRegions.evaluateAll((items) => items.map((item) => {
      const element = item as HTMLElement
      const rect = element.getBoundingClientRect()
      const parseColor = (value: string) => {
        const parts = value.match(/[\d.]+/g)?.map(Number) || []
        return parts.length >= 3 ? [parts[0], parts[1], parts[2], parts[3] ?? 1] : null
      }
      const blend = (foreground: number[], background: number[]) => {
        const alpha = foreground[3]
        return [foreground[0] * alpha + background[0] * (1 - alpha), foreground[1] * alpha + background[1] * (1 - alpha), foreground[2] * alpha + background[2] * (1 - alpha), alpha + background[3] * (1 - alpha)]
      }
      const ancestors: HTMLElement[] = []
      for (let current: HTMLElement | null = element; current; current = current.parentElement) ancestors.unshift(current)
      let background = [255, 255, 255, 1]
      for (const ancestor of ancestors) {
        const color = parseColor(getComputedStyle(ancestor).backgroundColor)
        if (color) background = blend(color, background)
      }
      const foreground = parseColor(getComputedStyle(element).color)
      const compositedForeground = foreground ? blend(foreground, background) : null
      const luminance = (color: number[]) => color.slice(0, 3).map((channel) => channel / 255).map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
      const contrast = compositedForeground ? (Math.max(luminance(compositedForeground), luminance(background)) + 0.05) / (Math.min(luminance(compositedForeground), luminance(background)) + 0.05) : 0
      return { text: element.textContent?.trim(), gutter: rect.left >= 8 && rect.right <= window.innerWidth - 8 && rect.width > 0 && rect.height > 0, contrast, threshold: Number.parseFloat(getComputedStyle(element).fontSize) >= 18 ? 3 : 4.5 }
    }))
    assert.equal(textFacts.every((fact) => fact.text && fact.gutter && fact.contrast >= fact.threshold), true, `${viewport.name} visible labels/status/source text has gutters and WCAG contrast`)
    const controls = page.locator('button:visible, select:visible, textarea:visible, [role="button"]:visible')
    const controlFacts = await controls.evaluateAll((items) => items.map((item) => {
      const element = item as HTMLElement
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      const label = element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName
      const parseColor = (value: string) => {
        const parts = value.match(/[\d.]+/g)?.map(Number) || []
        if (parts.length < 3) return null
        return [parts[0], parts[1], parts[2], parts[3] ?? 1]
      }
      const blend = (foreground: number[], background: number[]) => {
        const alpha = foreground[3]
        return [
          foreground[0] * alpha + background[0] * (1 - alpha),
          foreground[1] * alpha + background[1] * (1 - alpha),
          foreground[2] * alpha + background[2] * (1 - alpha),
          alpha + background[3] * (1 - alpha),
        ]
      }
      let background = [255, 255, 255, 1]
      const ancestors: HTMLElement[] = []
      for (let current: HTMLElement | null = element; current; current = current.parentElement) ancestors.unshift(current)
      for (const ancestor of ancestors) {
        const color = parseColor(getComputedStyle(ancestor).backgroundColor)
        if (color) background = blend(color, background)
      }
      const foreground = parseColor(style.color)
      const compositedForeground = foreground ? blend(foreground, background) : null
      const luminance = (color: number[]) => color.slice(0, 3).map((channel) => channel / 255).map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
      const contrast = compositedForeground ? (Math.max(luminance(compositedForeground), luminance(background)) + 0.05) / (Math.min(luminance(compositedForeground), luminance(background)) + 0.05) : 0
      return {
        label,
        enabled: !(element as HTMLButtonElement).disabled,
        visible: style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0',
        insideViewport: rect.left >= 0 && rect.right <= window.innerWidth + 1 && rect.width > 0 && rect.height > 0,
        gutter: rect.left >= 8 && rect.right <= window.innerWidth - 8,
        contrast,
        readable: Boolean(compositedForeground && contrast >= (Number.parseFloat(style.fontSize) >= 18 ? 3 : 4.5)),
      }
    }))
    assert.ok(controlFacts.length >= 10, `${viewport.name} all Personalization controls are mounted`)
    assert.equal(controlFacts.every((fact) => fact.visible && fact.insideViewport && fact.gutter && fact.label && fact.readable), true, `${viewport.name} controls are visible, named, inside the viewport with gutters and WCAG-readable`)
    const projectRowGeometry = await page.locator('[data-source-scope="project"]').evaluateAll((rows) => rows.map((row) => {
      const rowRect = row.getBoundingClientRect()
      const contentRect = row.firstElementChild?.getBoundingClientRect()
      const actionRect = row.lastElementChild?.getBoundingClientRect()
      const buttons = [...row.querySelectorAll('button')].map((button) => button.getBoundingClientRect())
      return {
        row: { left: rowRect.left, right: rowRect.right, top: rowRect.top, bottom: rowRect.bottom },
        content: contentRect ? { left: contentRect.left, right: contentRect.right, top: contentRect.top, bottom: contentRect.bottom } : null,
        action: actionRect ? { left: actionRect.left, right: actionRect.right, top: actionRect.top, bottom: actionRect.bottom } : null,
        buttons: buttons.map((rect) => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })),
      }
    }))
    assert.equal(projectRowGeometry.every((fact) => {
      if (!fact.content || !fact.action) return false
      const childrenInside = fact.content.left >= fact.row.left && fact.content.right <= fact.row.right && fact.action.left >= fact.row.left && fact.action.right <= fact.row.right
      const buttonsDoNotOverlap = fact.buttons.every((button, index) => fact.buttons.slice(index + 1).every((other) => button.right <= other.left || other.right <= button.left || button.bottom <= other.top || other.bottom <= button.top))
      const centerAligned = viewport.width < 640 || Math.abs((fact.content.top + fact.content.bottom) - (fact.action.top + fact.action.bottom)) <= 4
      return childrenInside && buttonsDoNotOverlap && centerAligned
    }), true, `${viewport.name} source rows keep aligned action centers, gutters and non-overlapping controls`)
    for (let index = 0; index < await controls.count(); index += 1) {
      const control = controls.nth(index)
      if (await control.getAttribute('disabled') !== null) continue
      await tabTo(page, control, controlFacts[index]?.label || `control-${index}`)
      assert.equal(await control.evaluate((element: Element) => element === document.activeElement), true, `${viewport.name} ${controlFacts[index]?.label} is keyboard focusable by Tab traversal`)
    }
    const preset = page.getByRole('combobox', { name: '預設人格' })
    await preset.click()
    await tabTo(page, preset, `${viewport.name} personality select`)
    for (let step = 0; step < 4; step += 1) await page.keyboard.press('ArrowUp')
    await preset.press('ArrowDown')
    await preset.press('Enter')
    assert.equal(await preset.inputValue(), 'none', `${viewport.name} personality select changes and remains keyboard reachable`)
    const editedValues = {
      '關於你': '工程師；偏好繁體中文。[keyboard about]',
      '希望如何回覆': '結構清楚，避免冗長寒暄。[keyboard response]',
      '全域自訂指令': '使用繁體中文，先給結論再列出可執行步驟。[keyboard global]',
      '進階人格指令': '保持直接、精確且尊重的語氣。[keyboard personality]',
    }
    for (const [name, value] of Object.entries(editedValues)) {
      const field = page.getByRole('textbox', { name })
      await field.click()
      await tabTo(page, field, `${viewport.name} ${name}`)
      await field.press('End')
      await page.keyboard.type(value.slice(value.indexOf('[')))
    }
    const save = page.getByRole('button', { name: '儲存 revision' })
    await save.click()
    await page.getByText('已由 Host transaction commit。新的指令從下一個 Task run 生效。', { exact: true }).waitFor({ state: 'visible', timeout: 5_000 })
    const savedPayload = await page.evaluate(() => (window as unknown as { __personalizationFixtureLedger: { save: Array<Record<string, unknown>> } }).__personalizationFixtureLedger.save.at(-1))
    assert.deepEqual(savedPayload, {
      aboutUser: editedValues['關於你'],
      responseStyle: editedValues['希望如何回覆'],
      globalCustomInstructions: editedValues['全域自訂指令'],
      advancedPersonalityInstructions: editedValues['進階人格指令'],
      personality: 'none',
      expectedRevision: 12,
    }, `${viewport.name} save carries the real edited fields and expected revision`)
    const exportButton = page.getByRole('button', { name: '匯出 JSON' })
    await exportButton.click()
    const cancelExport = page.getByRole('button', { name: '取消匯出' })
    assert.equal(await cancelExport.count(), 1, `${viewport.name} export exposes an armed-state cancel control`)
    await tabTo(page, cancelExport, `${viewport.name} export cancel`)
    await page.keyboard.press('Enter')
    assert.equal(await page.getByRole('button', { name: '確認匯出 plaintext JSON' }).count(), 0, `${viewport.name} export cancel clears the armed state`)
    assert.equal(await page.evaluate(() => (window as unknown as { __personalizationFixtureLedger: { export: number } }).__personalizationFixtureLedger.export), 0, `${viewport.name} export cancel does not cross the Host bridge`)
    await exportButton.click()
    const exportConfirm = page.getByRole('button', { name: '確認匯出 plaintext JSON' })
    await tabTo(page, exportConfirm, `${viewport.name} export confirmation`)
    await page.keyboard.press('Enter')
    assert.equal(await page.evaluate(() => (window as unknown as { __personalizationFixtureLedger: { export: number } }).__personalizationFixtureLedger.export), 1, `${viewport.name} export is triggered once after arming`)
    assert.deepEqual(await page.evaluate(() => (window as unknown as { __personalizationFixtureLedger: { exportMetadata: Array<Record<string, unknown>> } }).__personalizationFixtureLedger.exportMetadata.at(-1)), {
      kind: 'agentstudio-personalization',
      schemaVersion: 1,
      revision: 13,
    }, `${viewport.name} export records metadata without requiring a prompt body`)
    assert.equal(await page.getByRole('button', { name: '確認匯出 plaintext JSON' }).count(), 0, `${viewport.name} export armed state clears after commit`)
    const importFile = page.getByLabel('選擇個人化匯入檔')
    const importLabel = page.getByRole('button', { name: '選擇匯入檔' })
    await importLabel.click()
    await importFile.setInputFiles({ name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from('{}') })
    await page.getByRole('button', { name: '取消預覽' }).click()
    assert.equal(await page.getByRole('button', { name: '取消預覽' }).count(), 0, `${viewport.name} import cancel clears the preview and apply controls`)
    await tabTo(page, importLabel, `${viewport.name} import label`)
    const fileChooserPromise = page.waitForEvent('filechooser')
    await page.keyboard.press('Enter')
    await (await fileChooserPromise).setFiles({ name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from('{}') })
    const revisionBeforeImport = await page.evaluate(() => (window as unknown as { __personalizationFixtureLedger: { revision: number } }).__personalizationFixtureLedger.revision)
    const applyImport = page.getByRole('button', { name: /確認套用 ready/ })
    await tabTo(page, applyImport, `${viewport.name} import apply`)
    await page.keyboard.press('Enter')
    await page.getByText('匯入已 atomic commit。重複套用同一 bundle 不會新增 revision。', { exact: true }).waitFor({ state: 'visible', timeout: 5_000 })
    assert.equal(await page.evaluate(() => (window as unknown as { __personalizationFixtureLedger: { applyImport: number } }).__personalizationFixtureLedger.applyImport), 1, `${viewport.name} import apply crosses the bridge once`)
    assert.equal(await page.evaluate(() => (window as unknown as { __personalizationFixtureLedger: { revision: number } }).__personalizationFixtureLedger.revision), revisionBeforeImport + 1, `${viewport.name} import commit advances the Host revision`)
    assert.equal(await page.getByRole('textbox', { name: '全域自訂指令' }).inputValue(), 'IMPORTED_FIXTURE_GLOBAL', `${viewport.name} import applies a new body and refreshes the editor`)
    const resolvesBeforeRescan = await page.evaluate(() => (window as unknown as { __personalizationFixtureLedger: { resolve: number } }).__personalizationFixtureLedger.resolve)
    const rescan = page.getByRole('button', { name: '重新掃描' })
    await rescan.click()
    await tabTo(page, rescan, `${viewport.name} rescan`)
    await page.keyboard.press('Enter')
    await page.waitForFunction((before) => (window as unknown as { __personalizationFixtureLedger: { resolve: number } }).__personalizationFixtureLedger.resolve > before, resolvesBeforeRescan)
    for (const [id, order] of [['global-12', '1'], ['personality-12', '2'], ['project-12', '3'], ['include-12', '4']]) {
      const row = page.locator(`[data-source-id="${id}"]`)
      assert.equal(await row.count(), 1, `${viewport.name} ${id} has one source row`)
      assert.equal((await row.innerText()).includes(`effective order ${order}`), true, `${viewport.name} ${id} preserves Host effective order ${order}`)
      assert.equal(await row.locator('[data-source-id]').count(), 0, `${viewport.name} ${id} has no duplicated source descendant`)
    }
    const shadowedRow = page.locator('[data-source-id="shadowed-12"]')
    assert.equal((await shadowedRow.innerText()).includes('effective order'), false, `${viewport.name} shadowed source has no fabricated effective order`)
    assert.equal(await shadowedRow.locator('[data-source-id]').count(), 0, `${viewport.name} shadowed source has no duplicated source descendant`)
    const include = page.locator('[data-source-kind="include"]')
    assert.equal(await include.getAttribute('data-include-depth'), '1')
    assert.equal(await include.getAttribute('data-parent-path'), '/tmp/personalization-ui-project/AGENTS.md')
    const projectRow = page.locator('[data-source-id="project-12"]')
    const includeIndent = await include.evaluate((node) => Number.parseFloat(getComputedStyle(node).paddingInlineStart))
    const projectIndent = await projectRow.evaluate((node) => Number.parseFloat(getComputedStyle(node).paddingInlineStart))
    assert.ok(includeIndent > projectIndent, `${viewport.name} include is indented beneath its parent source`)

    const open = page.getByRole('button', { name: '在編輯器開啟' }).first()
    await open.click()
    await page.getByText('已開啟 canonical instruction source：/tmp/personalization-ui-project/AGENTS.md', { exact: true }).waitFor({ state: 'visible', timeout: 5_000 })
    const firstProjectRow = page.locator('[data-source-id="project-12"]')
    const firstProjectButtons = firstProjectRow.getByRole('button')
    assert.equal(await firstProjectButtons.count(), 2, `${viewport.name} project source exposes edit and open controls`)
    await tabTo(page, firstProjectButtons.nth(1), `${viewport.name} source action`)
    await page.keyboard.press('Shift+Tab')
    assert.equal(await firstProjectButtons.nth(0).evaluate((element: Element) => element === document.activeElement), true, `${viewport.name} source controls support reverse Shift+Tab traversal`)
    await tabTo(page, open, `${viewport.name} source action`)
    await page.keyboard.press('Enter')
    await page.getByText('已開啟 canonical instruction source：/tmp/personalization-ui-project/AGENTS.md', { exact: true }).waitFor({ state: 'visible', timeout: 5_000 })
    const edit = page.getByRole('button', { name: '編輯' }).first()
    await edit.click()
    const editor = page.locator('#project-instruction-editor')
    await editor.waitFor({ state: 'visible', timeout: 5_000 })
    await page.getByRole('button', { name: 'Atomic save' }).click()
    await page.getByText('Project instruction 已 atomic commit。既有 run 維持 frozen snapshot，下一個 run 生效。', { exact: true }).waitFor({ state: 'visible', timeout: 5_000 })
    await edit.click()
    await page.getByRole('button', { name: '重新載入外部版本' }).click()
    await page.getByText(/已重新載入 external AGENTS.md revision\/hash/, { exact: false }).waitFor({ state: 'visible', timeout: 5_000 })
    await edit.click()
    const cancelEditor = page.getByRole('button', { name: '取消' }).last()
    await tabTo(page, cancelEditor, `${viewport.name} editor cancel`)
    await page.keyboard.press('Enter')
    assert.equal(await page.locator('#project-instruction-editor').count(), 0, `${viewport.name} project cancel closes the editor`)
    const openButtons = page.getByRole('button', { name: '在編輯器開啟' })
    const expectedOpenPaths = [
      '/tmp/personalization-ui-project/AGENTS.md',
      '/tmp/personalization-ui-project/shared-guidance.md',
      '/tmp/personalization-ui-project/subdir/AGENTS.md',
    ]
    for (let index = 1; index < await openButtons.count(); index += 1) {
      await openButtons.nth(index).click()
      await page.getByText(`已開啟 canonical instruction source：${expectedOpenPaths[index]}`, { exact: true }).waitFor({ state: 'visible', timeout: 5_000 })
      await tabTo(page, openButtons.nth(index), `${viewport.name} open source ${index}`)
      await page.keyboard.press('Enter')
      await page.getByText(`已開啟 canonical instruction source：${expectedOpenPaths[index]}`, { exact: true }).waitFor({ state: 'visible', timeout: 5_000 })
    }
    const openedPaths = await page.evaluate(() => (window as unknown as { __personalizationFixtureLedger: { open: string[] } }).__personalizationFixtureLedger.open)
    assert.equal(openedPaths.length, 6, `${viewport.name} every openable source reaches the Host opener by pointer and keyboard`)
    assert.deepEqual(openedPaths, [
      '/tmp/personalization-ui-project/AGENTS.md',
      '/tmp/personalization-ui-project/AGENTS.md',
      '/tmp/personalization-ui-project/shared-guidance.md',
      '/tmp/personalization-ui-project/shared-guidance.md',
      '/tmp/personalization-ui-project/subdir/AGENTS.md',
      '/tmp/personalization-ui-project/subdir/AGENTS.md',
    ], `${viewport.name} source open calls preserve canonical paths`)
    assert.equal(await page.evaluate(() => (window as unknown as { __personalizationFixtureLedger: { projectRead: number; projectWrite: number } }).__personalizationFixtureLedger.projectRead >= 2), true, `${viewport.name} edit and reload read through Host`)
    assert.equal(await page.evaluate(() => (window as unknown as { __personalizationFixtureLedger: { projectWrite: number } }).__personalizationFixtureLedger.projectWrite), 1, `${viewport.name} project save crosses Host once`)
    await page.close()
  }
  const degradedPage = await bounded('degraded newPage', browser.newPage({ viewport: { width: 280, height: 900 } }))
  await bounded('degraded navigation', degradedPage.goto(`http://127.0.0.1:${port}/scripts/personalization-ui-fixture.html?degraded=1`, { waitUntil: 'networkidle', timeout: 10_000 }))
  await bounded('degraded projection mount', degradedPage.getByLabel('Host instruction snapshot').waitFor({ state: 'visible', timeout: 10_000 }))
  await degradedPage.getByText(/unauthorized：include target/, { exact: false }).waitFor({ state: 'visible', timeout: 5_000 })
  const authorize = degradedPage.getByRole('button', { name: '授權這個 exact target' })
  assert.equal(await authorize.count(), 1, 'include error has one explicit recovery control')
  await tabTo(degradedPage, authorize, 'degraded include authorization')
  await degradedPage.keyboard.press('Enter')
  await degradedPage.getByText(/已持久授權 exact canonical include target/, { exact: false }).waitFor({ state: 'visible', timeout: 5_000 })
  await degradedPage.getByText('authorized include body', { exact: true }).waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {})
  assert.equal(await degradedPage.getByText(/unauthorized：include target/, { exact: false }).count(), 0, 'degraded include error clears after Host authorization and refresh')
  assert.equal(await degradedPage.locator('[data-source-id="unauthorized-12"]').count(), 1, 'recovered source remains visible')
  assert.match(await degradedPage.locator('[data-source-id="unauthorized-12"]').innerText(), /effective order 5/)
  assert.equal(await degradedPage.locator('body').evaluate((node) => node.scrollWidth <= window.innerWidth + 1), true, 'degraded recovery remains readable at narrow width')
  await degradedPage.close()
  console.log('personalization UI smoke passed: full Host snapshot metadata, source tree, desktop/narrow pointer and keyboard evidence')
} catch (error) {
  console.error(`[personalization-ui] failure: ${error instanceof Error ? error.message : String(error)}`)
  console.error(`[personalization-ui] trace: ${trace.join(' -> ')}`)
  throw error
} finally {
  if (browser) await bounded('chromium close', browser.close(), 10_000).catch(() => {})
  if (server) await bounded('vite close', server.close(), 10_000).catch(() => {})
}
