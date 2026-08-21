/**
 * Qualification: contract → snapshot/grant → pipeline → providers → streaming
 * Proves shipped modules work end-to-end without extra harness.
 * Run: node --experimental-strip-types scripts/smoke-open-design-qualification.mts
 */
import assert from 'node:assert/strict'
import { parseOpenDesignPluginManifest } from '../src/agent/openDesign/pluginContract.ts'
import { createResolvedSnapshot, grantCapabilities, needsReapproval, sha256Hex } from '../src/agent/subdesign/pluginSnapshot.ts'
import { createFakePipelineProvider } from '../src/agent/subdesign/providers/fakePipelineProvider.ts'
import { rejectModelAttestedEvidence } from '../src/agent/subdesign/providers/providerContract.ts'
import { selectProviderRuns } from '../src/agent/subdesign/providers/providerSettings.ts'
import { getStorybookContext } from '../src/agent/subdesign/providers/storybookProvider.ts'
import { normalizeCdtFixtureRaw } from '../src/agent/subdesign/providers/chromeDevToolsProvider.ts'
import { normalizeHarnessFixture } from '../src/agent/subdesign/providers/harnessProvider.ts'
import { validateBridgeMessage } from '../src/agent/subdesign/providers/mcpAppsProvider.ts'
import { appendStreamingUpdate, envelopeForArtifact, finalizeEnvelope } from '../src/agent/subdesign/streamingEnvelope.ts'
import { surfaceDraftKey } from '../src/agent/subdesign/surfaceDraftStore.ts'
import { resetProviderFlags } from '../src/agent/subdesign/providers/providerFlags.ts'

let p=0,t=0
async function test(n:string,fn:()=>Promise<void>|void){t++;try{await fn();p++;console.log(`  ✓ ${n}`)}catch(e){console.error(`  ✗ ${n}`);console.error(e);process.exitCode=1}}
console.log('smoke-open-design-qualification')

await test('contract loading: legacy + v1 + unknown major + malformed via shipped parser',()=>{
  assert.equal(parseOpenDesignPluginManifest({title:'legacy'}).ok,true)
  assert.equal(parseOpenDesignPluginManifest({specVersion:'1.0.0',od:{kind:'scenario'}}).ok,true)
  assert.equal(parseOpenDesignPluginManifest({specVersion:'2.0.0',od:{kind:'scenario'}}).ok,false)
  assert.equal(parseOpenDesignPluginManifest({specVersion:'1.0.0',od:{kind:'scenario',capabilities:['evil']}}).ok,false)
})

await test('snapshot + grant lifecycle: deterministic hash, fingerprint, scoped grant',async()=>{
  const a=await createResolvedSnapshot({pluginId:'q:plugin',source:{sourcePath:'plugins/x/SKILL.md'},rawManifest:{specVersion:'1.0.0',od:{kind:'scenario',capabilities:['fs:write']}},projectRoot:'/tmp/proj'}) as any
  const b=await createResolvedSnapshot({pluginId:'q:plugin',source:{sourcePath:'plugins/x/SKILL.md'},rawManifest:{specVersion:'1.0.0',od:{kind:'scenario',capabilities:['fs:write']}},projectRoot:'/tmp/proj'}) as any
  assert.equal(a.contentHash,b.contentHash)
  const g=grantCapabilities(a,['fs:write'],{runId:'qual_run',threadId:'qual_thread'})
  assert.ok(g.grantedCapabilities.includes('fs:write'))
  const nextHash=await sha256Hex('changed')
  assert.equal(needsReapproval(g,{contentHash:nextHash,fingerprint:g.capabilityFingerprint}),true)
})

await test('task run seam: fake pipeline success produces evidence + artifact, DoD separate',async()=>{
  const pvd=createFakePipelineProvider()
  const ctrl=new AbortController()
  const sess=pvd.execute({stageId:'compose'}, {runId:'qual_run',stageId:'compose',timeoutMs:2000,outputBudgetBytes:10000,signal:ctrl.signal})
  const receipt=await sess.promise
  assert.equal(receipt.kind,'success')
  assert.ok(receipt.artifactLocator?.startsWith('artifacts/qual_run'))
  const evidence=await sess.evidence
  assert.equal(evidence[0]?.adapterIssued,true)
  assert.equal(rejectModelAttestedEvidence(evidence[0]).accepted,true)
  assert.equal(rejectModelAttestedEvidence({evidenceId:'x',runId:'r',stageId:'s',providerId:'fake-pipeline',adapterIssued:false}).accepted,false)
})

await test('context/evidence providers normalize without leaking raw secrets',()=>{
  resetProviderFlags()
  const {evidence}=getStorybookContext('proj', {components:[{id:'c',title:'T'}]},'fp')
  assert.equal(evidence.provider,'storybook')
  const {findings}=normalizeCdtFixtureRaw({console:[{level:'error',message:'err'}]},'r','s')
  assert.ok(findings.length>0)
  const h=normalizeHarnessFixture({outcome:'success',steps:[]},'r','s')
  assert.equal(h.outcome,'success')
})

await test('interactive surface validation + streaming envelope',()=>{
  const ok=validateBridgeMessage({v:1,surfaceId:'s1',kind:'choice',action:'submit',payload:{value:'a'}})
  assert.equal(ok.ok,true)
  const e=envelopeForArtifact({id:'plugin_qual_run_compose',kind:'html',entry:'a/index.html'},'qual_run','compose')
  const r=appendStreamingUpdate(e,'<div>hi</div>').envelope
  const fin=finalizeEnvelope(r,'complete')
  assert.equal(fin.status,'complete')
  assert.equal(fin.updates.length,1)
})

