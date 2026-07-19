/**
 * Issue 06 — security & trust hardening smoke.
 * 驗證 renderer CSP、導覽/外開/權限 allowlist、secrets 明文落地 gating 的純邏輯。
 */
import assert from 'node:assert/strict'
import {
  buildRendererCsp,
  decidePermissionRequest,
  decideSecretPersistence,
  isAllowedNavigationUrl,
  isSafeExternalUrl,
} from '../electron/securityPolicy.ts'

// ── Renderer CSP（打包 renderer 必備、方向明確）───────────────────
{
  const csp = buildRendererCsp()
  const directives = new Map(
    csp.split(';').map((part) => {
      const [name, ...rest] = part.trim().split(/\s+/)
      return [name, rest] as const
    }),
  )
  // scripts 只能來自 app bundle — 阻擋遠端/內聯注入
  assert.deepEqual(directives.get('script-src'), ["'self'"])
  assert.ok(!csp.includes('unsafe-eval'), 'CSP 不得允許 eval')
  assert.ok(!csp.includes("script-src 'self' 'unsafe-inline'"), 'script-src 不得 unsafe-inline')

  // 打包 index.html 有 file: 協定 module-loader 內聯 shim → 以 sha256 hash 放行，非 unsafe-inline
  const hashed = buildRendererCsp({ inlineScriptHashes: ["'sha256-abc123='"] })
  const hashedScriptSrc = hashed
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith('script-src'))
  assert.equal(hashedScriptSrc, "script-src 'self' 'sha256-abc123='")
  assert.deepEqual(directives.get('object-src'), ["'none'"])
  assert.deepEqual(directives.get('base-uri'), ["'none'"])
  assert.deepEqual(directives.get('form-action'), ["'none'"])
  assert.deepEqual(directives.get('frame-src'), ["'none'"])
  // CodeMode 在 Blob Worker 中執行 → worker-src 必須含 blob:
  assert.ok(directives.get('worker-src')?.includes('blob:'), 'CodeMode 需要 blob: worker')
  // 使用者自訂 LLM / 本機 Ollama / MCP HTTP → connect-src 需允許 http(s)/ws(s)
  for (const scheme of ['https:', 'http:', 'ws:', 'wss:']) {
    assert.ok(directives.get('connect-src')?.includes(scheme), `connect-src 缺 ${scheme}`)
  }
  // Google Fonts（index.html 現況）
  assert.ok(directives.get('style-src')?.includes('https://fonts.googleapis.com'))
  assert.ok(directives.get('font-src')?.includes('https://fonts.gstatic.com'))
  assert.ok(directives.get('img-src')?.includes('data:'))
  assert.deepEqual(directives.get('default-src'), ["'self'"])
}

// ── 外開 URL：只允許 http/https/mailto ────────────────────────────
{
  assert.equal(isSafeExternalUrl('https://example.com/docs'), true)
  assert.equal(isSafeExternalUrl('http://localhost:8080/dash'), true)
  assert.equal(isSafeExternalUrl('mailto:hi@subagents.ai'), true)
  assert.equal(isSafeExternalUrl('file:///C:/Windows/System32/calc.exe'), false)
  assert.equal(isSafeExternalUrl('javascript:alert(1)'), false)
  assert.equal(isSafeExternalUrl('smb://evil/share'), false)
  assert.equal(isSafeExternalUrl('vbscript:x'), false)
  assert.equal(isSafeExternalUrl(''), false)
  assert.equal(isSafeExternalUrl('not a url'), false)
}

// ── 導覽 allowlist：dev server 同源 + 打包 file: index ────────────
{
  const dev = { devServerUrl: 'http://localhost:5173/' }
  assert.equal(isAllowedNavigationUrl('http://localhost:5173/', dev), true)
  assert.equal(isAllowedNavigationUrl('http://localhost:5173/#/settings', dev), true)
  assert.equal(isAllowedNavigationUrl('https://evil.example/phish', dev), false)
  assert.equal(isAllowedNavigationUrl('http://localhost:9999/', dev), false)
  // 打包：file: 只允許 app 自己的 index.html — 任意本機 HTML（如下載的附件）不得載入
  const packaged = { appIndexFileUrl: 'file:///D:/app/dist/index.html' }
  assert.equal(isAllowedNavigationUrl('file:///D:/app/dist/index.html', packaged), true)
  assert.equal(isAllowedNavigationUrl('file:///D:/app/dist/index.html#/settings', packaged), true)
  assert.equal(
    isAllowedNavigationUrl('file:///C:/Users/x/Downloads/evil.html', packaged),
    false,
    '任意 file: URL 不得放行',
  )
  // 無 appIndex 資訊（純瀏覽器模式）退回允許 file:
  assert.equal(isAllowedNavigationUrl('file:///D:/app/dist/index.html', {}), true)
  assert.equal(isAllowedNavigationUrl('https://evil.example/', {}), false)
  assert.equal(isAllowedNavigationUrl('javascript:alert(1)', dev), false)
}

