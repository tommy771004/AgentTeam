import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import {
  bindWorkspaceTextSearchRun,
  resolveWorkspaceTextSearchAvailability,
  unbindWorkspaceTextSearchRun,
  workspaceTextSearchAvailability,
} from '../electron/piWorkspaceTextSearchRuntime.ts'
import { resolveWorkspaceSearchBase } from '../electron/piExtensionPacks/workspaceTextSearch.ts'
import { pagedText } from '../electron/piExtensionPacks/utility.ts'

let passed = 0
const test = async (name: string, fn: () => void | Promise<void>) => {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

function source(relative: string): string {
  return readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')
}

console.log('smoke-workspace-text-search')

await test('renderer setting contract has an explicit false default and General UI owner', () => {
  const types = source('src/agent/types.ts')
  const defaults = source('src/agent/llm.ts')
  const settingsPage = source('src/pages/SettingsPage.tsx')
  const preload = source('electron/preload.ts')
  const production = source('src/agent/piProduction.ts')
  const settingsStore = source('src/store/settingsStore.ts')

  assert.match(types, /workspaceTextSearch:\s*boolean/)
  assert.match(defaults, /workspaceTextSearch:\s*false/)
  assert.match(settingsPage, /section === 'general'[\s\S]*title="工作區文字檢索"/)
  assert.match(settingsPage, /開啟後模型才會取得 workspace_grep \/ workspace_glob 搜尋工具/)
  assert.match(settingsPage, /checked=\{settings\.workspaceTextSearch === true\}/)
  assert.match(production, /workspaceTextSearch:\s*'workspaceTextSearch'/)
  assert.match(settingsStore, /workspaceTextSearch:\s*pi\.workspaceTextSearch === true/, 'explicit Pi sync projects the Host setting')
  assert.match(settingsStore, /workspaceTextSearch:\s*pi\.settings\.workspaceTextSearch === true/, 'startup hydration projects the persisted Host setting')
  assert.match(preload, /workspaceTextSearch\?: boolean/, 'renderer bridge carries the Host setting type')
})

await test('source drift guard pins the single Host gate and run_code re-entry', () => {
  const index = source('electron/piExtensionPacks/index.ts')
  const protocol = source('electron/piHostProtocol.ts')
  const pack = source('electron/piExtensionPacks/workspaceTextSearch.ts')

  assert.match(index, /ensureWorkspaceTextSearchPackRegistered\(\)/)
  assert.match(protocol, /bindWorkspaceTextSearchRun\(sessionId/)
  assert.match(protocol, /\.filter\(\(entry\) => workspaceTextSearch\.available \|\| !isWorkspaceTextSearchTool\(entry\.name\)\)/)
  assert.match(protocol, /if \(isWorkspaceTextSearchTool\(name\)\)/)
  assert.match(protocol, /\.filter\(\(tool\) => gate\.available \|\| !isWorkspaceTextSearchTool\(tool\.name\)\)/)
  assert.match(protocol, /nestedRequest\[INTERNAL_INVOCATION_ORIGIN\] = 'code-mode'/)
  assert.match(protocol, /handlePiHostRequest\(state, nestedRequest, emit\)/)
  assert.match(pack, /workspaceTextSearchAvailability\(/)
})

await test('truncated paged output exposes its outputId to the model', () => {
  const result = pagedText('abcdefghijklmnopqrstuvwxyz', 10, { sessionId: 'smoke', runId: 'run-paged-output', cwd: tmpdir() })
  const outputId = String(result.details.outputId || '')
  assert.ok(outputId)
  assert.match(result.content[0]?.text || '', new RegExp(outputId))
})

const workspace = await mkdtemp(join(tmpdir(), 'workspace-text-search-'))
const outside = await mkdtemp(join(tmpdir(), 'workspace-text-search-outside-'))
await mkdir(join(workspace, 'src'), { recursive: true })
await mkdir(join(workspace, '.git'), { recursive: true })
await mkdir(join(workspace, 'node_modules', 'pkg'), { recursive: true })
await writeFile(join(workspace, 'src', 'answer.ts'), 'export const needle = 42\n')
await writeFile(join(workspace, 'src', 'many.ts'), 'needle one\nneedle two\n')
await writeFile(join(workspace, 'src', 'huge.ts'), `${'x'.repeat(2 * 1024 * 1024 + 128)}\nneedle\n`)
await writeFile(join(workspace, '.git', 'secret.ts'), 'needle\n')
await writeFile(join(workspace, 'node_modules', 'pkg', 'secret.ts'), 'needle\n')
await writeFile(join(outside, 'outside.ts'), 'needle\n')

try {
  await test('setting defaults fail closed', () => {
    assert.equal(resolveWorkspaceTextSearchAvailability({ enabled: false, workspaceRoot: workspace }).available, false)
  })

  await test('ON still requires an explicit valid workspace', () => {
    assert.equal(resolveWorkspaceTextSearchAvailability({ enabled: true }).available, false)
    assert.equal(resolveWorkspaceTextSearchAvailability({ enabled: true, workspaceRoot: join(workspace, 'missing') }).available, false)
  })

  await test('run admission freezes both OFF and ON decisions', () => {
    const frozenOff = bindWorkspaceTextSearchRun('s0', { runId: 'r0', enabled: false, workspaceRoot: workspace })
    assert.equal(frozenOff.available, false)
    assert.equal(workspaceTextSearchAvailability({ sessionId: 's0', enabled: true, workspaceRoot: workspace }).available, false,
      'mid-run Settings ON must not open an admitted OFF run')
    unbindWorkspaceTextSearchRun('s0', 'r0')

    const frozenOn = bindWorkspaceTextSearchRun('s1', { runId: 'r1', enabled: true, workspaceRoot: workspace })
    assert.equal(frozenOn.available, true)
    assert.equal(workspaceTextSearchAvailability({ sessionId: 's1', enabled: false }).available, true,
      'mid-run Settings OFF must not close an admitted ON run')
    assert.equal(workspaceTextSearchAvailability({ sessionId: 's1', enabled: true, workspaceRoot: outside }).available, false,
      'an admitted run cannot swap roots')
    unbindWorkspaceTextSearchRun('s1', 'r1')
    assert.equal(workspaceTextSearchAvailability({ sessionId: 's1', enabled: false, workspaceRoot: workspace }).available, false)
  })

  await test('base traversal fails closed before the search helper', () => {
    const escaped = resolveWorkspaceSearchBase(workspace, '..')
    assert.equal(escaped.ok, false)
    const scoped = resolveWorkspaceSearchBase(workspace, 'src')
    assert.equal(scoped.ok, true)
  })

  const hostBundle = resolve(import.meta.dirname, '../dist-electron/pi-host.js')
  if (!existsSync(hostBundle)) {
    throw new Error('dist-electron/pi-host.js is missing; run npm run build:pi-host before this smoke')
  }

  type Message = {
    id?: number
    event?: string
    payload?: Record<string, any>
    result?: Record<string, any>
    error?: { code: string; message: string }
  }
  const stateDir = await mkdtemp(join(tmpdir(), 'workspace-text-search-state-'))
  const agentDir = await mkdtemp(join(tmpdir(), 'workspace-text-search-agent-'))
  let pendingScript: { tool: string; args: Record<string, unknown> } | undefined
  const modelRequests: unknown[] = []
  const modelServer = createServer(async (request, response) => {
    if (request.url !== '/v1/chat/completions' || request.method !== 'POST') {
      response.writeHead(404).end()
      return
    }
    let requestBody = ''
    request.on('data', (chunk) => { requestBody += String(chunk) })
    await once(request, 'end')
    modelRequests.push(JSON.parse(requestBody))
    const chunk = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({
      id: 'workspace-text-search',
      object: 'chat.completion.chunk',
      model: 'smoke-model',
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      connection: 'keep-alive',
      'cache-control': 'no-cache',
    })
    if (pendingScript) {
      const script = pendingScript
      pendingScript = undefined
      response.write(chunk({ role: 'assistant', content: '執行工作區搜尋。' }, null))
      response.write(chunk({ tool_calls: [{
        index: 0,
        id: `call_${script.tool}`,
        type: 'function',
        function: { name: script.tool, arguments: JSON.stringify(script.args) },
      }] }, null))
      response.write(chunk({}, 'tool_calls'))
    } else {
      response.write(chunk({ role: 'assistant', content: 'ready' }, null))
      response.write(chunk({}, 'stop'))
    }
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>((done) => modelServer.listen(0, '127.0.0.1', done))
  const modelAddress = modelServer.address()
  if (!modelAddress || typeof modelAddress === 'string') throw new Error('model fixture did not bind')
  await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { loopback: {
    baseUrl: `http://127.0.0.1:${modelAddress.port}/v1`,
    api: 'openai-completions',
    models: [{ id: 'smoke-model', name: 'Smoke', reasoning: false, input: ['text'], contextWindow: 128_000 }],
  } } }))
  await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ loopback: { type: 'api_key', key: 'smoke' } }))
  await writeFile(join(agentDir, 'settings.json'), JSON.stringify({
    defaultProvider: 'loopback',
    defaultModel: 'smoke-model',
    defaultThinkingLevel: 'off',
  }))
  const host = spawn(process.execPath, [hostBundle], {
    env: {
      ...process.env,
      SUBAGENTS_PI_HOST_STATE_PATH: join(stateDir, 'state.json'),
      SUBAGENTS_PI_AGENT_DIR: agentDir,
    },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const lines = createInterface({ input: host.stdout })
  const messages: Message[] = []
  lines.on('line', (line) => {
    try { messages.push(JSON.parse(line) as Message) } catch { /* test reports timeout */ }
  })
  const hostExited = new Promise<void>((resolveExit) => host.once('exit', () => resolveExit()))
  const turnProfile = {
    provider: 'loopback',
    model: 'smoke-model',
    thinkingLevel: 'off',
    activeTools: [],
    compaction: 'manual',
    approvalMode: 'full',
    unattended: false,
  } as const
  let activeRunId: string | undefined
  const send = (id: number, method: string, params: Record<string, unknown> = {}) => {
    if (host.exitCode !== null || host.stdin.destroyed || host.stdin.writableEnded) return false
    return host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  }
  const wait = async (id: number, timeoutMs = 25_000) => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const found = messages.find((message) => message.id === id)
      if (found) return found
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new Error(`timeout waiting for Host id ${id}: ${JSON.stringify(messages.slice(-5))}`)
      await new Promise<void>((resolveLine, reject) => {
        let timer: NodeJS.Timeout
        const onLine = () => {
          clearTimeout(timer)
          lines.off('line', onLine)
          resolveLine()
        }
        timer = setTimeout(() => {
          lines.off('line', onLine)
          reject(new Error(`timeout waiting for Host id ${id}: ${JSON.stringify(messages.slice(-5))}`))
        }, remaining)
        lines.once('line', onLine)
      })
    }
  }

  try {
    send(1, 'initialize', { protocolVersion: 4 })
    assert.equal((await wait(1)).error, undefined)

    send(2, 'settings/update', { ...turnProfile, workspaceTextSearch: false })
    const offSettings = await wait(2)
    assert.equal(offSettings.error, undefined)
    assert.equal(offSettings.result?.settings?.provider, turnProfile.provider)
    assert.equal(offSettings.result?.settings?.model, turnProfile.model)
    assert.equal(offSettings.result?.settings?.thinkingLevel, turnProfile.thinkingLevel)
    assert.deepEqual(offSettings.result?.settings?.activeTools, turnProfile.activeTools)
    assert.equal(offSettings.result?.settings?.compaction, turnProfile.compaction)
    assert.equal(offSettings.result?.settings?.approvalMode, turnProfile.approvalMode)
    assert.equal(offSettings.result?.settings?.unattended, turnProfile.unattended)
    assert.equal(offSettings.result?.settings?.workspaceTextSearch, false)

    send(3, 'tools/list', { cwd: workspace })
    const offCatalog = (await wait(3)).result?.catalog || []
    await test('OFF removes both tools from the Host catalog', () => {
      assert.equal(offCatalog.some((entry: any) => entry.name === 'workspace_grep' || entry.name === 'workspace_glob'), false)
    })

    send(4, 'capabilities/search', { query: 'workspace-text-search', cwd: workspace })
    await test('OFF capability search cannot discover the pack', async () => {
      const response = await wait(4)
      assert.equal(response.error, undefined)
      assert.deepEqual(response.result?.items || [], [])
    })

    send(5, 'tools/pack', { name: 'workspace_glob', cwd: workspace, arguments: { pattern: '**/*.ts' } })
    await test('OFF direct execution is denied', async () => {
      const response = await wait(5)
      assert.ok(response.error)
      assert.match(String(response.error?.message || ''), /工作區文字檢索/)
    })

    send(6, 'settings/update', { ...turnProfile, workspaceTextSearch: true })
    const onSettings = await wait(6)
    assert.equal(onSettings.error, undefined)
    assert.equal(onSettings.result?.settings?.provider, turnProfile.provider)
    assert.equal(onSettings.result?.settings?.model, turnProfile.model)
    assert.equal(onSettings.result?.settings?.thinkingLevel, turnProfile.thinkingLevel)
    assert.deepEqual(onSettings.result?.settings?.activeTools, turnProfile.activeTools)
    assert.equal(onSettings.result?.settings?.compaction, turnProfile.compaction)
    assert.equal(onSettings.result?.settings?.approvalMode, turnProfile.approvalMode)
    assert.equal(onSettings.result?.settings?.unattended, turnProfile.unattended)
    assert.equal(onSettings.result?.settings?.workspaceTextSearch, true)

    send(7, 'tools/list', { cwd: workspace })
    const onCatalog = (await wait(7)).result?.catalog || []
    await test('ON + workspace exposes grep and glob', () => {
      assert.ok(onCatalog.some((entry: any) => entry.name === 'workspace_grep'))
      assert.ok(onCatalog.some((entry: any) => entry.name === 'workspace_glob'))
    })

    send(8, 'tools/pack', {
      name: 'workspace_glob',
      cwd: workspace,
      arguments: { pattern: '**/*.ts', maxResults: 50 },
    })
    await test('workspace_glob skips .git and node_modules', async () => {
      const response = await wait(8)
      assert.equal(response.error, undefined)
      const files = [...(response.result?.item?.files || [])].sort()
      assert.deepEqual(files, ['src/answer.ts', 'src/huge.ts', 'src/many.ts'])
      assert.equal(response.result?.item?.truncated, false)
      assert.match(String(response.result?.content?.[0]?.text || ''), /src\/answer\.ts/)
    })

    send(9, 'tools/pack', {
      name: 'workspace_grep',
      cwd: workspace,
      arguments: { query: 'needle', glob: '**/*.ts', maxResults: 50 },
    })
    await test('workspace_grep returns structured line matches and skips oversized/ignored files', async () => {
      const response = await wait(9)
      assert.equal(response.error, undefined)
      const data = response.result?.item || {}
      const paths = new Set((data.matches || []).map((match: any) => match.path))
      assert.ok(paths.has('src/answer.ts'))
      assert.ok(paths.has('src/many.ts'))
      assert.equal(paths.has('src/huge.ts'), false, 'files over 2 MiB are skipped')
      assert.equal(paths.has('.git/secret.ts'), false)
      assert.equal(paths.has('node_modules/pkg/secret.ts'), false)
      const answer = (data.matches || []).find((match: any) => match.path === 'src/answer.ts')
      assert.equal(answer?.line, 1)
      assert.equal(answer?.text, 'export const needle = 42')
      assert.match(String(response.result?.content?.[0]?.text || ''), /src\/answer\.ts:1 export const needle = 42/)
    })

    send(10, 'tools/pack', {
      name: 'workspace_grep',
      cwd: workspace,
      arguments: { query: 'needle', glob: '**/*.ts', maxResults: 1 },
    })
    await test('workspace_grep truncates at the requested result ceiling', async () => {
      const response = await wait(10)
      assert.equal(response.error, undefined)
      assert.equal(response.result?.item?.matches?.length, 1)
      assert.equal(response.result?.item?.truncated, true)
    })

    send(11, 'tools/pack', {
      name: 'workspace_glob',
      cwd: workspace,
      arguments: { pattern: '**/*', base: '..' },
    })
    await test('workspace traversal is rejected', async () => {
      const response = await wait(11)
      assert.equal(response.error, undefined)
      assert.equal(response.result?.item?.ok, false)
      assert.match(String(response.result?.item?.error || ''), /outside|workspace|base/i)
    })

    send(12, 'tools/list', {})
    await test('ON without workspace still hides the tools', async () => {
      const response = await wait(12)
      const catalog = response.result?.catalog || []
      assert.equal(catalog.some((entry: any) => entry.name === 'workspace_grep' || entry.name === 'workspace_glob'), false)
    })

    send(13, 'tools/pack', { name: 'workspace_grep', arguments: { query: 'needle' } })
    await test('direct execution never falls back to process.cwd()', async () => {
      const response = await wait(13)
      assert.ok(response.error)
      assert.match(String(response.error?.message || ''), /工作區|workspace|cwd/i)
    })

    send(14, 'tools/pack', {
      name: 'workspace_grep',
      cwd: workspace,
      arguments: { query: '[' },
    })
    await test('invalid regex is an honest failure, not an empty result', async () => {
      const response = await wait(14)
      assert.equal(response.error, undefined)
      assert.equal(response.result?.item?.ok, false)
      assert.match(String(response.result?.item?.error || ''), /invalid regex/i)
    })

    send(15, 'sessions/create', { title: 'Workspace nested gate' })
    const sessionId = String((await wait(15)).result?.sessionId || '')
    assert.ok(sessionId)
    pendingScript = {
      tool: 'run_code',
      args: { code: "return await tools.workspace_glob({ pattern: 'src/**/*.ts' })" },
    }
    send(16, 'turn/submit', {
      sessionId,
      runId: 'workspace-contract',
      cwd: workspace,
      prompt: '建立搜尋工具 contract',
      preloadedCapabilities: ['workspace-text-search'],
      // Do not pin activeTools here: this run tests capability preload and
      // must keep run_code available for the nested call.
      profile: {
        provider: turnProfile.provider,
        model: turnProfile.model,
        thinkingLevel: turnProfile.thinkingLevel,
        compaction: turnProfile.compaction,
        approvalMode: turnProfile.approvalMode,
        unattended: turnProfile.unattended,
      },
    })
    activeRunId = 'workspace-contract'
    assert.equal((await wait(16)).error, undefined)
    activeRunId = undefined
    await test('run_code nested call executes workspace search inside an admitted ON run', () => {
      const nestedResult = messages.find((message) =>
        message.event === 'host/record-append'
        && message.payload?.runId === 'workspace-contract'
        && (message.payload?.entries || []).some((entry: Record<string, unknown>) =>
          entry.kind === 'tool-result'
          && entry.tool === 'workspace_glob'
          && entry.settlement === 'success'))
      if (!nestedResult) console.error('DEBUG model requests', modelRequests.length, JSON.stringify(messages.filter((message) => message.payload?.runId === 'workspace-contract').slice(-5), null, 2))
      assert.ok(nestedResult, 'nested workspace_glob must record Host-issued success evidence')
      const codeResult = messages.find((message) =>
        message.event === 'host/turn-item'
        && message.payload?.runId === 'workspace-contract'
        && message.payload?.item?.type === 'tool_execution_end'
        && message.payload?.item?.toolName === 'run_code')
      assert.match(String(codeResult?.payload?.item?.result?.content?.[0]?.text || ''), /workspace_glob 找到 3 個檔案/)
    })

    pendingScript = {
      tool: 'workspace_grep',
      args: { query: 'needle', glob: 'src/**/*.ts', maxResults: 20 },
    }
    send(17, 'turn/submit', {
      sessionId,
      runId: 'workspace-model-visible',
      cwd: workspace,
      prompt: '找出 needle 的檔案與行號',
      preloadedCapabilities: ['workspace-text-search'],
      // Keep the profile open so the preloaded capability is model-visible.
      profile: {
        provider: turnProfile.provider,
        model: turnProfile.model,
        thinkingLevel: turnProfile.thinkingLevel,
        compaction: turnProfile.compaction,
        approvalMode: turnProfile.approvalMode,
        unattended: turnProfile.unattended,
      },
    })
    activeRunId = 'workspace-model-visible'
    assert.equal((await wait(17)).error, undefined)
    activeRunId = undefined
    await test('workspace_grep path, line, and snippet reach the model context', () => {
      const serialized = modelRequests.map((request) => JSON.stringify(request)).join('\n')
      assert.match(serialized, /src\/answer\.ts:1[^\n]*export const needle = 42/)
    })

    send(18, 'settings/update', { workspaceTextSearch: false })
    const offAgain = await wait(18)
    assert.equal(offAgain.error, undefined)
    assert.equal(offAgain.result?.settings?.provider, turnProfile.provider)
    assert.equal(offAgain.result?.settings?.model, turnProfile.model)
    assert.equal(offAgain.result?.settings?.thinkingLevel, turnProfile.thinkingLevel)
    assert.deepEqual(offAgain.result?.settings?.activeTools, turnProfile.activeTools)
    assert.equal(offAgain.result?.settings?.compaction, turnProfile.compaction)
    assert.equal(offAgain.result?.settings?.approvalMode, turnProfile.approvalMode)
    assert.equal(offAgain.result?.settings?.unattended, turnProfile.unattended)
    assert.equal(offAgain.result?.settings?.workspaceTextSearch, false)
    send(19, 'tools/code', {
      cwd: workspace,
      sessionId,
      runId: 'workspace-nested-off',
      approval: 'allow',
      code: "return await tools.workspace_glob({ pattern: 'src/**/*.ts' })",
    })
    await test('run_code nested call re-enters the OFF gate', async () => {
      const response = await wait(19)
      assert.equal(response.error, undefined)
      assert.equal(response.result?.settlement, 'failed')
      assert.match(String(response.result?.content?.[0]?.text || ''), /工作區文字檢索|workspace/i)
    })
    assert.equal(messages.some((message) => message.event === 'host/approval-requested'), false,
      'workspace search turns must not request approval with the acknowledged profile')
  } finally {
    if (activeRunId) {
      send(90, 'turn/cancel', { runId: activeRunId })
      await wait(90, 2_000).catch(() => undefined)
    }
    if (host.exitCode === null && !host.stdin.destroyed) host.stdin.end()
    if (host.exitCode === null) {
      await Promise.race([hostExited, new Promise((resolveExit) => setTimeout(resolveExit, 4_000))])
      if (host.exitCode === null) host.kill()
      await Promise.race([hostExited, new Promise((resolveExit) => setTimeout(resolveExit, 2_000))])
      if (host.exitCode === null) host.kill('SIGKILL')
    }
    lines.close()
    await new Promise<void>((done) => modelServer.close(() => done()))
    modelServer.closeAllConnections()
    await rm(stateDir, { recursive: true, force: true })
    await rm(agentDir, { recursive: true, force: true })
  }
} finally {
  await rm(workspace, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
}

console.log(`\n${passed} tests passed`)
