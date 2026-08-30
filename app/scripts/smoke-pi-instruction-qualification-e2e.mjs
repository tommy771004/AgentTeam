import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ensureElectronExecutable } from './electron-executable.mjs'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distEntry = path.join(appRoot, 'dist', 'index.html')
const mainEntry = path.join(appRoot, 'dist-electron', 'main.js')
const preloadEntry = path.join(appRoot, 'dist-electron', 'preload.cjs')
const piHostEntry = path.join(appRoot, 'dist-electron', 'pi-host.js')
const mainSource = path.join(appRoot, 'electron', 'main.ts')
const preloadSource = path.join(appRoot, 'electron', 'preload.ts')
const piHostEntrySource = path.join(appRoot, 'electron', 'piHostEntry.ts')
const piHostProtocolSource = path.join(appRoot, 'electron', 'piHostProtocol.ts')
const personalizationSource = path.join(appRoot, 'src', 'components', 'settings', 'PersonalizationInstructionsSection.tsx')
const artifactInputs = new Map([
  [distEntry, [personalizationSource]],
  [mainEntry, [mainSource, piHostProtocolSource]],
  [preloadEntry, [preloadSource]],
  [piHostEntry, [piHostEntrySource, piHostProtocolSource]],
])
const shippedBundles = [...artifactInputs.keys()]
if (shippedBundles.some((filePath) => !fs.existsSync(filePath))) throw new Error('Focused Pi instruction E2E requires npm run build:pi-host && npx vite build')
const staleBundles = shippedBundles.filter((filePath) => {
  const artifactMtime = fs.statSync(filePath).mtimeMs
  return artifactInputs.get(filePath).some((sourcePath) => fs.statSync(sourcePath).mtimeMs > artifactMtime)
})
if (staleBundles.length) throw new Error(`Focused Pi instruction E2E refused stale shipped bundle(s): ${staleBundles.map((filePath) => path.relative(appRoot, filePath)).join(', ')}`)

const { _electron: electron } = await import('playwright')
const electronExecutable = ensureElectronExecutable()
const fixtureRoot = path.join(os.tmpdir(), `subagents-ai-pi-instruction-e2e-${process.pid}`)
const userDataDir = path.join(fixtureRoot, 'user-data')
const projectRoot = path.join(fixtureRoot, 'project')
const launcherDir = path.join(fixtureRoot, 'launcher')
fs.rmSync(fixtureRoot, { recursive: true, force: true })
fs.mkdirSync(projectRoot, { recursive: true })
fs.mkdirSync(launcherDir, { recursive: true })
fs.writeFileSync(path.join(projectRoot, 'AGENTS.md'), 'QUALIFIED_PROJECT_SOURCE\n')

const requests = []
const modelServer = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404).end()
    return
  }
  const raw = await new Promise((resolve) => {
    let body = ''
    request.on('data', (part) => { body += part })
    request.on('end', () => resolve(body))
  })
  let parsed = {}
  try { parsed = JSON.parse(raw) } catch {}
  requests.push(parsed)
  const messages = Array.isArray(parsed.messages) ? parsed.messages : []
  const hasToolResult = messages.some((message) => message?.role === 'tool' || message?.tool_call_id)
  const id = `instruction-qualification-${requests.length}`
  const sse = (payload) => `data: ${JSON.stringify(payload)}\n\n`
  const chunk = (delta, finish = null) => sse({
    id,
    object: 'chat.completion.chunk',
    model: 'instruction-qualification-model',
    choices: [{ index: 0, delta, finish_reason: finish }],
  })
  response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
  if (!hasToolResult) {
    response.write(chunk({ role: 'assistant', content: 'QUALIFIED_FIRST_ITERATION' }))
    response.write(chunk({ tool_calls: [{
      index: 0,
      id: 'qualification-read-call',
      type: 'function',
      function: { name: 'bash', arguments: JSON.stringify({ command: 'printf QUALIFIED_TOOL_RESULT' }) },
    }] }))
    response.write(chunk({}, 'tool_calls'))
  } else {
    response.write(chunk({ role: 'assistant', content: 'QUALIFIED_FINAL_ITERATION' }))
    response.write(chunk({}, 'stop'))
  }
  response.end('data: [DONE]\n\n')
})
await new Promise((resolve, reject) => {
  modelServer.once('error', reject)
  modelServer.listen(0, '127.0.0.1', resolve)
})
const modelAddress = modelServer.address()
if (!modelAddress || typeof modelAddress === 'string') throw new Error('qualification model server did not bind')