// ── 權限請求：deny-by-default，僅白名單 ──────────────────────────
{
  assert.equal(decidePermissionRequest('clipboard-sanitized-write'), true)
  assert.equal(decidePermissionRequest('notifications'), true)
  assert.equal(decidePermissionRequest('fullscreen'), true)
  for (const denied of ['media', 'geolocation', 'midi', 'hid', 'serial', 'usb', 'openExternal', 'pointerLock', 'unknown-future-permission']) {
    assert.equal(decidePermissionRequest(denied), false, `${denied} 應拒絕`)
  }
}

// ── Secrets 落地決策：無 OS 鑰匙圈 → 預設拒絕，明確同意才可明文 ──
{
  assert.deepEqual(
    decideSecretPersistence({ encryptionAvailable: true }),
    { mode: 'encrypted' },
  )
  const refused = decideSecretPersistence({ encryptionAvailable: false })
  assert.equal(refused.mode, 'refuse')
  assert.equal(refused.code, 'PLAINTEXT_REQUIRED')
  assert.ok(refused.reason && refused.reason.length > 0, 'refuse 需附說明')
  assert.deepEqual(
    decideSecretPersistence({ encryptionAvailable: false, allowPlaintext: true }),
    { mode: 'plaintext' },
  )
  // 有加密時 allowPlaintext 不得降級
  assert.deepEqual(
    decideSecretPersistence({ encryptionAvailable: true, allowPlaintext: true }),
    { mode: 'encrypted' },
  )
}

// ── Settings 匯出遮罩：pattern-based，新增祕密欄位不會漏 ─────────
{
  const { REDACTED, bundleSensitivityNotice, redactSettingsForExport } = await import(
    '../src/agent/settingsExport.ts'
  )
  const input = {
    apiKey: 'sk-live-123',
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-5',
    maxTokens: 4096,
    telegramBotToken: '12345:abc',
    webhookToken: 'wh-1',
    customToolSecrets: { github: 'ghp_x', notion: '' },
    pluginOAuthClients: { gh: { clientId: 'cid', clientSecret: 'cs' } },
    cliProviders: [{ id: 'p1', apiKey: 'k1', baseUrl: 'https://x' }],
    // 未來新增的祕密欄位 — 靠 key pattern 掃到，不用改遮罩碼
    futureServicePassword: 'hunter2',
    someAccessToken: 'tok',
    tokenType: 'bearer', // 非祕密，不得誤傷
    // 自訂 HTTP 工具的 header 憑證（review finding：Authorization 不得漏）
    customTools: [
      {
        name: 'my-api',
        template: {
          headers: {
            Authorization: 'Bearer raw-key-1',
            Cookie: 'session=abc',
            'Content-Type': 'application/json',
          },
        },
      },
    ],
  }
  const { settings: redacted, redactedFields } = redactSettingsForExport(input)
  assert.equal(redacted.apiKey, REDACTED)
  assert.equal(redacted.telegramBotToken, REDACTED)
  assert.equal(redacted.webhookToken, REDACTED)
  assert.equal(redacted.customToolSecrets.github, REDACTED)
  assert.equal(redacted.customToolSecrets.notion, '', '空值不需遮罩')
  assert.equal(redacted.pluginOAuthClients.gh.clientSecret, REDACTED)
  assert.equal(redacted.pluginOAuthClients.gh.clientId, 'cid')
  assert.equal(redacted.cliProviders[0].apiKey, REDACTED)
  assert.equal(redacted.cliProviders[0].baseUrl, 'https://x')
  assert.equal(redacted.futureServicePassword, REDACTED, '新祕密欄位需被 pattern 掃到')
  assert.equal(redacted.customTools[0].template.headers.Authorization, REDACTED)
  assert.equal(redacted.customTools[0].template.headers.Cookie, REDACTED)
  assert.equal(redacted.customTools[0].template.headers['Content-Type'], 'application/json')
  assert.equal(redacted.someAccessToken, REDACTED)
  assert.equal(redacted.model, 'gpt-5')
  assert.equal(redacted.baseUrl, 'https://api.example.com/v1')
  assert.equal(redacted.maxTokens, 4096)
  assert.equal(redacted.tokenType, 'bearer')
  assert.ok(redactedFields.includes('apiKey'))
  assert.ok(redactedFields.includes('futureServicePassword'))
  assert.ok(!redactedFields.includes('tokenType'))
  // 匯出檔整體不得含原始祕密
  const json = JSON.stringify(redacted)
  for (const leak of ['sk-live-123', 'ghp_x', '12345:abc', 'hunter2', 'cs', 'k1', 'raw-key-1', 'session=abc']) {
    assert.ok(!json.includes(`"${leak}"`), `匯出洩漏 ${leak}`)
  }
  // 敏感 metadata 說明（排程/事件/hermes 內容可能含敏感資訊）需存在
  const notice = bundleSensitivityNotice()
  assert.ok(notice.includes('排程'))
  assert.ok(notice.includes('Hermes') || notice.includes('hermes'))
  assert.ok(notice.length > 40, '需向使用者說明匯出內容的敏感性')
}

