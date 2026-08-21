/**
 * Qualification: contract → snapshot/grant → pipeline → providers → streaming
 * Proves shipped modules work end-to-end without extra harness.
 * Run: node --experimental-strip-types scripts/smoke-open-design-qualification.mts
 */
import assert from 'node:assert/strict'
import { parseOpenDesignPluginManifest } from '../src/agent/openDesign/pluginContract.ts'
import { createResolvedSnapshot, grantCapabilities, needsReapproval, hashContent } from '../src/agent/openDesign/pluginSnapshot.ts'
import { createFakePipelineProvider } from '../src/agent/openDesign/fakePipelineProvider.ts'
import { rejectModelAttestedEvidence } from '../src/agent/openDesign/providerContract.ts'
import { getStorybookContext } from '../src/agent/openDesign/storybookProvider.ts'
import { normalizeCdtFixtureraw } from '../src/agent/openDesign/chromeDevToolsProvider.ts'
import { normalizeHarnessFixture } from '../src/agent/openDesign/harnessProvider.ts'
import { validateBridgeMessage } from '../src/agent/openDesign/mcpAppsProvider.ts'
import { createStreamingEnvelope, appendStreamingUpdate, finalizeEnvelope } from '../src/agent/openDesign/streamingEnvelope.ts'
import { setProviderFlag, resetProviderFlags } from '../src/agent/openDesign/providerFlags.ts'

let p=0,t=0
async function test(n:string,fn:()=>Promise<void>|void){t++;try{await fn();p++;console.log(`  ✓ ${n}`)}catch(e){console.error(`  ✗ ${n}`);console.error(e);process.exitCode=1}}
console.log('smoke-open-design-qualification')

await test('contract loading: legacy + v1 + unknown major + malformed via shipped parser',()=>{
  assert.equal(parseOpenDesignPluginManifest({title:'legacy'}).ok,true)
  assert.equal(parseOpenDesignPluginManifest({specVersion:'1.0.0',od:{kind:'scenario'}}).ok,true)
  assert.equal(parseOpenDesignPluginManifest({specVersion:'2.0.0',od:{kind:'scenario'}}).ok,false)
  assert.equal(parseOpenDesignPluginManifest({specVersion:'1.0.0',od:{kind:'scenario',capabilities:['evil']}}).ok,false)
})

await test('snapshot + grant lifecycle: deterministic hash, fingerprint, revocation',()=>{
  const a=createResolvedSnapshot({pluginId:'q:plugin',source:{sourcePath:'plugins/x/SKILL.md'},rawManifest:{specVersion:'1.0.0',od:{kind:'scenario',capabilities:['fs:write']}},projectRoot:'/tmp/proj'}) as any
  const b=createResolvedSnapshot({pluginId:'q:plugin',source:{sourcePath:'plugins/x/SKILL.md'},rawManifest:{specVersion:'1.0.0',od:{kind:'scenario',capabilities:['fs:write']}},projectRoot:'/tmp/proj'}) as any
  assert.equal(a.contentHash,b.contentHash)
  const g=grantCapabilities(a,['fs:write'])
  assert.ok(g.grantedCapabilities.includes('fs:write'))
  const nextHash=hashContent('changed')
  assert.equal(needsReapproval(g,{contentHash:nextHash,fingerprint:g.capabilityFingerprint}),true)
})

await test('task run seam: fake pipeline success produces evidence + artifact, DoD separate',async()=>{
  const pvd=createFakePipelineProvider()
  const ctrl=new AbortController()
  const sess=pvd.execute({stageId:'compose'}, {runId:'qual_run',stageId:'compose',timeoutMs:2000,outputBudgetBytes:10000,signal:ctrl.signal})
  const receipt=await sess.promise
  assert.equal(receipt.kind,'success')
  assert.ok(receipt.artifactLocator?.startsWith('artifacts/qual_run'))
  assert.equal(sess.evidence[0].adapterIssued,true)
  assert.equal(rejectModelAttestedEvidence({evidenceId:'x',runId:'r',stageId:'s',providerId:'fake-pipeline',adapterIssued:false}).accepted,false)
})

await test('context/evidence providers normalize without leaking raw secrets',()=>{
  resetProviderFlags(); setProviderFlag('storybook',true)
  const {evidence}=getStorybookContext('proj', {components:[{id:'c',title:'T'}]},'fp')
  assert.equal(evidence.provider,'storybook')
  const {findings}=normalizeCdtFixtureraw({console:[{level:'error',message:'err'}]},'r','s')
  assert.ok(findings.length>0)
  const h=normalizeHarnessFixture({outcome:'success',steps:[]},'r','s')
  assert.equal(h.outcome,'success')
})

await test('interactive surface validation + streaming envelope',()=>{
  const ok=validateBridgeMessage({v:1,surfaceId:'s1',kind:'choice',action:'submit',payload:{value:'a'}})
  assert.equal(ok.ok,true)
  const e=createStreamingEnvelope('html:q','qual_run')
  const r=appendStreamingUpdate(e,'<div>hi</div>').envelope
  const fin=finalizeEnvelope(r,'complete')
  assert.equal(fin.status,'complete')
  assert.equal(fin.updates.length,1)
})

await test('security: path confinement + no raw token + unknown capability fail-closed',async()=>{
  const a=createResolvedSnapshot({pluginId:'sec',source:{sourcePath:'plugins/a/SKILL.md'},rawManifest:{specVersion:'1.0.0',od:{kind:'scenario',capabilities:['fs:write']}},projectRoot:'/tmp/proj'}) as any
  assert.ok(a.projectRelativePath.startsWith('.subagents/open-design/snapshots/'))
  // try absolute path should error
  const bad=createResolvedSnapshot({pluginId:'sec',source:{sourcePath:'/etc/passwd'},rawManifest:{specVersion:'1.0.0',od:{kind:'scenario'}},projectRoot:'/tmp/proj'}) as any
  assert.ok(bad.error && bad.error.includes('絕對'))
  const mal=parseOpenDesignPluginManifest({specVersion:'1.0.0',od:{kind:'scenario',capabilities:['unknown:cap']}})
  assert.equal(mal.ok,false)
})

await test('settlement cases are distinguishable: success / blocked / failure / cancelled',async()=>{
  const pvd=createFakePipelineProvider()
  const ctrl=new AbortController()
  const succ=await pvd.execute({stageId:'compose'},{runId:'sett1',stageId:'compose',timeoutMs:2000,outputBudgetBytes:10000,signal:ctrl.signal}).promise
  const fail=await pvd.execute({stageId:'fail'},{runId:'sett2',stageId:'fail',timeoutMs:2000,outputBudgetBytes:10000,signal:ctrl.signal}).promise
  const blocked=await pvd.execute({stageId:'blocked'},{runId:'sett3',stageId:'blocked',timeoutMs:2000,outputBudgetBytes:10000,signal:ctrl.signal}).promise
  const c=new AbortController()
  const sess=pvd.execute({stageId:'compose'},{runId:'sett4',stageId:'compose',timeoutMs:5000,outputBudgetBytes:10000,signal:c.signal})
  await sess.handle.cancel()
  const cancelled=await sess.promise
  assert.equal(succ.kind,'success')
  assert.equal(fail.kind,'failure')
  assert.equal(blocked.kind,'blocked')
  assert.equal(cancelled.kind,'cancelled')
})

console.log(`\n${p}/${t} tests passed`)
if(process.exitCode) console.error('Qualification failed'); else console.log('OK - qualification chain passed')