const piAgentDir = path.join(userDataDir, 'pi-agent')
fs.mkdirSync(piAgentDir, { recursive: true })
fs.writeFileSync(path.join(piAgentDir, 'models.json'), JSON.stringify({
  providers: {
    loopback: {
      baseUrl: `http://127.0.0.1:${modelAddress.port}/v1`,
      api: 'openai-completions',
      apiKey: 'instruction-qualification-key',
      models: [{ id: 'instruction-qualification-model', name: 'Instruction Qualification', reasoning: false, input: ['text'], contextWindow: 128_000 }],
    },
  },
}))
fs.writeFileSync(path.join(piAgentDir, 'settings.json'), JSON.stringify({
  defaultProvider: 'loopback',
  defaultModel: 'instruction-qualification-model',
  defaultThinkingLevel: 'off',
}))
fs.writeFileSync(path.join(launcherDir, 'package.json'), JSON.stringify({ name: 'subagents-ai-pi-instruction-e2e', private: true, type: 'module', main: 'launcher.mjs' }))
fs.writeFileSync(path.join(launcherDir, 'launcher.mjs'), [
  "import { app } from 'electron'",
  `app.setPath('userData', ${JSON.stringify(userDataDir)})`,
  `await import(${JSON.stringify(pathToFileURL(mainEntry).href)})`,
].join('\n'))

const suiteDeadline = Date.now() + 60_000
const deadlineTimeout = () => Math.max(1_000, suiteDeadline - Date.now())
const waitForRun = async (page, knownRunIds) => page.evaluate(async ({ known, timeout }) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const snapshot = await window.subagents?.piHost?.runs?.active?.()
    const all = [...(snapshot?.activeRuns || []), ...(snapshot?.terminalRuns || [])]
    const found = all.find((run) => run?.runId && !known.includes(run.runId))
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Pi Host run admission timed out after ${timeout}ms`)
}, { known: [...knownRunIds], timeout: deadlineTimeout() })
const readRuns = async (page) => page.evaluate(async () => {
  const snapshot = await window.subagents?.piHost?.runs?.active?.()
  return [...(snapshot?.activeRuns || []), ...(snapshot?.terminalRuns || [])]
})
const waitForTurnRecord = async (page, sessionId) => page.evaluate(async ({ id, timeout }) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const result = await window.subagents?.piHost?.sessions?.record?.(id, undefined, 200)
    if (result?.page?.entries?.some((entry) => entry.kind === 'turn-end')) return result
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Turn Record settlement timed out after ${timeout}ms`)
}, { id: sessionId, timeout: deadlineTimeout() })
const app = await electron.launch({
  executablePath: electronExecutable,
  args: [launcherDir, '--no-sandbox', '--disable-gpu'],
  env: { ...process.env, SUBAGENTS_PI_HOST_E2E_USER_DATA_DIR: userDataDir },
  timeout: 30_000,
})
app.process().stderr?.on('data', (chunk) => console.error(`electron stderr: ${chunk}`))
const trace = []
const step = (name) => {
  trace.push(name)
  if (Date.now() >= suiteDeadline) throw new Error(`Pi instruction E2E deadline exceeded at ${name}`)
}

