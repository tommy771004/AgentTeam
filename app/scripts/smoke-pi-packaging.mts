import { strict as assert } from 'node:assert'
import { once } from 'node:events'
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

type PackageJson = {
  build?: {
    extraResources?: Array<{ from?: string; to?: string }>
    mac?: { target?: unknown }
    win?: { target?: unknown }
  }
}

type HostMessage = {
  id?: number
  result?: { sessionId?: string; sessions?: Array<{ id?: string }> }
  error?: { message?: string }
}

const appRoot = resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(await readFile(resolve(appRoot, 'package.json'), 'utf8')) as PackageJson
const piResource = packageJson.build?.extraResources?.find((resource) => resource.from === '../vendor/pi')
assert.deepEqual(piResource, { from: '../vendor/pi', to: 'vendor/pi' })
const piDependenciesResource = packageJson.build?.extraResources?.find((resource) => resource.from === '../vendor/pi/node_modules')
assert.deepEqual(piDependenciesResource, { from: '../vendor/pi/node_modules', to: 'vendor/pi/node_modules' })
assert.ok(packageJson.build?.mac?.target, 'macOS package target is required')

// The MAIN process resolves the vendored Pi barrel through piVendor.ts, whose
// candidates must survive packaging: a packaged app launches with cwd === '/',
// so a release that only knew cwd-relative paths crashed importing
// /vendor/pi/... (2026-08-26 release defect). Guard the anchors, not the prose.
const vendorResolverSource = await readFile(resolve(appRoot, 'electron/piVendor.ts'), 'utf8')
for (const required of [
  /process\.resourcesPath/,
  /import\.meta\.url/,
  /resolve\(moduleDir, '\.\.\/\.\.\/vendor\/pi'\)/,
]) {
  assert.match(vendorResolverSource, required, `piVendor.ts must keep a packaging-safe vendor candidate: ${required}`)
}
assert.ok(packageJson.build?.win?.target, 'Windows package target is required')

const artifact = resolve(appRoot, 'dist-electron/pi-host.js')
const vendor = resolve(appRoot, '../vendor/pi')
for (const relative of [
  'packages/ai/dist/index.js',
  'packages/agent/dist/index.js',
  'packages/coding-agent/dist/index.js',
  'packages/coding-agent/dist/config.js',
]) {
  assert.ok(existsSync(join(vendor, relative)), `missing Pi vendor build artifact: ${relative}; run npm run build:pi-vendor`)
}
const temporaryRoot = await mkdtemp(join(tmpdir(), 'pi-packaging-'))
const sharedVendor = join(temporaryRoot, 'shared-vendor', 'pi')
await cp(vendor, sharedVendor, { recursive: true, force: true })

async function hostRound(label: string, hostEntry: string, vendorDir: string, statePath: string): Promise<void> {
  const start = () => spawn(process.execPath, [hostEntry], {
    cwd: resolve(hostEntry, '..'),
    env: { ...process.env, SUBAGENTS_PI_HOST_STATE_PATH: statePath, SUBAGENTS_PI_VENDOR_DIR: vendorDir },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const client = (host: ReturnType<typeof start>) => {
    const output = createInterface({ input: host.stdout })
    const messages: HostMessage[] = []
    output.on('line', (line) => messages.push(JSON.parse(line) as HostMessage))
    return {
      close: () => output.close(),
      request: async (id: number, method: string, params: Record<string, unknown>) => {
        host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
        for (;;) {
          const message = messages.find((candidate) => candidate.id === id)
          if (message) {
            if (message.error) throw new Error(`${label}: ${message.error.message || 'Host request failed'}`)
            return message
          }
          await once(output, 'line')
        }
      },
    }
  }
  const first = start()
  const firstClient = client(first)
  const initialized = await firstClient.request(1, 'initialize', { protocolVersion: 2 })
  assert.equal(initialized.result?.sessionId, undefined)
  const created = await firstClient.request(2, 'sessions/create', { title: `${label} packaged session` })
  const sessionId = created.result?.sessionId
  assert.ok(sessionId)
  first.stdin.end()
  await once(first, 'exit')
  firstClient.close()

  const restarted = start()
  const restartedClient = client(restarted)
  await restartedClient.request(3, 'initialize', { protocolVersion: 2 })
  const listed = await restartedClient.request(4, 'sessions/list', {})
  assert.ok(listed.result?.sessions?.some((session) => session.id === sessionId), `${label}: session did not survive restart`)
  restarted.stdin.end()
  await once(restarted, 'exit')
  restartedClient.close()
}

try {
  const macResources = join(temporaryRoot, 'mac', 'SubAgents AI.app', 'Contents', 'Resources')
  const winResources = join(temporaryRoot, 'win', 'resources')
  // electron-builder places the main/utility-process bundle under app.asar;
  // extraResources keeps vendor/pi outside the archive for native/runtime loads.
  const macHost = join(macResources, 'app.asar', 'dist-electron', 'pi-host.js')
  const winHost = join(winResources, 'app.asar', 'dist-electron', 'pi-host.js')
  await mkdir(join(macHost, '..'), { recursive: true })
  await mkdir(join(winHost, '..'), { recursive: true })
  await cp(artifact, macHost, { recursive: true, force: true })
  await cp(artifact, winHost, { recursive: true, force: true })
  const macState = join(temporaryRoot, 'mac-state.json')
  const winState = join(temporaryRoot, 'win-state.json')
  await hostRound('macOS', macHost, sharedVendor, macState)
  await hostRound('Windows', winHost, sharedVendor, winState)
  console.log('Packaged macOS and Windows resource layouts launch Pi Host and preserve sessions')
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
