import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import {
  buildVerifiedPromotionReceipt,
  normalizeReleaseChannel,
  publishVerifiedPromotion,
} from './release-promotion.mjs'

let passed = 0

async function test(name, fn) {
  await fn()
  console.log(`  ✓ ${name}`)
  passed += 1
}

console.log('Release promotion smoke\n')

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
const sign = (value, privateKey) => crypto.createSign('RSA-SHA256').update(canonical(value)).end().sign(privateKey).toString('base64')

async function createPromotionFixture({ channel = 'beta', urlChannel = channel, qualificationReady = true, mismatchedAttempt = false, contentSalt = '', commit = '0123456789abcdef0123456789abcdef01234567' } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentstudio-promotion-'))
  const evidenceRoot = path.join(root, 'evidence')
  const artifactRoot = path.join(root, 'artifacts')
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' })
  const updatePublicKeyPath = path.join(root, 'updatePublicKey.ts')
  await fs.writeFile(updatePublicKeyPath, `export const BUILT_IN_UPDATE_PUBLIC_KEY = \`${publicKeyPem.trim()}\`\n`)
  const publicBaseUrls = {
    beta: 'https://updates.example.test/beta',
    stable: 'https://updates.example.test/stable',
  }
  const identity = {
    commit,
    runId: '4242',
    runAttempt: '2',
    version: '1.2.3',
    channel,
  }
  const targets = [
    { evidenceName: 'windows-x64', platform: 'windows', updatePlatform: 'win32', arch: 'x64', file: 'AgentStudio Setup 1.2.3.exe' },
    { evidenceName: 'macos-x64', platform: 'macos', updatePlatform: 'darwin', arch: 'x64', file: 'AgentStudio-1.2.3-x64.dmg' },
    { evidenceName: 'macos-arm64', platform: 'macos', updatePlatform: 'darwin', arch: 'arm64', file: 'AgentStudio-1.2.3-arm64.dmg' },
  ]
  for (const [index, target] of targets.entries()) {
    const evidenceDir = path.join(evidenceRoot, target.evidenceName)
    const artifactDir = path.join(artifactRoot, `${target.evidenceName}-run-2-artifacts`)
    await fs.mkdir(path.join(evidenceDir, 'update-channel'), { recursive: true })
    await fs.mkdir(artifactDir, { recursive: true })
    const bytes = Buffer.from(`signed-${target.platform}-${target.arch}${contentSalt}`)
    const digest = sha256(bytes)
    await fs.writeFile(path.join(artifactDir, target.file), bytes)
    await fs.writeFile(path.join(evidenceDir, 'verification.log'), [
      'AgentStudio release verification',
      `platform=${target.platform}`,
      `arch=${target.arch}`,
      `attempt=${mismatchedAttempt && index === 2 ? '1' : identity.runAttempt}`,
      `version=${identity.version}`,
      `channel=${identity.channel}`,
      'status=success',
      '',
    ].join('\n'))
    await fs.writeFile(path.join(evidenceDir, 'release-manifest.json'), `${JSON.stringify({
      schemaVersion: 1,
      product: 'AgentStudio',
      version: identity.version,
      channel: identity.channel,
      platform: target.platform,
      arch: target.arch,
      artifacts: [{ name: target.file, size: bytes.length, sha256: digest }],
      provenance: {
        commit: identity.commit,
        runId: identity.runId,
        runAttempt: identity.runAttempt,
      },
    })}\n`)
    const artifact = {
      url: `${publicBaseUrls[urlChannel]}/${target.updatePlatform}/${target.arch}/${encodeURIComponent(target.file)}`,
      size: bytes.length,
      sha256: digest,
      signature: '',
      signatureAlgorithm: 'rsa-sha256',
    }
    artifact.signature = sign({ sha256: artifact.sha256, size: artifact.size, url: artifact.url }, privateKey)
    const updateManifest = {
      schemaVersion: 1,
      product: 'SubAgents AI',
      version: identity.version,
      channel: identity.channel,
      platform: target.updatePlatform,
      arch: target.arch,
      artifact,
      signature: '',
    }
    const unsignedManifest = { ...updateManifest }
    delete unsignedManifest.signature
    updateManifest.signature = sign(unsignedManifest, privateKey)
    await fs.writeFile(path.join(evidenceDir, 'update-channel', 'manifest.json'), `${JSON.stringify(updateManifest)}\n`)
  }
  const qualificationPath = path.join(root, 'paid-beta-qualification.json')
  await fs.writeFile(qualificationPath, `${JSON.stringify({
    releaseVersion: identity.version,
    decision: 'GO',
    ready: qualificationReady,
    evaluatedAt: '2026-08-31T00:00:00.000Z',
  })}\n`)
  return { root, evidenceRoot, artifactRoot, qualificationPath, identity, publicBaseUrls, updatePublicKeyPath }
}

