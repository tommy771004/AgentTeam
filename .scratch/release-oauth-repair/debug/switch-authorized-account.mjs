// One-off, explicitly user-authorized release account recovery. Never logs credentials.
import { readFile, writeFile, mkdir, copyFile, chmod, rename, lstat } from 'node:fs/promises'
import { execFileSync, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { bootstrapPiUserConfig } from '../../../app/electron/piUserConfig.ts'

const root = '/Users/xieyuanyou/Library/Application Support/SubAgents AI'
const bundle = '/Users/xieyuanyou/Downloads/AgentStudio.app/Contents'
const cliPath = '/Users/xieyuanyou/.codex/auth.json'
const agentDir = path.join(root, 'pi-agent')
const authPath = path.join(agentDir, 'auth.json')
const snapshotPath = path.join(root, 'pi-host-state.json/snapshot.json')
const check = (ok, label) => { if (!ok) throw new Error(label) }
const json = async (file) => JSON.parse(await readFile(file, 'utf8'))
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const stopped = () => check(!execFileSync('ps', ['-axo', 'comm'], { encoding: 'utf8' }).split('\n').some((line) => line.includes('/AgentStudio.app/')), 'Release app must be closed')
stopped()
for (const file of [authPath, snapshotPath, cliPath]) check((await lstat(file)).isFile(), 'Expected a regular data file')
const cliBefore = await readFile(cliPath)
const cli = JSON.parse(cliBefore)
check(cli.tokens?.access_token && cli.tokens?.refresh_token && cli.tokens?.account_id, 'Current CLI OAuth login is incomplete')
const originalAuth = await json(authPath)
const originalSnapshot = await json(snapshotPath)
const backup = path.join(root, 'recovery-backups', `oauth-account-switch-${new Date().toISOString().replaceAll(':', '-')}`)
await mkdir(backup, { recursive: true, mode: 0o700 })
await chmod(backup, 0o700)
for (const [source, name] of [[authPath, 'auth.before.json'], [snapshotPath, 'snapshot.before.json']]) {
  await copyFile(source, path.join(backup, name))
  await chmod(path.join(backup, name), 0o600)
}
console.log(JSON.stringify({ phase: 'backup', directory: backup, previousProvider: originalSnapshot.settings?.provider, previousModel: originalSnapshot.settings?.model }))
// Use the production importer in a private staging directory, then replace only the authorized provider.
const staging = path.join(backup, 'staged-current-account')
Object.assign(process.env, {
  SUBAGENTS_PI_AGENT_DIR: staging,
  SUBAGENTS_PI_NATIVE_AGENT_DIR: path.join(backup, 'absent-native'),
  SUBAGENTS_CODEX_AUTH_PATH: cliPath,
  SUBAGENTS_CLAUDE_CREDENTIALS_PATH: path.join(backup, 'absent-claude.json'),
  SUBAGENTS_PI_SYNC_CLI_OAUTH: 'true',
})
const imported = await bootstrapPiUserConfig()
check(imported.oauth.importedProviders.includes('openai-codex'), 'Production CLI import failed')
const replacement = (await json(path.join(staging, 'auth.json')))['openai-codex']
check(replacement.accountId === cli.tokens.account_id && replacement.access === cli.tokens.access_token, 'Imported account mismatch')
stopped()
check(hash(await readFile(cliPath)) === hash(cliBefore), 'CLI login changed during preparation; retry required')
check(JSON.stringify(await json(authPath)) === JSON.stringify(originalAuth), 'Release credentials changed during preparation')
const temporaryAuth = `${authPath}.authorized-switch-${process.pid}.tmp`
await writeFile(temporaryAuth, `${JSON.stringify({ ...originalAuth, 'openai-codex': replacement }, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
await rename(temporaryAuth, authPath)
console.log(JSON.stringify({ phase: 'account-switched', backupAvailable: true }))

// Run the actual release Host and persist the model through its public settings protocol.
const host = spawn(path.join(bundle, 'MacOS/AgentStudio'), [path.join(bundle, 'Resources/app.asar/dist-electron/pi-host.js')], {
  cwd: root,
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    SUBAGENTS_PI_AGENT_DIR: agentDir,
    SUBAGENTS_PI_NATIVE_AGENT_DIR: '/Users/xieyuanyou/.pi/agent',
    SUBAGENTS_PI_VENDOR_DIR: path.join(bundle, 'Resources/vendor/pi'),
    SUBAGENTS_PI_HOST_STATE_PATH: path.join(root, 'pi-host-state.json'),
    SUBAGENTS_DURABLE_MEMORY_DB_PATH: path.join(root, 'durable-memory.sqlite'),
  },
  stdio: ['pipe', 'pipe', 'pipe'],
})
const pending = new Map()
let nextId = 0
let stderrBytes = 0
host.stderr.on('data', (data) => { stderrBytes += data.length })
const exited = new Promise((resolve) => host.once('exit', (code) => resolve(code)))
const output = createInterface({ input: host.stdout })
output.on('line', (line) => {
  let message
  try { message = JSON.parse(line) } catch { return }
  const waiter = pending.get(message.id)
  if (waiter) { pending.delete(message.id); waiter(message) }
})
async function request(method, params = {}) {
  const id = ++nextId
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Host timeout: ${method}; diagnostic bytes=${stderrBytes}`)) }, 25000)
    pending.set(id, (message) => {
      clearTimeout(timeout)
      if (message.error) reject(new Error(`Host rejected ${method}: ${message.error.code}`))
      else resolve(message.result)
    })
    host.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  })
}
try {
  await request('initialize', { protocolVersion: 5, client: 'authorized-release-recovery', capabilities: [] })
  const before = await request('settings/get')
  const catalog = before.config?.subscriptionCatalog?.find((item) => item.id === 'openai-codex')
  check(!before.config?.oauthConflicts?.includes('openai-codex'), 'Account conflict remains')
  check(catalog?.availability === 'available', 'Subscription catalog unavailable')
  check(catalog.models.some((model) => model.id === 'gpt-5.6-sol'), 'Release Sol model unavailable')
  await request('settings/update', { provider: 'openai-codex', model: 'gpt-5.6-sol' })
  const after = await request('settings/get')
  check(after.settings?.provider === 'openai-codex' && after.settings?.model === 'gpt-5.6-sol', 'Host model selection mismatch')
  console.log(JSON.stringify({ phase: 'release-host-verified', provider: after.settings.provider, model: after.settings.model, catalogAvailability: catalog.availability, accountConflict: false }))
  await request('lifecycle/shutdown')
} finally {
  host.stdin.end()
  const timeout = setTimeout(() => host.kill('SIGTERM'), 15000)
  const code = await exited
  clearTimeout(timeout)
  check(code === 0, 'Release Host did not shut down cleanly')
}
const persisted = await json(snapshotPath)
check(persisted.settings.provider === 'openai-codex' && persisted.settings.model === 'gpt-5.6-sol', 'Saved model selection mismatch')
const finalAuth = await json(authPath)
check(finalAuth['openai-codex'].accountId === cli.tokens.account_id, 'Final account mismatch')
for (const key of Object.keys(originalAuth).filter((key) => key !== 'openai-codex')) check(JSON.stringify(finalAuth[key]) === JSON.stringify(originalAuth[key]), 'Another provider was changed')
check(hash(await readFile(cliPath)) === hash(cliBefore), 'CLI login file was modified during recovery')
console.log(JSON.stringify({ phase: 'complete', persisted: true, otherProvidersPreserved: true, cliLoginUnchanged: true, backup, modelRequestSent: false }))
