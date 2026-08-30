import assert from 'node:assert/strict'

const appRoot = new URL('..', import.meta.url).pathname
const deadline = Date.now() + 60_000
const bounded = async <T,>(stage: string, operation: Promise<T>): Promise<T> => {
  const remaining = Math.max(1_000, deadline - Date.now())
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`${stage} exceeded deadline`)), remaining) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
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
  assert.ok(port > 0)
  browser = await bounded('chromium launch', chromium.launch({ headless: true }))
  const waitForHostProjection = async (page: any, minimumRevision: number) => {
    await page.getByLabel('Host instruction snapshot').waitFor({ state: 'visible', timeout: 10_000 })
    await page.waitForFunction((revision: number) => {
      const marker = document.querySelector<HTMLElement>('[data-projection-ready="true"][data-host-revision]')
      return marker !== null && Number(marker.dataset.hostRevision) >= revision && Boolean(marker.dataset.hostSnapshotId)
    }, minimumRevision, { timeout: 10_000 })
  }

  const runProjectRace = async (query: string, gate: 'get' | 'resolve-result' | 'resolve-error') => {
    const page = await bounded(`${gate} race page`, browser.newPage({ viewport: { width: 900, height: 900 } }))
    await bounded(`${gate} race navigation`, page.goto(`http://127.0.0.1:${port}/scripts/personalization-ui-fixture.html?${query}`, { waitUntil: 'networkidle', timeout: 10_000 }))
    if (gate === 'get') await page.waitForFunction(() => (window as unknown as { __personalizationFixtureLedger: { get: number } }).__personalizationFixtureLedger.get >= 1, undefined, { timeout: 10_000 })
    else await page.waitForFunction(() => (window as unknown as { __personalizationFixtureLedger: { resolve: number } }).__personalizationFixtureLedger.resolve >= 1, undefined, { timeout: 10_000 })
    await page.evaluate((root) => {
      const controls = (window as unknown as { __personalizationFixtureControls: { switchProjectRoot?: (value: string) => void } }).__personalizationFixtureControls
      controls.switchProjectRoot?.(root)
    }, '/tmp/personalization-ui-project-B')
    await page.waitForFunction(() => (window as unknown as { __personalizationFixtureControls: { rootEffect?: string } }).__personalizationFixtureControls.rootEffect === '/tmp/personalization-ui-project-B', undefined, { timeout: 10_000 })
    if (gate === 'get') {
      await page.evaluate(() => {
        const controls = (window as unknown as { __personalizationFixtureControls: { rejectOldGet?: () => void; releaseOldGet?: () => void } }).__personalizationFixtureControls
        controls.rejectOldGet?.()
        controls.releaseOldGet?.()
      })
    }
    await page.getByLabel('Host instruction snapshot').waitFor({ state: 'visible', timeout: 10_000 })
    const freshBody = await page.locator('body').innerText()
    assert.match(freshBody, /personalization-ui-project-B\/AGENTS\.md/)
    assert.doesNotMatch(freshBody, /personalization-ui-project-A\/AGENTS\.md/)
    if (gate !== 'get') {
      await page.evaluate((shouldReject) => {
        const controls = (window as unknown as { __personalizationFixtureControls: { rejectOldResolve?: () => void; releaseOldResolve?: () => void } }).__personalizationFixtureControls
        if (shouldReject) controls.rejectOldResolve?.()
        controls.releaseOldResolve?.()
      }, gate === 'resolve-error')
    }
    await page.waitForTimeout(50)
    const settledBody = await page.locator('body').innerText()
    assert.match(settledBody, /personalization-ui-project-B\/AGENTS\.md/)
    assert.doesNotMatch(settledBody, /personalization-ui-project-A\/AGENTS\.md/)
    assert.doesNotMatch(settledBody, /STALE_OLD_ROOT_(?:GET_)?ERROR/)
    await page.close()
  }
  await runProjectRace('race-get=1', 'get')
  await runProjectRace('race-resolve=1', 'resolve-result')
  await runProjectRace('race-resolve=1', 'resolve-error')

  const typingPage = await bounded('typing page', browser.newPage({ viewport: { width: 280, height: 900 } }))
  await bounded('typing navigation', typingPage.goto(`http://127.0.0.1:${port}/scripts/personalization-ui-fixture.html?typing=1`, { waitUntil: 'networkidle', timeout: 10_000 }))
  await typingPage.getByLabel('Host instruction snapshot').waitFor({ state: 'visible', timeout: 10_000 })
  await typingPage.getByRole('button', { name: '重新掃描' }).click()
  await typingPage.waitForFunction(() => (window as unknown as { __personalizationFixtureControls: { typingGateEntered?: boolean } }).__personalizationFixtureControls.typingGateEntered === true, undefined, { timeout: 10_000 })
  await typingPage.evaluate(() => {
    const editor = document.querySelector<HTMLTextAreaElement>('[aria-label="全域自訂指令"]')
    const about = document.querySelector<HTMLTextAreaElement>('[aria-label="關於你"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(editor, 'LOCAL_TYPED_BEFORE_REFRESH')
    editor?.dispatchEvent(new Event('input', { bubbles: true }))
    setter?.call(about, 'LOCAL_ABOUT_BEFORE_REFRESH')
    about?.dispatchEvent(new Event('input', { bubbles: true }))
    Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('重新掃描'))?.click()
    ;(window as unknown as { __personalizationFixtureControls: { releaseTypingResolve?: () => void } }).__personalizationFixtureControls.releaseTypingResolve?.()
  })
  await typingPage.waitForTimeout(50)
  await typingPage.getByRole('textbox', { name: '全域自訂指令' }).inputValue().then((value) => assert.equal(value, 'LOCAL_TYPED_BEFORE_REFRESH'))
  await typingPage.getByRole('textbox', { name: '關於你' }).inputValue().then((value) => assert.equal(value, 'LOCAL_ABOUT_BEFORE_REFRESH'))
  assert.equal(await typingPage.getByRole('button', { name: '儲存 revision' }).isDisabled(), false, 'typing race must retain dirty draft state after refresh')
  await typingPage.close()

  const triStatePage = await bounded('tri-state page', browser.newPage({ viewport: { width: 900, height: 900 } }))
  await bounded('tri-state navigation', triStatePage.goto(`http://127.0.0.1:${port}/scripts/personalization-ui-fixture.html?tri-state=1`, { waitUntil: 'networkidle', timeout: 10_000 }))
  await waitForHostProjection(triStatePage, 12)
  await triStatePage.evaluate(() => (window as unknown as { __personalizationFixtureControls: { setHostUnset?: () => void } }).__personalizationFixtureControls.setHostUnset?.())
  const unsetRevision = await triStatePage.evaluate(() => (window as unknown as { __personalizationFixtureLedger: { revision: number } }).__personalizationFixtureLedger.revision)
  await triStatePage.getByRole('button', { name: '重新掃描' }).click()
  await waitForHostProjection(triStatePage, unsetRevision)
  assert.equal(await triStatePage.locator('[data-host-revision]').getAttribute('data-host-revision'), String(unsetRevision))
  await triStatePage.getByRole('textbox', { name: '全域自訂指令' }).fill('TEMPORARY_VALUE')
  await triStatePage.getByRole('textbox', { name: '全域自訂指令' }).fill('')
  await triStatePage.getByRole('textbox', { name: '關於你' }).fill('TEMPORARY_ABOUT')
  await triStatePage.getByRole('textbox', { name: '關於你' }).fill('')
  await triStatePage.getByRole('button', { name: '儲存 revision' }).click()
  await triStatePage.getByText('已由 Host transaction commit。新的指令從下一個 Task run 生效。', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 })
  const unsetToBlank = await triStatePage.evaluate(async () => {
    const win = window as unknown as { __personalizationFixtureLedger: { save: unknown[] }; subagents?: { piHost?: { instructions?: { get?: () => Promise<unknown> } } } }
    return { saved: win.__personalizationFixtureLedger.save.at(-1), current: await win.subagents?.piHost?.instructions?.get?.() }
  })
  const unsetToBlankPayload = unsetToBlank.saved as Record<string, unknown>
  assert.equal(unsetToBlankPayload.globalCustomInstructionsPresence, 'blank')
  assert.equal(unsetToBlankPayload.advancedPersonalityInstructionsPresence, 'unset')
  assert.equal(unsetToBlankPayload.aboutUser, '')
  assert.equal('personality' in unsetToBlankPayload, false)
  assert.equal('responseStyle' in unsetToBlankPayload, false)
  assert.equal((unsetToBlank.current as { instructions?: { globalCustomInstructionsPresence?: string } })?.instructions?.globalCustomInstructionsPresence, 'blank')
  await triStatePage.evaluate(() => (window as unknown as { __personalizationFixtureControls: { setHostBlank?: () => void } }).__personalizationFixtureControls.setHostBlank?.())
  const blankRevision = await triStatePage.evaluate(() => (window as unknown as { __personalizationFixtureLedger: { revision: number } }).__personalizationFixtureLedger.revision)
  await triStatePage.getByRole('button', { name: '重新掃描' }).click()
  await waitForHostProjection(triStatePage, blankRevision)
  assert.equal(await triStatePage.locator('[data-host-revision]').getAttribute('data-host-revision'), String(blankRevision))
  await triStatePage.getByRole('textbox', { name: '全域自訂指令' }).fill('LOCAL_BLANK_TEMP')
  await triStatePage.getByRole('textbox', { name: '全域自訂指令' }).fill('')
  await triStatePage.evaluate(() => (window as unknown as { __personalizationFixtureControls: { setHostUnset?: () => void } }).__personalizationFixtureControls.setHostUnset?.())
  const conflictUnsetRevision = await triStatePage.evaluate(() => (window as unknown as { __personalizationFixtureLedger: { revision: number } }).__personalizationFixtureLedger.revision)
  await triStatePage.getByRole('button', { name: '重新掃描' }).click()
  await waitForHostProjection(triStatePage, conflictUnsetRevision)
  const blankToUnsetAlert = triStatePage.getByRole('alert', { name: 'Global instruction conflict' })
  await blankToUnsetAlert.waitFor({ state: 'visible', timeout: 10_000 })
  assert.match(await blankToUnsetAlert.innerText(), /globalCustomInstructions[\s\S]*Host · globalCustomInstructions · unset[\s\S]*本地 · globalCustomInstructions · blank/u)
  await triStatePage.getByRole('button', { name: '以 Host revision 為基底保留草稿' }).click()
  await triStatePage.getByRole('button', { name: '儲存 revision' }).click()
  await triStatePage.getByText('已由 Host transaction commit。新的指令從下一個 Task run 生效。', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 })
  const blankToUnsetPayload = await triStatePage.evaluate(() => (window as unknown as { __personalizationFixtureLedger: { save: unknown[] } }).__personalizationFixtureLedger.save.at(-1)) as Record<string, unknown>
  assert.equal(blankToUnsetPayload.globalCustomInstructionsPresence, 'blank')
  assert.equal(blankToUnsetPayload.advancedPersonalityInstructionsPresence, 'blank')
  assert.equal(blankToUnsetPayload.personality, '')
  assert.equal(blankToUnsetPayload.aboutUser, '')
  assert.equal(blankToUnsetPayload.responseStyle, '')
  await triStatePage.close()

  const conflictPage = await bounded('conflict page', browser.newPage({ viewport: { width: 280, height: 900 } }))
  await bounded('conflict navigation', conflictPage.goto(`http://127.0.0.1:${port}/scripts/personalization-ui-fixture.html?conflict=1`, { waitUntil: 'networkidle', timeout: 10_000 }))
  await conflictPage.getByLabel('Host instruction snapshot').waitFor({ state: 'visible', timeout: 10_000 })
  const editor = conflictPage.getByRole('textbox', { name: '全域自訂指令' })
  const advanced = conflictPage.getByRole('textbox', { name: '進階人格指令' })
  const about = conflictPage.getByRole('textbox', { name: '關於你' })
  const response = conflictPage.getByRole('textbox', { name: '希望如何回覆' })
  const localGlobal = `LOCAL_CONFLICT_GLOBAL_${'g'.repeat(700)}`
  const localAdvanced = `LOCAL_CONFLICT_ADVANCED_${'a'.repeat(700)}`
  const localAbout = `LOCAL_CONFLICT_ABOUT_${'b'.repeat(700)}`
  const localResponse = `LOCAL_CONFLICT_RESPONSE_${'r'.repeat(700)}`
  await editor.fill(localGlobal)
  await advanced.fill(localAdvanced)
  await about.fill(localAbout)
  await response.fill(localResponse)
  await conflictPage.getByRole('combobox', { name: '預設人格' }).selectOption('quirky')
  await conflictPage.evaluate(() => (window as unknown as { __personalizationFixtureControls: { bumpHostAll?: () => void } }).__personalizationFixtureControls.bumpHostAll?.())
  await conflictPage.getByRole('button', { name: '重新掃描' }).click()
  const alert = conflictPage.getByRole('alert', { name: 'Global instruction conflict' })
  await alert.waitFor({ state: 'visible', timeout: 10_000 })
  const conflictText = await alert.innerText()
  for (const value of ['HOST_EXTERNAL_GLOBAL_ALL', 'HOST_EXTERNAL_ADVANCED_ALL', 'HOST_EXTERNAL_ABOUT_ALL', 'HOST_EXTERNAL_RESPONSE_ALL', 'candid', 'LOCAL_CONFLICT_GLOBAL', 'LOCAL_CONFLICT_ADVANCED', 'LOCAL_CONFLICT_ABOUT', 'LOCAL_CONFLICT_RESPONSE', 'quirky']) assert.match(conflictText, new RegExp(value))
  assert.equal(await alert.locator('[data-conflict-field]').count(), 5)
  const regions = alert.locator('[role="region"]')
  assert.equal(await regions.count(), 10)
  for (let index = 0; index < await regions.count(); index += 1) {
    assert.equal(await regions.nth(index).getAttribute('tabindex'), '0')
    assert.ok((await regions.nth(index).getAttribute('aria-label'))?.includes('內容'))
  }
  const firstRegion = alert.locator('[data-conflict-field="global"] [role="region"]').first()
  assert.ok(await firstRegion.evaluate((node) => node.scrollHeight > node.clientHeight), 'long conflict content must remain keyboard-scrollable')
  await firstRegion.focus()
  const scrollBefore = await firstRegion.evaluate((node) => node.scrollTop)
  await firstRegion.press('PageDown')
  const scrollAfter = await firstRegion.evaluate((node) => node.scrollTop)
  assert.ok(scrollAfter > scrollBefore, 'focused conflict region must scroll from keyboard')
  assert.ok(await conflictPage.locator('body').evaluate((node) => node.scrollWidth <= window.innerWidth + 1), 'narrow conflict content must not overflow horizontally')
  await conflictPage.getByRole('button', { name: '載入 Host 版本（捨棄本地草稿）' }).click()
  assert.ok((await editor.inputValue()).startsWith('HOST_EXTERNAL_GLOBAL_ALL'))
  assert.ok((await advanced.inputValue()).startsWith('HOST_EXTERNAL_ADVANCED_ALL'))
  assert.ok((await about.inputValue()).startsWith('HOST_EXTERNAL_ABOUT_ALL'))
  assert.ok((await response.inputValue()).startsWith('HOST_EXTERNAL_RESPONSE_ALL'))
  assert.equal(await conflictPage.getByRole('combobox', { name: '預設人格' }).inputValue(), 'candid')
  const rebasedGlobal = `LOCAL_REBASE_GLOBAL_${'G'.repeat(700)}`
  const rebasedAdvanced = `LOCAL_REBASE_ADVANCED_${'A'.repeat(700)}`
  const rebasedAbout = `LOCAL_REBASE_ABOUT_${'B'.repeat(700)}`
  const rebasedResponse = `LOCAL_REBASE_RESPONSE_${'R'.repeat(700)}`
  await editor.fill(rebasedGlobal)
  await advanced.fill(rebasedAdvanced)
  await about.fill(rebasedAbout)
  await response.fill(rebasedResponse)
  await conflictPage.getByRole('combobox', { name: '預設人格' }).selectOption('efficient')
  await conflictPage.evaluate(() => (window as unknown as { __personalizationFixtureControls: { bumpHostAll?: () => void } }).__personalizationFixtureControls.bumpHostAll?.())
  await conflictPage.getByRole('button', { name: '重新掃描' }).click()
  await conflictPage.getByRole('alert', { name: 'Global instruction conflict' }).waitFor({ state: 'visible', timeout: 10_000 })
  await conflictPage.getByRole('button', { name: '以 Host revision 為基底保留草稿' }).click()
  await conflictPage.getByRole('button', { name: '儲存 revision' }).click()
  await conflictPage.getByText('已由 Host transaction commit。新的指令從下一個 Task run 生效。', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 })
  const saved = await conflictPage.evaluate(async () => window.subagents?.piHost?.instructions?.get?.())
  assert.deepEqual({
    globalCustomInstructions: saved?.instructions?.globalCustomInstructions,
    advancedPersonalityInstructions: saved?.instructions?.advancedPersonalityInstructions,
    personality: saved?.instructions?.personality,
    aboutUser: saved?.instructions?.aboutUser,
    responseStyle: saved?.instructions?.responseStyle,
  }, {
    globalCustomInstructions: rebasedGlobal,
    advancedPersonalityInstructions: rebasedAdvanced,
    personality: 'efficient',
    aboutUser: rebasedAbout,
    responseStyle: rebasedResponse,
  })
  await conflictPage.close()
  console.log('personalization race smoke passed: stale project resolve rejected, dirty Host conflict compared, discard/rebase recovery committed')
} finally {
  if (browser) await bounded('chromium close', browser.close()).catch(() => {})
  if (server) await bounded('vite close', server.close()).catch(() => {})
}