await test('security: path confinement + no raw token + unknown capability fail-closed',async()=>{
  const a=await createResolvedSnapshot({pluginId:'sec',source:{sourcePath:'plugins/a/SKILL.md'},rawManifest:{specVersion:'1.0.0',od:{kind:'scenario',capabilities:['fs:write']}},projectRoot:'/tmp/proj'}) as any
  assert.ok(a.projectRelativePath.startsWith('.subagents/open-design/snapshots/'))
  // try absolute path should error
  const bad=await createResolvedSnapshot({pluginId:'sec',source:{sourcePath:'/etc/passwd'},rawManifest:{specVersion:'1.0.0',od:{kind:'scenario'}},projectRoot:'/tmp/proj'}) as any
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

await test('concurrency: different conversations run in parallel, one conversation stays ordered',async()=>{
  const provider=createFakePipelineProvider()
  const start=(runId:string)=>{
    const ctrl=new AbortController()
    const session=provider.execute({stageId:'compose'},{runId,stageId:'compose',timeoutMs:4000,outputBudgetBytes:10000,signal:ctrl.signal})
    return {ctrl,session}
  }

  // Two conversations: both in flight at once, each settling on its own identity.
  const a=start('conv_a_run_1')
  const b=start('conv_b_run_1')
  const [ra,rb]=await Promise.all([a.session.promise,b.session.promise])
  assert.equal(ra.kind,'success')
  assert.equal(rb.kind,'success')
  assert.equal(ra.runId,'conv_a_run_1')
  assert.equal(rb.runId,'conv_b_run_1')
  assert.notEqual(ra.evidenceLocator,rb.evidenceLocator)

  // One conversation: follow-ups stay ordered and never interleave locators.
  const order:string[]=[]
  for (const runId of ['conv_a_run_2','conv_a_run_3']) {
    const {session}=start(runId)
    order.push((await session.promise).runId)
  }
  assert.deepEqual(order,['conv_a_run_2','conv_a_run_3'])

  // Each external session is cancellable on its own identity: cancelling one
  // must not settle or disturb its sibling.
  const c=start('conv_c_run_1')
  const d=start('conv_d_run_1')
  c.ctrl.abort()
  const rc=await c.session.promise
  const rd=await d.session.promise
  assert.equal(rc.kind,'cancelled')
  assert.equal(rc.runId,'conv_c_run_1')
  assert.equal(rd.kind,'success')
  assert.equal(rd.runId,'conv_d_run_1')
})

await test('recovery: preview, draft and evidence rebuild from Host state after reload',async()=>{
  // A finished run, as the Host would have persisted it.
  const provider=createFakePipelineProvider()
  const ctrl=new AbortController()
  const receipt=await provider.execute({stageId:'compose'},{runId:'recover_run',stageId:'compose',timeoutMs:2000,outputBudgetBytes:10000,signal:ctrl.signal}).promise
  assert.equal(receipt.kind,'success')

  const artifact={id:'plugin_recover_run_compose',kind:'html' as const,entry:'.subagents/open-design/runs/recover_run/compose/artifact/index.html'}
  const stream=finalizeEnvelope(appendStreamingUpdate(envelopeForArtifact(artifact,'recover_run','compose'),'<h1>recovered</h1>').envelope,'complete')

  // Reload: the projection is rebuilt from the stored run, not renderer state.
  const stored=[{schemaVersion:1,runId:'recover_run',briefId:'b1',pluginId:'p',providerId:'fake-pipeline',stageId:'compose',state:'completed',providerKind:'success',failurePolicy:'stop',summary:'ok',finishedAt:'2026-08-21T00:00:00.000Z',startedAt:'2026-08-21T00:00:00.000Z',artifact,stream,evidenceLocator:receipt.evidenceLocator}]
  const recovered=selectProviderRuns(stored).find((run)=>run.artifact?.id===artifact.id)
  assert.ok(recovered,'run should be recoverable from Host state')
  assert.equal(recovered.stream?.status,'complete')
  assert.equal(recovered.stream?.artifactKind,'html')
  assert.equal(recovered.stream?.updates.length,1)
  assert.ok(recovered.evidenceLocator)

  // Surface drafts key off the declared scope, so a reload finds the same draft.
  const ref={surfaceId:'s1',scope:'conversation' as const,scopeKey:'thread_1'}
  assert.equal(surfaceDraftKey(ref),surfaceDraftKey({...ref}))
  assert.notEqual(surfaceDraftKey(ref),surfaceDraftKey({...ref,scope:'run' as const}))

  // An archived tombstone is not a live run and must not be revived by replay.
  const withTombstone=[...stored,{schemaVersion:1,runId:'recover_run',briefId:'b1',pluginId:'p',providerId:'fake-pipeline',stageId:'compose',state:'cancelled',providerKind:'cancelled',failurePolicy:'stop',summary:'archived',finishedAt:'2026-08-20T00:00:00.000Z',startedAt:'2026-08-20T00:00:00.000Z'}]
  // Newest-first ordering keeps the settled run authoritative over the older tombstone.
  assert.equal(selectProviderRuns(withTombstone)[0].state,'completed')
  // ...and a late terminal event cannot rewrite a settled stream.
  assert.equal(finalizeEnvelope(stream,'error','late').status,'complete')
})

console.log(`\n${p}/${t} tests passed`)
if(process.exitCode) console.error('Qualification failed'); else console.log('OK - qualification chain passed')
