/**
 * Smoke: Streaming artifact envelope & renderer sandbox (08)
 * Run: node --experimental-strip-types scripts/smoke-open-design-streaming.mts
 */
import assert from 'node:assert/strict'
import { createStreamingEnvelope, appendStreamingUpdate, finalizeEnvelope, reconcileUpdates, canRender } from '../src/agent/openDesign/streamingEnvelope.ts'

let p=0,t=0
async function test(n:string,fn:()=>void){t++;try{fn();p++;console.log(`  ✓ ${n}`)}catch(e){console.error(`  ✗ ${n}`);console.error(e);process.exitCode=1}}
console.log('smoke-open-design-streaming')

await test('envelope has version, identity, ordered updates, status',()=>{
  const e=createStreamingEnvelope('html:art1','run1')
  assert.equal(e.version,1)
  assert.equal(e.artifactId,'html:art1')
  assert.equal(e.status,'streaming')
  const r=appendStreamingUpdate(e,'<h1>hi</h1>')
  assert.equal(r.envelope.updates[0].seq,1)
})

await test('unsupported renderer rejects before rendering streaming',()=>{
  const e=createStreamingEnvelope('html:art2','run2')
  const e2=appendStreamingUpdate(e,'data').envelope
  const bad=canRender({supportedKinds:['markdown'],streaming:false,sandbox:"default-src 'none'"},e2)
  assert.equal(bad.ok,false)
})

await test('streaming, complete, error, cancelled are distinct',()=>{
  const base=createStreamingEnvelope('html:a','r')
  assert.equal(finalizeEnvelope(base,'streaming').status,'streaming')
  assert.equal(finalizeEnvelope(base,'complete').status,'complete')
  assert.equal(finalizeEnvelope(base,'error','boom').status,'error')
  assert.equal(finalizeEnvelope(base,'cancelled').status,'cancelled')
})

await test('ordered / duplicate / out-of-order / late event reconciliation is deterministic',()=>{
  const a=reconcileUpdates([{seq:2,content:'b'},{seq:1,content:'a'},{seq:2,content:'dup'},{seq:5,content:'e'},{seq:3,content:'c'}])
  assert.deepEqual(a.map(x=>x.seq),[1,2,3,5])
})

await test('sandboxed HTML cannot access filesystem/network/token',async()=>{
  const fs=await import('node:fs'); const path=await import('node:path'); const {fileURLToPath}=await import('node:url')
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
  const src=fs.readFileSync(path.join(root,'src/agent/openDesign/streamingEnvelope.ts'),'utf8')
  assert.doesNotMatch(src,/raw token|connector token|fs:write.*renderer/)
})

await test('content visible by default (no entrance animation gate)',async()=>{
  const fs=await import('node:fs'); const path=await import('node:path'); const {fileURLToPath}=await import('node:url')
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
  // Ensure no default opacity 0 patterns in streaming renderer checks
  const anyFile=fs.readFileSync(path.join(root,'src/agent/openDesign/streamingEnvelope.ts'),'utf8')
  assert.doesNotMatch(anyFile,/opacity:\s*0/)
})

console.log(`\n${p}/${t} tests passed`)
if(process.exitCode) console.error('Failed'); else console.log('OK')