const receiptInput = (fixture) => ({
  evidenceRoot: fixture.evidenceRoot,
  artifactRoot: fixture.artifactRoot,
  qualificationPath: fixture.qualificationPath,
  publicBaseUrls: fixture.publicBaseUrls,
  updatePublicKeyPath: fixture.updatePublicKeyPath,
  ...fixture.identity,
})

async function startFakePromotionEndpoint() {
  const state = {
    requests: [],
    staging: new Map(),
    active: new Map(),
    promotions: new Map(),
    failNextManifest: false,
    badAcknowledgment: false,
  }
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    const channel = url.pathname.split('/')[1]
    const body = Buffer.concat(await Array.fromAsync(request))
    state.requests.push({ method: request.method, path: url.pathname })
    if (request.headers.authorization !== 'Bearer test-token') {
      response.writeHead(401).end()
      return
    }
    if (request.method === 'HEAD') {
      const staged = state.staging.get(url.pathname)
      if (!staged) response.writeHead(404).end()
      else response.writeHead(200, { 'x-content-sha256': staged.sha256 }).end()
      return
    }
    if (request.method === 'PUT') {
      if (state.failNextManifest && url.pathname.endsWith('/manifest.json')) {
        state.failNextManifest = false
        response.writeHead(503).end('injected manifest failure')
        return
      }
      const digest = sha256(body)
      if (digest !== request.headers['x-content-sha256']) {
        response.writeHead(400).end('hash mismatch')
        return
      }
      const existing = state.staging.get(url.pathname)
      if (existing && existing.sha256 !== digest) {
        response.writeHead(409).end('staging conflict')
        return
      }
      state.staging.set(url.pathname, { bytes: body, sha256: digest })
      response.writeHead(existing ? 200 : 201).end()
      return
    }
    if (request.method === 'POST' && /\/promotions\/[^/]+$/.test(url.pathname)) {
      const receipt = JSON.parse(body.toString('utf8'))
      const promotionKey = `${channel}/${receipt.version}`
      const existingIdentity = state.promotions.get(promotionKey)
      if (existingIdentity && existingIdentity !== receipt.promotionIdentity) {
        response.writeHead(409).end('promotion conflict')
        return
      }
      for (const target of receipt.targets) {
        const prefix = `/${channel}/staging/${receipt.promotionIdentity}/${target.platform}/${target.arch}`
        if (!state.staging.has(`${prefix}/${encodeURIComponent(target.artifact.name)}`) || !state.staging.has(`${prefix}/manifest.json`)) {
          response.writeHead(422).end('incomplete staging set')
          return
        }
      }
      if (!existingIdentity) {
        for (const target of receipt.targets) {
          const prefix = `/${channel}/staging/${receipt.promotionIdentity}/${target.platform}/${target.arch}`
          state.active.set(`${channel}/${target.platform}/${target.arch}/${target.artifact.name}`, state.staging.get(`${prefix}/${encodeURIComponent(target.artifact.name)}`))
          state.active.set(`${channel}/${target.platform}/${target.arch}/manifest.json`, state.staging.get(`${prefix}/manifest.json`))
        }
        state.promotions.set(promotionKey, receipt.promotionIdentity)
      }
      response.writeHead(existingIdentity ? 200 : 201, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        promotionIdentity: state.badAcknowledgment ? 'promotion_wrong' : receipt.promotionIdentity,
        channel: receipt.channel,
        version: receipt.version,
      }))
      return
    }
    response.writeHead(404).end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return {
    state,
    destinations: {
      beta: `http://127.0.0.1:${address.port}/beta`,
      stable: `http://127.0.0.1:${address.port}/stable`,
    },
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  }
}

