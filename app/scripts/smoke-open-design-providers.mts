/**
 * Smoke: providers — Storybook, DevTools, Harness, MCP Apps, streaming
 * Feature-flag gating + deterministic fixtures + security checks
 * Run: node --experimental-strip-types scripts/smoke-open-design-providers.mts
 */
import assert from 'node:assert/strict'
import { isProviderEnabled, setProviderFlag, resetProviderFlags, providerFlagDescription } from '../src/agent/openDesign/providerFlags.ts'
import { storybookAvailability, normalizeStorybookResponse, getStorybookContext, clearStorybookCache } from '../src/agent/openDesign/storybookProvider.ts'
import { cdtAvailability, normalizeCdtFixtureraw } from '../src/agent/openDesign/chromeDevToolsProvider.ts'
import { harnessAvailability, normalizeHarnessFixture } from '../src/agent/openDesign/harnessProvider.ts'
import { mcpAppsAvailability, validateBridgeMessage, validateSurfaceDeclaration, isToolAllowed } from '../src/agent/openDesign/mcpAppsProvider.ts'
import { createStreamingEnvelope, appendStreamingUpdate, finalizeEnvelope, reconcileUpdates, canRender } from '../src/agent/openDesign/streamingEnvelope.ts'

let p=0, t=0
async function test(n:string,fn:()=>void|Promise<void>){t++;try{await fn();p++;console.log(`  ✓ ${n}`)}catch(e){console.error(`  ✗ ${n}`);console.error(e);process.exitCode=1}}
console.log('smoke-open-design-providers')

await test('feature flags default off, descriptions visible',()=>{
  resetProviderFlags()
  assert.equal(isProviderEnabled('storybook'),false)
  assert.equal(isProviderEnabled('harness'),false)
  assert.ok(providerFlagDescription('storybook').includes('Storybook'))
  assert.ok(providerFlagDescription('harness').includes('Harness'))
})

await test('storybook: flag off -> unavailable fallback',()=>{
  resetProviderFlags()
  const av=storybookAvailability()
  assert.equal(av.available,false)
})

await test('storybook: enabled -> context budget + cache',()=>{
  resetProviderFlags(); setProviderFlag('storybook',true)
  assert.equal(storybookAvailability().available,true)
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
  clearStorybookCache()
})

await test('chrome devtools: flag off -> unavailable, enabled -> findings normalized + redaction',()=>{
  resetProviderFlags()
  assert.equal(cdtAvailability().available,false)
  setProviderFlag('chrome-devtools',true)
  assert.equal(cdtAvailability().available,true)
  const raw={console:[{level:'error',message:'boom auth'}],network:[{url:'https://a',status:500,failed:true}],performance:[{metric:'LCP',value:2000,threshold:1000}],trace:'x'.repeat(2000)}
  const {findings,attachments}=normalizeCdtFixtureraw(raw,'run1','stage1')
  assert.ok(findings.some(f=>f.kind==='console'))
  assert.ok(findings.some(f=>f.kind==='network'))
  assert.ok(findings.some(f=>f.kind==='performance'))
  assert.equal(attachments.length,1)
  // redaction check
  const raw2={console:[{level:'error',message:'authorization: Bearer secret123'}]}
  const {findings:f2}=normalizeCdtFixtureraw(raw2,'r','s')
  assert.ok(f2[0].message.includes('[redacted]'))
})

await test('harness: flag off / unsupported platform / permission denied -> fallback',()=>{
  resetProviderFlags()
  assert.equal(harnessAvailability().available,false)
  setProviderFlag('harness',true)
  assert.equal(harnessAvailability({platform:'linux'}).available,false)
  assert.equal(harnessAvailability({platform:'darwin',hasPermission:false}).available,false)
  assert.equal(harnessAvailability({platform:'darwin',hasPermission:true}).available,true)
  const raw={outcome:'success',steps:[{action:'tap',observation:'ok'}],frictionEvents:[{type:'stall',detail:'slow'}],screenshots:['shot.png']}
  const r=normalizeHarnessFixture(raw,'runH','stageH')
  assert.equal(r.outcome,'success')
  assert.equal(r.steps.length,1)
  assert.ok(r.screenshotLocators[0].includes('evidence/runH'))
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
  const mal=validateBridgeMessage({v:999,surfaceId:'',kind:'unknown',action:''})
  assert.equal(mal.ok,false)
  const nav=validateBridgeMessage({v:1,surfaceId:'s1',kind:'form',action:'x',payload:{navigate:'https://evil.com'}})
  assert.equal(nav.ok,false)
  const oversized=validateBridgeMessage({v:1,surfaceId:'s1',kind:'choice',action:'submit',payload:{big:'x'.repeat(9000)}})
  assert.equal(oversized.ok,false)
  const good=validateBridgeMessage({v:1,surfaceId:'choice_1',kind:'choice',action:'submit',payload:{value:'a'}})
  assert.equal(good.ok,true)
})

await test('streaming envelope: ordered updates, duplicate/out-of-order, cancel, late event',()=>{
  const env=createStreamingEnvelope('html:artifact','runS')
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
  const err=finalizeEnvelope(r2.envelope,'error','boom')
  assert.equal(err.status,'error')
})

await test('no raw token in provider evidence paths',async()=>{
  const fs=await import('node:fs'); const path=await import('node:path'); const {fileURLToPath}=await import('node:url')
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
  for(const f of ['src/agent/openDesign/storybookProvider.ts','src/agent/openDesign/chromeDevToolsProvider.ts','src/agent/openDesign/harnessProvider.ts']) {
    const src=fs.readFileSync(path.join(root,f),'utf8')
    assert.doesNotMatch(src,/sk-[a-zA-Z0-9]{20,}/)
  }
})

console.log(`\n${p}/${t} tests passed`)
if(process.exitCode) console.error('Smoke failed'); else console.log('OK')