// ── Release qualification 安全門檻（issue 06）─────────────────────
{
  const { evaluateDependencyAudit, loadSecurityExceptions, scanTextForSecrets } = await import(
    './security-gates.mjs'
  )
  const future = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
  const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString()

  // 依賴稽核：high/critical 未被例外覆蓋 → fail
  const audit = {
    metadata: { vulnerabilities: { info: 0, low: 1, moderate: 2, high: 0, critical: 0 } },
    vulnerabilities: {},
  }
  assert.equal(evaluateDependencyAudit(audit, []).ok, true, 'moderate 以下不擋 release')
  // 空殼 / 格式錯誤的 audit 報告不得默默放行（fail closed）
  assert.equal(evaluateDependencyAudit({}, []).ok, false, '缺 metadata 的報告需 fail')
  assert.equal(evaluateDependencyAudit(null, []).ok, false)
  const bad = {
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 1 } },
    vulnerabilities: {
      'evil-pkg': { severity: 'critical' },
      'meh-pkg': { severity: 'high' },
    },
  }
  const failed = evaluateDependencyAudit(bad, [])
  assert.equal(failed.ok, false)
  assert.equal(failed.failures.length, 2)
  const excepted = evaluateDependencyAudit(bad, [
    { scope: 'dependency-audit', id: 'evil-pkg', reason: 'no fix upstream; not reachable', approvedBy: 'tommy', expires: future },
    { scope: 'dependency-audit', id: 'meh-pkg', reason: 'dev-only dep', approvedBy: 'tommy', expires: future },
  ])
  assert.equal(excepted.ok, true)
  assert.equal(excepted.exceptionsApplied.length, 2)
  // 過期例外無效
  assert.equal(
    evaluateDependencyAudit(bad, [
      { scope: 'dependency-audit', id: 'evil-pkg', reason: 'x', approvedBy: 'tommy', expires: past },
      { scope: 'dependency-audit', id: 'meh-pkg', reason: 'x', approvedBy: 'tommy', expires: future },
    ]).ok,
    false,
    '過期例外不得放行',
  )

  // 例外檔驗證：缺 reason / expires → invalid
  const loaded = loadSecurityExceptions(
    JSON.stringify([
      { scope: 'secret-scan', id: 'docs/sample', reason: 'fixture token', approvedBy: 'tommy', expires: future },
      { scope: 'dependency-audit', id: 'no-reason', approvedBy: 'tommy', expires: future },
    ]),
  )
  assert.equal(loaded.valid.length, 1)
  assert.equal(loaded.invalid.length, 1)

  // Secret scan：高訊號 pattern
  // 測試樣本以 runtime 串接組出，避免本檔被 secret scan 自己掃到
  const sample = [
    `const gh = "${'ghp' + '_' + 'a1b2c3d4'.repeat(5)}"`,
    `aws_access_key_id = ${'AKIA' + 'IOSFODNN7EXAMPLE'}`,
    ['-----BEGIN RSA', 'PRIVATE KEY-----'].join(' '),
    `const anthropic = "${'sk-ant' + '-api03-' + 'x'.repeat(24)}"`,
  ].join('\n')
  const findings = scanTextForSecrets(sample, { path: 'src/leaky.ts' })
  assert.ok(findings.length >= 4, `應偵測 4 類祕密，got ${findings.length}`)
  assert.ok(findings.every((f: { path: string }) => f.path === 'src/leaky.ts'))
  // 乾淨文字與遮罩佔位不誤報
  assert.deepEqual(scanTextForSecrets('const k = "***REDACTED***"; {{secret:github}}', {}), [])
  assert.deepEqual(scanTextForSecrets('normal code without credentials', {}), [])
}