await test('release channel is a closed beta/stable enum', () => {
  assert.equal(normalizeReleaseChannel('beta'), 'beta')
  assert.equal(normalizeReleaseChannel('stable'), 'stable')
  assert.throws(() => normalizeReleaseChannel('preview'), /unsupported release channel: preview/)
  assert.throws(() => normalizeReleaseChannel(''), /unsupported release channel/)
})

await test('verified receipt binds one commit, attempt, version, qualification, manifests, and installers', async () => {
  const fixture = await createPromotionFixture()
  const receipt = await buildVerifiedPromotionReceipt({
    ...receiptInput(fixture),
    issuedAt: '2026-08-31T01:00:00.000Z',
  })
  assert.equal(receipt.schemaVersion, 1)
  assert.equal(receipt.verified, true)
  assert.equal(receipt.channel, 'beta')
  assert.equal(receipt.targets.length, 3)
  assert.match(receipt.promotionIdentity, /^promotion_[a-f0-9]{64}$/)
  assert.match(receipt.qualification.sha256, /^[a-f0-9]{64}$/)
  assert.equal(receipt.targets.every((target) => target.artifact.sha256 && target.manifest.sha256), true)

  const mixed = await createPromotionFixture({ mismatchedAttempt: true })
  await assert.rejects(
    buildVerifiedPromotionReceipt({
      ...receiptInput(mixed),
    }),
    /verification attempt mismatch/,
  )

  const wrongChannelUrl = await createPromotionFixture({ urlChannel: 'stable' })
  await assert.rejects(buildVerifiedPromotionReceipt(receiptInput(wrongChannelUrl)), /update artifact public URL mismatch/)

  const wrongReadyType = await createPromotionFixture({ qualificationReady: 'true' })
  await assert.rejects(buildVerifiedPromotionReceipt(receiptInput(wrongReadyType)), /qualification readiness mismatch/)

  const tamperedManifest = await createPromotionFixture()
  const manifestPath = path.join(tamperedManifest.evidenceRoot, 'windows-x64', 'update-channel', 'manifest.json')
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  manifest.releaseNotes = 'tampered after signing'
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest)}\n`)
  await assert.rejects(buildVerifiedPromotionReceipt(receiptInput(tamperedManifest)), /update manifest signature is invalid/)
})

await test('publisher stages installers before manifests and atomically commits one isolated channel', async () => {
  const fixture = await createPromotionFixture()
  const receipt = await buildVerifiedPromotionReceipt({
    ...receiptInput(fixture),
    issuedAt: '2026-08-31T01:00:00.000Z',
  })
  const endpoint = await startFakePromotionEndpoint()
  try {
    const published = await publishVerifiedPromotion({
      receipt,
      evidenceRoot: fixture.evidenceRoot,
      artifactRoot: fixture.artifactRoot,
      destinations: endpoint.destinations,
      token: 'test-token',
      expectedIdentity: fixture.identity,
      allowInsecureLocalhost: true,
      publishedAt: '2026-08-31T02:00:00.000Z',
    })
    const writes = endpoint.state.requests.filter((request) => request.method === 'PUT')
    const lastInstaller = Math.max(...writes.map((request, index) => request.path.endsWith('/manifest.json') ? -1 : index))
    const firstManifest = writes.findIndex((request) => request.path.endsWith('/manifest.json'))
    assert.ok(lastInstaller < firstManifest, 'every installer must be staged before the first manifest')
    assert.equal(endpoint.state.requests.at(-1).method, 'POST')
    assert.equal([...endpoint.state.active.keys()].filter((key) => key.startsWith('beta/')).length, 6)
    assert.equal([...endpoint.state.active.keys()].filter((key) => key.startsWith('stable/')).length, 0)
    assert.equal(published.status, 'published')
    assert.equal(published.channel, 'beta')
    assert.doesNotMatch(JSON.stringify(published), /test-token/)
  } finally {
    await endpoint.close()
  }
})

await test('Beta and Stable destinations cannot collapse to the same public channel', async () => {
  const fixture = await createPromotionFixture()
  const receipt = await buildVerifiedPromotionReceipt({
    ...receiptInput(fixture),
  })
  await assert.rejects(
    publishVerifiedPromotion({
      receipt,
      evidenceRoot: fixture.evidenceRoot,
      artifactRoot: fixture.artifactRoot,
      destinations: { beta: 'https://updates.example.test/channel', stable: 'https://updates.example.test/channel' },
      token: 'test-token',
      expectedIdentity: fixture.identity,
    }),
    /Beta and Stable promotion destinations must be distinct/,
  )
})

await test('publisher requires workflow identity and a matching atomic commit acknowledgment', async () => {
  const fixture = await createPromotionFixture()
  const receipt = await buildVerifiedPromotionReceipt(receiptInput(fixture))
  const endpoint = await startFakePromotionEndpoint()
  try {
    await assert.rejects(
      publishVerifiedPromotion({
        receipt,
        evidenceRoot: fixture.evidenceRoot,
        artifactRoot: fixture.artifactRoot,
        destinations: endpoint.destinations,
        token: 'test-token',
        expectedIdentity: { ...fixture.identity, runAttempt: '3' },
        allowInsecureLocalhost: true,
      }),
      /published receipt runAttempt mismatch/,
    )
    endpoint.state.badAcknowledgment = true
    await assert.rejects(
      publishVerifiedPromotion({
        receipt,
        evidenceRoot: fixture.evidenceRoot,
        artifactRoot: fixture.artifactRoot,
        destinations: endpoint.destinations,
        token: 'test-token',
        expectedIdentity: fixture.identity,
        allowInsecureLocalhost: true,
      }),
      /promotion commit acknowledgment promotionIdentity mismatch/,
    )
  } finally {
    await endpoint.close()
  }
})

await test('promotion retry is idempotent, conflicting hashes fail, and failed staging stays inactive', async () => {
  const endpoint = await startFakePromotionEndpoint()
  try {
    const beta = await createPromotionFixture()
    const betaReceipt = await buildVerifiedPromotionReceipt({
      ...receiptInput(beta),
    })
    const publish = (fixture, receipt) => publishVerifiedPromotion({
      receipt,
      evidenceRoot: fixture.evidenceRoot,
      artifactRoot: fixture.artifactRoot,
      destinations: endpoint.destinations,
      token: 'test-token',
      expectedIdentity: fixture.identity,
      allowInsecureLocalhost: true,
    })
    await publish(beta, betaReceipt)
    const initialPutCount = endpoint.state.requests.filter((request) => request.method === 'PUT').length
    await publish(beta, betaReceipt)
    assert.equal(endpoint.state.requests.filter((request) => request.method === 'PUT').length, initialPutCount)

    const conflict = await createPromotionFixture({
      contentSalt: '-conflict',
      commit: 'fedcba9876543210fedcba9876543210fedcba98',
    })
    const conflictReceipt = await buildVerifiedPromotionReceipt({
      ...receiptInput(conflict),
    })
    await assert.rejects(publish(conflict, conflictReceipt), /promotion commit failed \(409\)/)
    assert.equal(endpoint.state.promotions.get('beta/1.2.3'), betaReceipt.promotionIdentity)

    const stable = await createPromotionFixture({ channel: 'stable' })
    const stableReceipt = await buildVerifiedPromotionReceipt({
      ...receiptInput(stable),
    })
    endpoint.state.failNextManifest = true
    await assert.rejects(publish(stable, stableReceipt), /promotion staging failed \(503\)/)
    assert.equal([...endpoint.state.active.keys()].some((key) => key.startsWith('stable/')), false)
    await publish(stable, stableReceipt)
    assert.equal([...endpoint.state.active.keys()].filter((key) => key.startsWith('stable/')).length, 6)
    assert.equal(endpoint.state.promotions.get('beta/1.2.3'), betaReceipt.promotionIdentity)
    assert.equal(endpoint.state.promotions.get('stable/1.2.3'), stableReceipt.promotionIdentity)
  } finally {
    await endpoint.close()
  }
})

console.log(`\n${passed} release promotion tests passed`)