try {
  let page = await app.firstWindow()
  page.setDefaultTimeout(10_000)
  await page.waitForSelector('textarea', { timeout: deadlineTimeout() })
  step('renderer ready')
  const health = await page.evaluate(async () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const status = await window.subagents?.piHost?.status?.().catch(() => ({ state: 'error' }))
      if (status?.state === 'ready') return window.subagents?.piHost?.health?.()
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('Pi Core Host did not become ready')
  })
  assert.equal(health?.status, 'ready', 'shipped Pi Host must be ready before admission')
  await page.evaluate(async ({ baseUrl }) => {
    await window.subagents?.piHost?.settings?.update?.({ provider: 'loopback', model: 'instruction-qualification-model', baseUrl, apiKey: 'instruction-qualification-key', approvalMode: 'full', unattended: true, bashRequireAsk: false, thinkingLevel: 'off' })
  }, { baseUrl: `http://127.0.0.1:${modelAddress.port}/v1` })
  const configured = await page.evaluate(async () => window.subagents?.piHost?.settings?.get?.())
  assert.equal(configured?.settings?.provider, 'loopback', 'real Pi Host must use the loopback qualification provider')
  assert.equal(configured?.settings?.model, 'instruction-qualification-model', 'real Pi Host must use the qualification model')
  await page.evaluate((root) => localStorage.setItem('subagents.project.root.v1', root), projectRoot)
  await page.reload({ waitUntil: 'domcontentloaded', timeout: deadlineTimeout() })
  await page.waitForSelector('textarea', { timeout: deadlineTimeout() })

  await page.evaluate(() => { window.location.hash = '#/settings' })
  await page.getByRole('button', { name: '個人化' }).click()
  const globalEditor = page.getByRole('textbox', { name: '全域自訂指令' })
  await globalEditor.waitFor({ state: 'visible', timeout: deadlineTimeout() })
  await globalEditor.fill('QUALIFIED_GLOBAL_INSTRUCTION')
  await page.getByRole('button', { name: '儲存 revision' }).click()
  await page.getByText('已由 Host transaction commit。新的指令從下一個 Task run 生效。', { exact: true }).waitFor({ state: 'visible', timeout: deadlineTimeout() })
  const saved = await page.evaluate(async () => window.subagents?.piHost?.instructions?.get?.())
  assert.equal(saved?.instructions?.globalCustomInstructions, 'QUALIFIED_GLOBAL_INSTRUCTION', 'UI save must commit through the real Host')
  assert.ok((saved?.instructions?.revision || 0) > 0, 'UI save must publish a revision')
  const canonicalProjectSource = fs.realpathSync(path.join(projectRoot, 'AGENTS.md'))
  step('UI save committed')

  await page.evaluate(() => { window.location.hash = '#/' })
  await page.reload({ waitUntil: 'domcontentloaded', timeout: deadlineTimeout() })
  await page.waitForSelector('.agent-composer-send', { timeout: deadlineTimeout() })
  // Navigation/reload may complete pending Host projection work. Resolve at
  // the last observable pre-admission boundary so the expected provenance is
  // the same snapshot generation the following Task run is required to freeze.
  const resolvedBeforeRun = await page.evaluate(async (root) => window.subagents?.piHost?.instructions?.resolve?.({ projectRoot: root, workPath: root }), projectRoot)
  const admittedEffectiveHash = resolvedBeforeRun?.instructionSnapshot?.effectiveHash
  assert.equal(typeof admittedEffectiveHash, 'string', 'pre-run Host resolve must expose the effective instruction hash')
  const expectedProjectSource = resolvedBeforeRun?.instructionSnapshot?.sources?.find((source) => source.kind === 'project-root' && source.path === canonicalProjectSource)
  assert.ok(expectedProjectSource, 'pre-run Host resolve must expose the canonical project source')
  const beforeRuns = await readRuns(page)
  await page.locator('textarea.composer-field').first().fill('QUALIFIED_CURRENT_REQUEST')
  await page.locator('.agent-composer-send').first().click()
  const attachment = await waitForRun(page, beforeRuns.map((run) => run.runId))
  assert.equal(attachment.status, 'active', 'Task run must be admitted as a real Host run')
  const runId = attachment.runId
  const sessionId = attachment.sessionId
  step('Task run admitted')
  const recordResult = await waitForTurnRecord(page, sessionId)
  assert.equal(requests.length, 2, `provider must receive exactly two loop iterations (got ${requests.length})`)
  const requestMessages = requests.map((request) => Array.isArray(request.messages) ? request.messages : [])
  const request1Text = JSON.stringify(requestMessages[0])
  const request2Text = JSON.stringify(requestMessages[1])
  assert.equal(request1Text.includes('QUALIFIED_GLOBAL_INSTRUCTION'), true, 'request 1 must include the admitted global instruction')
  assert.equal(request1Text.includes('QUALIFIED_PROJECT_SOURCE'), true, 'request 1 must include the admitted project instruction')
  assert.equal(request1Text.includes('QUALIFIED_CURRENT_REQUEST'), true, 'request 1 must include the current user request')
  assert.equal(requestMessages[0].some((message) => message?.role === 'tool' || message?.tool_call_id), false, 'request 1 must precede the tool result')
  assert.equal(request2Text.includes('QUALIFIED_GLOBAL_INSTRUCTION'), true, 'request 2 must retain the frozen global instruction')
  assert.equal(request2Text.includes('QUALIFIED_PROJECT_SOURCE'), true, 'request 2 must retain the frozen project instruction')
  assert.equal(request2Text.includes('QUALIFIED_TOOL_RESULT'), true, 'request 2 must contain the real tool result')
  assert.equal(request2Text.includes('QUALIFIED_CURRENT_REQUEST'), true, 'request 2 must retain the current user request')
  assert.equal(requestMessages[1].some((message) => message?.role === 'tool' || message?.tool_call_id), true, 'request 2 must follow the tool result')
  const textOf = (message) => typeof message?.content === 'string' ? message.content : JSON.stringify(message?.content || '')
  const request1Joined = requestMessages[0].map(textOf).join('\n')
  assert.ok(request1Joined.indexOf('QUALIFIED_GLOBAL_INSTRUCTION') < request1Joined.indexOf('QUALIFIED_CURRENT_REQUEST'), 'request 1 must place global instruction before current request')
  assert.ok(request1Joined.indexOf('QUALIFIED_PROJECT_SOURCE') < request1Joined.indexOf('QUALIFIED_CURRENT_REQUEST'), 'request 1 must place project instruction before current request')
  const entries = recordResult?.page?.entries || []
  const instructionEntry = entries.find((entry) => entry.kind === 'instruction-snapshot')
  assert.ok(instructionEntry, 'Turn Record must include the admitted instruction snapshot')
  assert.equal(instructionEntry.snapshot.effectiveText.includes('QUALIFIED_GLOBAL_INSTRUCTION'), true, 'Turn Record snapshot must preserve the exact committed instruction')
  assert.equal(instructionEntry.snapshot.effectiveText.includes('QUALIFIED_PROJECT_SOURCE'), true, 'Turn Record snapshot must preserve the project instruction')
  const projectSourceEntry = instructionEntry.snapshot.sources.find((source) => source.kind === 'project-root' && source.path === canonicalProjectSource)
  assert.ok(projectSourceEntry, 'Turn Record snapshot must preserve the canonical project source')
  assert.equal(projectSourceEntry.path, expectedProjectSource.path, 'Turn Record project source path must equal the pre-run Host source')
  assert.equal(projectSourceEntry.content, expectedProjectSource.content, 'Turn Record project source content must equal the pre-run Host source')
  assert.equal(projectSourceEntry.hash, expectedProjectSource.hash, 'Turn Record project source hash must equal the pre-run Host source')
  assert.deepEqual(projectSourceEntry, expectedProjectSource, 'Turn Record project source provenance must equal the pre-run Host source entry')
  assert.equal(typeof instructionEntry.snapshot.effectiveHash, 'string', 'Turn Record snapshot must preserve effective hash')
  assert.equal(instructionEntry.snapshot.effectiveHash, admittedEffectiveHash, 'Turn Record snapshot hash must match the immediately pre-run Host-resolved effective hash')
  assert.equal(entries.filter((entry) => entry.kind === 'step-start').length, 1, 'Turn Record must record the Host orchestration step boundary')
  assert.equal(entries.filter((entry) => entry.kind === 'provider-prompt').length, 1, 'Turn Record must record the admitted provider prompt boundary')
  assert.equal(entries.filter((entry) => entry.kind === 'tool-call' && entry.tool === 'bash').length, 1, 'Turn Record must record exactly one model tool call')
  const toolResultEntries = entries.filter((entry) => entry.kind === 'tool-result')
  assert.equal(toolResultEntries.length, 1, 'Turn Record must record exactly one settled tool result')
  const toolCallEntry = entries.find((entry) => entry.kind === 'tool-call' && entry.tool === 'bash')
  assert.equal(toolResultEntries[0].tool, 'bash', 'Turn Record tool result must identify the executed tool')
  assert.equal(toolResultEntries[0].callId, toolCallEntry?.callId, 'Turn Record tool result must close the recorded tool call')
  assert.equal(toolResultEntries[0].settlement, 'success', 'Turn Record tool result must preserve successful Host settlement')
  assert.equal(entries.filter((entry) => entry.kind === 'assistant-text' && entry.content === 'QUALIFIED_FINAL_ITERATION').length, 1, 'Turn Record must preserve the final model iteration')
  assert.equal(entries.filter((entry) => entry.kind === 'user-text' && entry.content === 'QUALIFIED_CURRENT_REQUEST').length, 1, 'Turn Record must preserve the current user text')
  assert.equal(entries.filter((entry) => entry.kind === 'assistant-text' && entry.content === 'QUALIFIED_FIRST_ITERATION').length, 1, 'Turn Record must preserve the first model iteration')
  assert.equal(entries.filter((entry) => entry.kind === 'turn-end').length, 1, 'Turn Record must close the real turn exactly once')
  step('loop and Turn Record verified')

  await app.close()
  const restarted = await electron.launch({ executablePath: electronExecutable, args: [launcherDir, '--no-sandbox', '--disable-gpu'], env: { ...process.env, SUBAGENTS_PI_HOST_E2E_USER_DATA_DIR: userDataDir }, timeout: 30_000 })
  try {
    const replayPage = await restarted.firstWindow()
    await replayPage.waitForSelector('.agent-composer-send', { timeout: deadlineTimeout() })
    const replay = await replayPage.evaluate(async (id) => window.subagents?.piHost?.sessions?.record?.(id, undefined, 200), sessionId)
    const replayEntries = replay?.page?.entries || []
    const replayInstruction = replayEntries.find((entry) => entry.kind === 'instruction-snapshot')
    assert.ok(replayInstruction, 'restart replay must expose the recorded instruction snapshot')
    assert.deepEqual(replayInstruction.snapshot, instructionEntry.snapshot, 'restart replay must preserve the complete instruction snapshot')
    assert.deepEqual(replayEntries, entries, 'restart replay must preserve every normalized Turn Record entry')
    step('restart and replay verified')
  } finally {
    await restarted.close().catch(() => {})
  }
  console.log(`Pi instruction Host E2E passed: UI save -> ${requests.length} provider iterations -> Turn Record -> restart/replay`)
} catch (error) {
  console.error(`Pi instruction E2E failure: ${error instanceof Error ? error.message : String(error)}`)
  console.error(`Pi instruction E2E trace: ${trace.join(' -> ')}`)
  console.error(`Pi instruction E2E provider request count: ${requests.length}`)
  console.error(`Pi instruction E2E provider request roles: ${requests.map((request) => Array.isArray(request.messages) ? request.messages.map((message) => message?.role).join(',') : 'no-messages').join(' | ')}`)
  throw error
} finally {
  await app.close().catch(() => {})
  await new Promise((resolve) => modelServer.close(resolve))
  fs.rmSync(fixtureRoot, { recursive: true, force: true })
}
