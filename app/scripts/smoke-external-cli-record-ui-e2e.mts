import assert from 'node:assert/strict'
console.log('[external-cli-ui-e2e] script:start')

const appRoot = new URL('..', import.meta.url).pathname
const trace: string[] = []
const bounded = async <T>(stage: string, operation: Promise<T>, timeoutMs = 10_000): Promise<T> => {
  trace.push(`${stage}:start`)
  console.log(`[external-cli-ui-e2e] ${stage}:start`)
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
    console.log(`[external-cli-ui-e2e] ${stage}:done`)
  }
}

let server: any
let browser: any
let app: any

const source = (id, scope, status, kind, bytes, hash, path) => ({
  id, kind, scope, path, revision: 4, bytes, includedBytes: status === 'applied' ? bytes : 0,
  droppedBytes: status === 'applied' ? 0 : bytes, hash, applied: status === 'applied',
  deduplicated: status === 'deduplicated', truncated: false, shadowed: status === 'shadowed',
  content: status === 'applied' ? `${id}_BODY` : '',
})
const longCanonicalPath = `/tmp/project-root/${'canonical-segment-'.repeat(8)}${'x'.repeat(80)}.md`
const longAgentsPath = `/tmp/project-root/${'agents-segment-'.repeat(8)}${'y'.repeat(80)}.md`
const snapshot = (mode, exact, rows, hash = 'a'.repeat(64)) => ({
  id: `ui-${mode}`, revision: 4, effectiveHash: hash, effectiveText: 'effective', globalEffectiveText: 'global',
  sources: rows, diagnostics: rows.some((row) => !row.applied) ? [{ code: 'degraded', message: 'source unavailable' }] : [],
  usage: { personalizationBytes: rows.filter((row) => row.scope === 'global' && row.applied).reduce((n, row) => n + row.bytes, 0), projectInstructionBytes: rows.filter((row) => row.scope === 'project' && row.applied).reduce((n, row) => n + row.bytes, 0), totalBytes: rows.filter((row) => row.applied).reduce((n, row) => n + row.bytes, 0), budgetBytes: 1024 },
  deliveryMode: mode, exactSnapshot: exact,
})
const userDataDir = `${process.env.TMPDIR || '/tmp'}/agentteam-cli-record-ui-${process.pid}`
try {
  const [{ createServer }, { default: react }, { default: tailwindcss }, { buildExternalCliRecord }, { projectContextUsage }, { parseTurnRecord }, { chromium }] = await bounded(
    'module imports',
    Promise.all([
      import('vite'),
      import('@vitejs/plugin-react'),
      import('@tailwindcss/vite'),
      import('../src/agent/externalCliRecord.ts'),
      import('../src/agent/contextUsageProjection.ts'),
      import('../src/agent/turnRecord.ts'),
      import('playwright'),
    ]),
  )
  const records = [
    buildExternalCliRecord({ runner: 'builtin', events: [], answer: '', settlement: 'empty', instructionSnapshot: snapshot('explicit', true, [source('explicit-applied', 'global', 'applied', 'global-custom', 16, 'b'.repeat(64), '/tmp/global')]) }),
    buildExternalCliRecord({ runner: 'codex', events: [], answer: '', settlement: 'empty', instructionSnapshot: snapshot('native', false, [source('native-applied', 'global', 'applied', 'global-custom', 14, 'c'.repeat(64), '/tmp/global'), source('native-shadowed', 'project', 'shadowed', 'agents', 18, 'd'.repeat(64), longCanonicalPath)]) }),
    buildExternalCliRecord({ runner: 'gemini', events: [], answer: '', settlement: 'empty', instructionSnapshot: snapshot('unverified', false, [source('unknown-degraded', 'project', 'degraded', 'agents', 21, 'e'.repeat(64), longAgentsPath)], 'f'.repeat(64)) }),
  ]
  const usage = records.flatMap((record) => {
    const live = projectContextUsage(record)
    const replay = projectContextUsage(parseTurnRecord(JSON.parse(JSON.stringify(record))).record)
    assert.deepEqual(replay.instructions, live.instructions, 'replay projection must match live projection')
    return [live, replay]
  })
  // The app Vite config starts Electron watchers; this fixture deliberately
  // compiles only the renderer so setup cannot strand a long-lived worker.
  server = await bounded('vite create', createServer({ configFile: false, root: appRoot, plugins: [react(), tailwindcss()], server: { host: '127.0.0.1', port: 0 } }))
  await bounded('vite listen', server.listen())
  const address = server.httpServer?.address()
  const port = typeof address === 'object' && address ? address.port : 0
  assert.ok(port > 0, 'fixture server must bind an ephemeral loopback port')
  browser = await bounded('chromium launch', chromium.launch({ headless: true }))
  const page = await bounded('newPage', browser.newPage({ viewport: { width: 280, height: 800 } }))
  const payload = encodeURIComponent(JSON.stringify(usage))
  await bounded('fixture navigation', page.goto(`http://127.0.0.1:${port}/scripts/external-cli-record-ui-fixture.html?usage=${payload}`, { waitUntil: 'networkidle', timeout: 10_000 }))
  await bounded('mount ready', page.waitForSelector('[data-testid="usage-0"]', { state: 'visible' }))
  const expectations = [['explicit', ['explicit', 'exact snapshot', 'applied']], ['native', ['native', '未能證明 exact', 'shadowed', 'provider-owned native discovery']], ['unverified', ['unverified', '未能證明 exact', 'degraded', 'provider discovery is unavailable']]]
  for (const [mode, expected] of expectations) {
    const modeIndex = expectations.findIndex(([name]) => name === mode) * 2
    const sections = page.locator(`[data-testid="usage-${modeIndex}"], [data-testid="usage-${modeIndex + 1}"]`)
    assert.equal(await sections.count(), 2, `${mode} live and replay panels are mounted`)
    for (const panel of [0, 1]) {
      const section = sections.nth(panel)
      await bounded(`${mode} ${panel === 0 ? 'live' : 'replay'} visible`, section.waitFor({ state: 'visible', timeout: 5_000 }))
      const text = await section.innerText()
      for (const fragment of expected) assert.ok(text.includes(fragment), `${mode} ${panel} UI shows ${fragment}`)
      assert.equal(await section.locator('details').count(), 0, `${mode} ${panel} is not hidden behind details`)
      assert.equal(await section.locator('[aria-hidden="true"]').count(), 0, `${mode} ${panel} evidence is not aria-hidden`)
      assert.equal(await section.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true, `${mode} ${panel} fits narrow viewport`)
      assert.equal(await section.locator('li').evaluateAll((items) => items.every((item) => { const r = item.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth + 1 })), true, `${mode} ${panel} source rows are not clipped`)
    }
  }
  console.log('external CLI record/UI Electron fixture passed: live/replay evidence rendered visibly at narrow width without expansion')
} catch (error) {
  console.error(`[external-cli-ui-e2e] failure: ${error instanceof Error ? error.message : String(error)}`)
  console.error(`[external-cli-ui-e2e] trace: ${trace.join(' -> ')}`)
  throw error
} finally {
  if (app) await bounded('electron close', app.close(), 10_000).catch(() => {})
  if (browser) await bounded('chromium close', browser.close(), 10_000).catch(() => {})
  const { rm } = await import('node:fs/promises')
  await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  await bounded('vite close', server.close(), 10_000).catch(() => {})
}
