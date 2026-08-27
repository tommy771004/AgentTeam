/**
 * Smoke: providers — Storybook, DevTools, Harness, MCP Apps, streaming
 * Feature-flag gating + deterministic fixtures + security checks
 * Run: node --experimental-strip-types scripts/smoke-open-design-providers.mts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
import { hydrateProviderFlags, isProviderEnabled, setProviderFlag, resetProviderFlags, providerFlagDescription } from '../src/agent/subdesign/providers/providerFlags.ts'
import { DEFAULT_EXPERIMENTAL_SURFACE_SETTINGS, normalizeExperimentalSurfaceSettings } from '../src/agent/subdesign/providers/providerSettings.ts'
import { storybookAvailability, getStorybookContext, clearStorybookCache } from '../src/agent/subdesign/providers/storybookProvider.ts'
import { cdtAvailability, cdtToProviderEvidence, chromeDevToolsEvidenceAllowsPass, normalizeCdtFixtureRaw } from '../src/agent/subdesign/providers/chromeDevToolsProvider.ts'
import { createHarnessFakeSession, harnessAvailability, normalizeHarnessFixture } from '../src/agent/subdesign/providers/harnessProvider.ts'
import { mcpAppsAvailability, validateBridgeMessage, validateSurfaceDeclaration, isToolAllowed, parseMcpToolCoordinate } from '../src/agent/subdesign/providers/mcpAppsProvider.ts'
import { SURFACE_STATUS_LABELS, surfaceFallsBack } from '../src/agent/subdesign/surfaceStatus.ts'
import { createStreamingEnvelope, appendStreamingUpdate, finalizeEnvelope, reconcileUpdates, canRender } from '../src/agent/subdesign/streamingEnvelope.ts'
import {
  DEFAULT_STORYBOOK_PROVIDER_SETTINGS,
  DEFAULT_CHROME_DEVTOOLS_PROVIDER_SETTINGS,
  loadChromeDevToolsProviderState,
  loadStorybookProviderState,
  normalizeChromeDevToolsProviderSettings,
  normalizeStorybookProviderSettings,
  saveChromeDevToolsProviderSettings,
  saveStorybookProviderSettings,
  DEFAULT_HARNESS_PROVIDER_SETTINGS,
  normalizeHarnessProviderSettings,
} from '../src/agent/subdesign/providers/providerSettings.ts'

let p=0, t=0
async function test(n:string,fn:()=>void|Promise<void>){t++;try{await fn();p++;console.log(`  ✓ ${n}`)}catch(e){console.error(`  ✗ ${n}`);console.error(e);process.exitCode=1}}
console.log('smoke-open-design-providers')

await test('feature flags default off, descriptions visible',()=>{
  resetProviderFlags()
  // Experimental surfaces without a settings record default off...
  assert.equal(isProviderEnabled('mcp-apps'),false)
  assert.equal(isProviderEnabled('streaming'),false)
  assert.ok(providerFlagDescription('mcp-apps').includes('MCP Apps'))
  assert.ok(providerFlagDescription('streaming').includes('Streaming'))
  // ...and the settings-backed providers are gated only by their own config,
  // so there is no second flag that can disagree with the executing path.
  const flagsSrc = fs.readFileSync(path.join(appRoot,'src/agent/subdesign/providers/providerFlags.ts'),'utf8')
  for (const gone of ['storybook','chrome-devtools','harness']) {
    assert.doesNotMatch(flagsSrc, new RegExp(`'${gone}'`), `${gone} 不應再有第二個 flag`)
  }
  // These two default off but ARE reachable: a persisted per-project record
  // hydrates the synchronous gate, and a real control exposes it.
  assert.equal(DEFAULT_EXPERIMENTAL_SURFACE_SETTINGS.mcpApps,false)
  assert.equal(DEFAULT_EXPERIMENTAL_SURFACE_SETTINGS.streaming,false)
  hydrateProviderFlags({mcpApps:true,streaming:false})
  assert.equal(isProviderEnabled('mcp-apps'),true)
  assert.equal(isProviderEnabled('streaming'),false)
  assert.equal(mcpAppsAvailability().available,true)
  resetProviderFlags()
  assert.equal(isProviderEnabled('mcp-apps'),false)

  // Unknown input can never widen the gate.
  assert.equal(normalizeExperimentalSurfaceSettings({mcpApps:'yes',streaming:1}).mcpApps,false)
  assert.equal(normalizeExperimentalSurfaceSettings(null).streaming,false)

  // The gate is renderer-only: Pi Host must not import it, or a renderer
  // toggle could widen what the Host is willing to execute.
  const hostFiles = fs.readdirSync(path.join(appRoot,'electron'),{recursive:true,encoding:'utf8'})
    .filter((file) => /\.tsx?$/.test(file))
    .filter((file) => fs.readFileSync(path.join(appRoot,'electron',file),'utf8').includes('providerFlags'))
  assert.deepEqual(hostFiles,[],'Pi Host 不可 import providerFlags')

  // And it is actually wired to the product, not only to smokes.
  const page = fs.readFileSync(path.join(appRoot,'src/pages/SubDesignPage.tsx'),'utf8')
  const workspaceIntegration = fs.readFileSync(path.join(appRoot,'src/agent/subdesign/workspaceIntegration.ts'),'utf8')
  assert.doesNotMatch(page,/hydrateProviderFlags/)
  assert.doesNotMatch(page,/(?<!workspaceController\.)\bsaveExperimentalSurfaceSettings\s*\(/)
  assert.match(workspaceIntegration,/hydrateProviderFlags/)
  assert.match(workspaceIntegration,/saveExperimentalSurfaceSettings/)
  const control = fs.readFileSync(path.join(appRoot,'src/components/subdesign/ExperimentalSurfaceControl.tsx'),'utf8')
  assert.match(control,/providerFlagDescription/)
})

await test('storybook: flag off -> unavailable fallback',()=>{
  const av=storybookAvailability(false)
  assert.equal(av.available,false)
})

await test('storybook: enabled -> context budget + cache',()=>{
  assert.equal(storybookAvailability(true).available,true)
  const raw={components:[{id:'c1',title:'Button',docs:'A button',controls:['variant']},{id:'c2',title:'Card'}]}
  const r1=getStorybookContext('projA',raw,'fp1')
  assert.equal(r1.fromCache,false)
  assert.equal(r1.evidence.components.length,2)
  const r2=getStorybookContext('projA',raw,'fp1')
  assert.equal(r2.fromCache,true)
  // unknown extra fields ignored
  const raw2={components:[{id:'c3',title:'X'}] as any, extraFutureField:'hi'}
  const r3=getStorybookContext('projA',raw2,'fp2')
  assert.equal(r3.evidence.components[0].id,'c3')
  const stale=getStorybookContext('projA',raw,'fp1')
  assert.equal(stale.fromCache,false)
  clearStorybookCache()
})

await test('storybook: project settings are pinned, loopback-only, and reloadable', async()=>{
  assert.equal(normalizeStorybookProviderSettings({ enabled: true, endpoint: 'https://example.com' }).enabled, false)
  assert.equal(normalizeStorybookProviderSettings({ enabled: true, endpoint: 'https://example.com' }).endpoint, DEFAULT_STORYBOOK_PROVIDER_SETTINGS.endpoint)
  let written: any = null
  const host = globalThis as unknown as { window?: unknown }
  const priorWindow = host.window
  host.window = { subagents: { subdesign: {
    writeMetadata: async (input: unknown) => { written = input; return { ok: true } },
    readMetadata: async () => ({
      ok: true,
      briefs: [], artifacts: [], critiques: [], exports: [], openDesignPacks: [], openDesignSnapshots: [],
      openDesignProviderSettings: [written?.payload],
      openDesignProviderRuns: [{ schemaVersion: 1, runId: 'run_sb', briefId: 'brief_sb', providerId: 'storybook', finishedAt: '2026-08-21T00:00:00.000Z' }],
    }),
  } } }
  try {
    const saved = await saveStorybookProviderSettings({ enabled: true, endpoint: 'http://localhost:6006' }, '/tmp/proj')
    assert.equal(saved.ok, true)
    assert.equal(written.kind, 'open-design-provider-settings')
    assert.equal(written.payload.resolvedVersion, '8.6.0')
    const restored = await loadStorybookProviderState('/tmp/proj')
    assert.equal(restored.settings.enabled, true)
    assert.equal(restored.runs[0]?.runId, 'run_sb')
    const rejected = await saveStorybookProviderSettings({ enabled: true, endpoint: 'http://example.com' }, '/tmp/proj')
    assert.equal(rejected.ok, false)
  } finally { host.window = priorWindow }
})

await test('chrome devtools: project settings are pinned, loopback-only, and reloadable', async()=>{
  assert.equal(normalizeChromeDevToolsProviderSettings({enabled:true,endpoint:'http://remote.test:9222'}).enabled,false)
  assert.equal(normalizeChromeDevToolsProviderSettings({enabled:true,endpoint:'http://remote.test:9222'}).endpoint,DEFAULT_CHROME_DEVTOOLS_PROVIDER_SETTINGS.endpoint)
  let written:any=null
  const host=globalThis as unknown as {window?:unknown}; const priorWindow=host.window
  host.window={subagents:{subdesign:{
    writeMetadata:async(input:unknown)=>{written=input;return{ok:true}},
    readMetadata:async()=>({ok:true,briefs:[],artifacts:[],critiques:[],exports:[],openDesignPacks:[],openDesignSnapshots:[],openDesignProviderSettings:[written?.payload],openDesignProviderRuns:[{schemaVersion:1,runId:'run_cdt',briefId:'brief_cdt',providerId:'chrome-devtools',finishedAt:'2026-08-21T00:00:00.000Z'}]}),
  }}}
  try{
    const saved=await saveChromeDevToolsProviderSettings({enabled:true,endpoint:'http://127.0.0.1:9222'},'/tmp/proj')
    assert.equal(saved.ok,true); assert.equal(written.kind,'open-design-provider-settings'); assert.equal(written.payload.resolvedVersion,'1.3')
    const restored=await loadChromeDevToolsProviderState('/tmp/proj')
    assert.equal(restored.settings.enabled,true); assert.equal(restored.runs[0]?.runId,'run_cdt')
    assert.equal((await saveChromeDevToolsProviderSettings({enabled:true,endpoint:'https://localhost:9222'},'/tmp/proj')).ok,false)
  }finally{host.window=priorWindow}
})

await test('chrome devtools: flag off -> unavailable, enabled -> findings normalized + redaction',()=>{
  assert.equal(cdtAvailability(false).available,false)
  assert.equal(cdtAvailability(undefined).available,false)
  assert.equal(cdtAvailability(true).available,true)
  const raw={console:[{level:'error',message:'boom auth'}],network:[{url:'https://user:pass@example.test/api?token=secret',status:500,failed:true}],performance:[{metric:'LCP',value:2000,threshold:1000}],trace:'x'.repeat(2000)}
  const {findings,attachments}=normalizeCdtFixtureRaw(raw,'run1','stage1','artifact1')
  assert.ok(findings.some(f=>f.kind==='console'))
  assert.ok(findings.some(f=>f.kind==='network'))
  assert.ok(findings.some(f=>f.kind==='performance'))
  assert.equal(attachments.length,1)
  assert.equal(findings[0]?.artifactId,'artifact1')
  assert.ok(findings.every((finding)=>!finding.message.includes('secret')&&!finding.message.includes('pass')))
  assert.equal(cdtToProviderEvidence(findings,'run1','stage1').length,findings.length)
  // redaction check
  const raw2={console:[{level:'error',message:'authorization: Bearer secret123'}]}
  const {findings:f2}=normalizeCdtFixtureRaw(raw2,'r','s')
  assert.ok(f2[0].message.includes('[redacted]'))
  assert.match(normalizeCdtFixtureRaw(null,'r','s').warnings[0] || '',/fixture/)
})

await test('chrome devtools: final gate rejects partial, blocker, missing, and cross-artifact evidence',()=>{
  const base:any={schemaVersion:1,runId:'run1',briefId:'brief1',pluginId:'plugin1',providerId:'chrome-devtools',stageId:'critique',state:'completed',providerKind:'success',failurePolicy:'continue-on-blocked',summary:'ok',startedAt:'2026-08-21T00:00:00.000Z',finishedAt:'2026-08-21T00:00:01.000Z'}
  assert.equal(chromeDevToolsEvidenceAllowsPass(undefined,{runId:'run1',artifactId:'artifact1'}).allowed,false)
  assert.equal(chromeDevToolsEvidenceAllowsPass({...base,partial:true},{runId:'run1',artifactId:'artifact1'}).allowed,false)
  assert.equal(chromeDevToolsEvidenceAllowsPass({...base,findings:[{kind:'console',severity:'blocker',message:'boom',capturedAt:'2026-08-21T00:00:00.000Z',runId:'run1',stageId:'critique',providerId:'chrome-devtools',artifactId:'artifact1'}]},{runId:'run1',artifactId:'artifact1'}).allowed,false)
  assert.equal(chromeDevToolsEvidenceAllowsPass({...base,findings:[{kind:'performance',severity:'info',message:'ok',capturedAt:'2026-08-21T00:00:00.000Z',runId:'run1',stageId:'critique',providerId:'chrome-devtools',artifactId:'other'}]},{runId:'run1',artifactId:'artifact1'}).allowed,false)
  assert.equal(chromeDevToolsEvidenceAllowsPass({...base,findings:[]},{runId:'run1',artifactId:'artifact1'}).allowed,true)
})

await test('harness: flag off / unsupported platform / permission denied -> fallback',()=>{
  assert.equal(harnessAvailability(false).available,false)
  assert.equal(harnessAvailability(true,{platform:'linux'}).available,false)
  assert.equal(harnessAvailability(true,{platform:'darwin',hasPermission:false}).available,false)
  assert.equal(harnessAvailability(true,{platform:'darwin',hasPermission:true}).available,true)
  const raw={outcome:'success',steps:[{action:'tap',observation:'ok'}],frictionEvents:[{type:'stall',detail:'slow'}],screenshots:['shot.png']}
  const r=normalizeHarnessFixture(raw,'runH','stageH')
  assert.equal(r.outcome,'success')
  assert.equal(r.steps.length,1)
  assert.ok(r.screenshotLocators[0].includes('evidence/runH'))
})

await test('harness: fake sessions preserve ordered friction and reject late events after timeout/cancel',()=>{
  const scope={runId:'runH2',stageId:'critique',artifactId:'artifactH',goal:'finish checkout',persona:'first-time user'}
  const success=createHarnessFakeSession(scope)
  success.pushStep({action:'open cart',observation:'cart visible'}); success.pushFriction({type:'ambiguous_label',detail:'authorization: secret-value',step:1}); success.pushStep({action:'pay',observation:'done'}); success.complete('success')
  const complete=success.snapshot(); assert.equal(complete.result.outcome,'success'); assert.deepEqual(complete.result.steps.map(step=>step.index),[1,2]); assert.equal(complete.result.artifactId,'artifactH'); assert.ok(!complete.result.frictionEvents[0].detail.includes('secret-value'))
  const failed=createHarnessFakeSession(scope); failed.complete('failure'); assert.equal(failed.snapshot().result.outcome,'failure')
  const timedOut=createHarnessFakeSession(scope); timedOut.timeout(); timedOut.pushStep({action:'late',observation:'must ignore'}); assert.equal(timedOut.snapshot().result.steps.length,0); assert.equal(timedOut.snapshot().result.outcome,'blocked')
  const cancelled=createHarnessFakeSession(scope); cancelled.cancel(); cancelled.complete('success'); cancelled.pushFriction({type:'late',detail:'must ignore'}); assert.equal(cancelled.snapshot().terminal,'cancelled'); assert.equal(cancelled.snapshot().result.frictionEvents.length,0)
})

await test('harness: project config pins 0.7.0 and rejects unsafe binary/remote target defaults',()=>{
  const safe=normalizeHarnessProviderSettings({enabled:true,binaryPath:'/Applications/Harness.app/Contents/MacOS/harness-mcp',targetUrl:'http://localhost:4173'})
  assert.equal(safe.enabled,true); assert.equal(safe.resolvedVersion,'0.7.0')
  const unsafe=normalizeHarnessProviderSettings({enabled:true,binaryPath:'./harness-mcp',targetUrl:'https://remote.example'})
  assert.equal(unsafe.binaryPath,'harness-mcp'); assert.equal(unsafe.targetUrl,DEFAULT_HARNESS_PROVIDER_SETTINGS.targetUrl)
})

await test('mcp-apps: validation rejects untrusted origin / disallowed tool / malformed',()=>{
  resetProviderFlags()
  assert.equal(mcpAppsAvailability().available,false)
  setProviderFlag('mcp-apps',true)
  assert.equal(mcpAppsAvailability().available,true)
  const badOrigin=validateBridgeMessage({v:1,surfaceId:'s1',kind:'choice',action:'submit',payload:{}},{expectedOrigin:'https://trusted',actualOrigin:'https://evil'})
  assert.equal(badOrigin.ok,false)
  const decl=validateSurfaceDeclaration({kind:'choice',scope:'run',allowlist:['tool_a']})
  assert.equal(decl.ok,true)
  if(decl.ok) assert.equal(isToolAllowed(decl.decl,'tool_a'),true)
  if(decl.ok) assert.equal(isToolAllowed(decl.decl,'tool_evil'),false)
  assert.deepEqual(parseMcpToolCoordinate('github.create_issue'), { extensionId: 'github', toolName: 'create_issue' })
  assert.equal(parseMcpToolCoordinate('missing-coordinate'), null)
  const mal=validateBridgeMessage({v:999,surfaceId:'',kind:'unknown',action:''})
  assert.equal(mal.ok,false)
  const nav=validateBridgeMessage({v:1,surfaceId:'s1',kind:'form',action:'x',payload:{navigate:'https://evil.com'}})
  assert.equal(nav.ok,false)
  const oversized=validateBridgeMessage({v:1,surfaceId:'s1',kind:'choice',action:'submit',payload:{big:'x'.repeat(9000)}})
  assert.equal(oversized.ok,false)
  const good=validateBridgeMessage({v:1,surfaceId:'choice_1',kind:'choice',action:'submit',payload:{value:'a'}})
  assert.equal(good.ok,true)
})

await test('mcp-apps: real fallback options, distinct states, no placeholder choices',()=>{
  const surface=fs.readFileSync(path.join(appRoot,'src/components/subdesign/McpAppSurface.tsx'),'utf8')
  // The hardcoded placeholder directions must not come back.
  assert.doesNotMatch(surface,/方向 A/)
  assert.match(surface,/choiceOptions/)
  // A caller can supply the real native UI as the fallback.
  assert.match(surface,/fallback\?: ReactNode/)
  assert.match(surface,/if \(props\.fallback\) return/)
  // The non-standard `csp` iframe attribute (and its ts-ignore) is gone;
  // the CSP meta inside srcDoc is the actual policy.
  assert.doesNotMatch(surface,/@ts-ignore/)
  assert.doesNotMatch(surface,/csp=\{CSP_SANDBOX\}/)
  // The sandbox grants scripts only — allow-same-origin would give the frame a
  // real origin and, with it, reach into the host.
  const sandboxAttr = surface.match(/sandbox="([^"]*)"/)
  assert.ok(sandboxAttr,'iframe 必須宣告 sandbox')
  assert.equal(sandboxAttr[1],'allow-scripts')

  // Every state has its own wording, so the conversation is not one spinner.
  const labels=Object.entries(SURFACE_STATUS_LABELS)
  assert.equal(labels.length,7)
  assert.equal(new Set(labels.map(([,label])=>label)).size,7)
  for (const state of ['loading','ready','submitted','invalid','expired','unavailable','error'] as const) {
    assert.ok(SURFACE_STATUS_LABELS[state],`${state} 缺少說明`)
  }
  // Exactly the four failure states hand over to the native fallback.
  assert.deepEqual(
    (['loading','ready','submitted','invalid','expired','unavailable','error'] as const).filter(surfaceFallsBack),
    ['invalid','expired','unavailable','error'],
  )

  // Direction choice is actually mounted, and backfills the brief's direction.
  const studio=fs.readFileSync(path.join(appRoot,'src/components/subdesign/SubDesignProjectStudio.tsx'),'utf8')
  assert.match(studio,/<McpAppSurface/)
  assert.match(studio,/onSelectDirection\(directionId\)/)
  assert.match(studio,/onStatusChange/)
  assert.match(studio,/pushRunActivity/)
})

await test('mcp-apps: allowlisted tool calls cross the approval store and Host MCP pack',()=>{
  const surface=fs.readFileSync(path.join(appRoot,'src/components/subdesign/McpAppSurface.tsx'),'utf8')
  const preload=fs.readFileSync(path.join(appRoot,'electron/preload.ts'),'utf8')
  const main=fs.readFileSync(path.join(appRoot,'electron/main.ts'),'utf8')
  assert.doesNotMatch(surface,/Host would proxy here/)
  assert.match(surface,/requestAsk\(\{/)
  assert.match(surface,/callMcpAppTool/)
  assert.match(surface,/action: 'tool_result'/)
  assert.match(preload,/subdesign:mcpAppToolCall/)
  assert.match(main,/ipcMain\.handle\('subdesign:mcpAppToolCall'/)
  assert.match(main,/callPackTool\('mcp_call'/)
})

await test('streaming envelope: ordered updates, duplicate/out-of-order, cancel, late event',()=>{
  // Real artifact ids carry no kind — the kind comes from the manifest.
  const env=createStreamingEnvelope({artifactId:'plugin_runS_compose',artifactKind:'html',runId:'runS'})
  const r1=appendStreamingUpdate(env,'hello')
  const r2=appendStreamingUpdate(r1.envelope,' world')
  assert.equal(r2.envelope.updates.length,2)
  assert.equal(r2.envelope.updates[0].seq,1)
  // reconcile out-of-order + duplicate
  const reconciled=reconcileUpdates([{seq:3,content:'c'},{seq:1,content:'a'},{seq:2,content:'b'},{seq:2,content:'dup'}])
  assert.deepEqual(reconciled.map(u=>u.seq),[1,2,3])
  // unsupported renderer rejects streaming
  const bad=canRender({supportedKinds:['html'],streaming:false,sandbox:"default-src 'none'"},r2.envelope)
  assert.equal(bad.ok,false)
  const good=canRender({supportedKinds:['html'],streaming:true,sandbox:"default-src 'none'"},r2.envelope)
  assert.equal(good.ok,true)
  // finalize
  const fin=finalizeEnvelope(r2.envelope,'complete')
  assert.equal(fin.status,'complete')
  assert.match(appendStreamingUpdate(fin,'late').rejected ?? '',/終止/)
  const err=finalizeEnvelope(r2.envelope,'error','boom')
  assert.equal(err.status,'error')
})

await test('no raw token in provider evidence paths',async()=>{
  const fs=await import('node:fs'); const path=await import('node:path'); const {fileURLToPath}=await import('node:url')
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
  for(const f of ['src/agent/subdesign/providers/storybookProvider.ts','src/agent/subdesign/providers/chromeDevToolsProvider.ts','src/agent/subdesign/providers/harnessProvider.ts']) {
    const src=fs.readFileSync(path.join(root,f),'utf8')
    assert.doesNotMatch(src,/sk-[a-zA-Z0-9]{20,}/)
  }
})

console.log(`\n${p}/${t} tests passed`)
if(process.exitCode) console.error('Smoke failed'); else console.log('OK')