// ── Source drift guards：main.ts / vite.config 必須掛上 policy ────
{
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const url = await import('node:url')
  const appRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')
  const mainTs = await fs.readFile(path.join(appRoot, 'electron', 'main.ts'), 'utf8')
  const viteConfig = await fs.readFile(path.join(appRoot, 'vite.config.ts'), 'utf8')

  assert.ok(mainTs.includes("from './securityPolicy'"), 'main.ts 需引用 securityPolicy')
  assert.ok(mainTs.includes("on('will-navigate'"), 'main.ts 需掛 will-navigate guard')
  assert.ok(mainTs.includes('appIndexFileUrl'), '打包 file: 導覽需 pin 到 app index.html')
  assert.ok(mainTs.includes('setWindowOpenHandler'), 'main.ts 需掛 setWindowOpenHandler')
  assert.ok(
    mainTs.includes('setPermissionRequestHandler'),
    'main.ts 需掛 setPermissionRequestHandler',
  )
  assert.ok(
    /setWindowOpenHandler\(\(\{ url \}\) => \{\s*\n\s*if \(isSafeExternalUrl\(url\)\)/.test(mainTs),
    'window.open 需經 isSafeExternalUrl 才可 openExternal',
  )
  assert.ok(
    /'shell:openExternal'[\s\S]{0,200}isSafeExternalUrl/.test(mainTs),
    'shell:openExternal IPC 需經 isSafeExternalUrl',
  )
  // Renderer isolation 基線：所有 BrowserWindow 都必須 contextIsolation + 無 nodeIntegration
  const webPrefBlocks = [...mainTs.matchAll(/webPreferences:\s*\{[^}]*\}/g)].map((m) => m[0])
  assert.ok(webPrefBlocks.length >= 1, 'main.ts 應有 BrowserWindow webPreferences')
  for (const block of webPrefBlocks) {
    assert.ok(block.includes('contextIsolation: true'), `缺 contextIsolation: true → ${block}`)
    assert.ok(block.includes('nodeIntegration: false'), `缺 nodeIntegration: false → ${block}`)
  }
  // sandbox: false 只允許出現在主視窗（preload 需 node require），且必須有文件說明
  const sandboxOff = webPrefBlocks.filter((b) => b.includes('sandbox: false'))
  assert.ok(sandboxOff.length <= 1, 'sandbox: false 只允許主視窗一處')
  const baseline = await fs.readFile(path.join(appRoot, '..', 'docs', 'SECURITY_BASELINE.md'), 'utf8')
  assert.ok(baseline.includes('sandbox'), 'SECURITY_BASELINE.md 需說明 sandbox 決策')

  assert.ok(viteConfig.includes('inject-renderer-csp'), 'vite.config 需注入 production CSP')
  assert.ok(viteConfig.includes('buildRendererCsp'), 'vite.config CSP 需來自 securityPolicy')

  // Vault：無 OS 鑰匙圈 → 預設拒絕明文，不得再靜默寫 PLAIN
  const vaultTs = await fs.readFile(path.join(appRoot, 'electron', 'secretsVault.ts'), 'utf8')
  assert.ok(
    vaultTs.includes('decideSecretPersistence'),
    'secretsVault 需用 decideSecretPersistence 決策',
  )
  assert.ok(vaultTs.includes('PLAINTEXT_REQUIRED'), 'secretsVault 需以 PLAINTEXT_REQUIRED 拒絕')
  // migrate 不得在無加密時靜默落地；hydrate 只在 migrate 成功後刪 legacy
  assert.ok(
    /migrateIntoVault[\s\S]{0,600}canEncrypt\(\)/.test(vaultTs),
    'migrateIntoVault 需檢查加密可用性',
  )
  const hydrateTs = await fs.readFile(
    path.join(appRoot, 'src', 'agent', 'hermes', 'pluginSecrets.ts'),
    'utf8',
  )
  assert.ok(
    /migrate\(legacy\)[\s\S]{0,400}removeItem/.test(hydrateTs) &&
      /\.ok[\s\S]{0,200}removeItem/.test(hydrateTs),
    'hydrate 只能在 migrate 成功後移除 legacy localStorage',
  )
}

// ── Public trust docs 草稿存在且非空殼（issue 06 checkbox 7）──────
{
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const url = await import('node:url')
  const docsPublic = path.resolve(
    path.dirname(url.fileURLToPath(import.meta.url)),
    '..', '..', 'docs', 'public',
  )
  const required = [
    'SECURITY_WHITEPAPER.md',
    'DATA_FLOW.md',
    'PRIVACY_POLICY.md',
    'DATA_RETENTION_DELETION.md',
    'EULA.md',
    'TERMS_OF_SERVICE.md',
    'REFUND_POLICY.md',
  ]
  for (const name of required) {
    const text = await fs.readFile(path.join(docsPublic, name), 'utf8')
    const bytes = Buffer.byteLength(text, 'utf8')
    assert.ok(bytes > 800, `${name} 草稿過短（${bytes} bytes）`)
    assert.ok(/^# /m.test(text), `${name} 需有標題`)
    assert.ok(/draft|草稿/i.test(text), `${name} 需標示 draft 狀態`)
  }
}

console.log('smoke-security: securityPolicy OK')
