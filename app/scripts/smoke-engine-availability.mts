/**
 * first-run-honesty ticket 02 — engine availability derivation smoke.
 *
 * 全枚舉輸入組合，驗證橫幅顯示判定與醫生卡三態的不變量，
 * 以及 fromSettings 投影與 CliProviderConfig 的 enabled/authorized 語義。
 */
import assert from 'node:assert/strict'
import {
  ENGINE_BANNER_COPY,
  LLM_CHECK_COPY,
  deriveEngineAvailability,
  deriveEngineAvailabilityFromSettings,
} from '../src/agent/engineAvailability.ts'
import { SIMULATION_NOTE, isSimulationRun } from '../src/agent/simulationMarking.ts'
import type { LlmSettings } from '../src/agent/types.ts'

// ── 1. 全枚舉：3(llmConnected) × 2(enabled) × 2(credential) × 3(cliCount) ──
{
  let combos = 0
  for (const llmConnected of [true, false, null] as const) {
    for (const llmEnabled of [false, true]) {
      for (const llmCredentialPresent of [false, true]) {
        for (const authorizedCliCount of [0, 1, 2]) {
          const result = deriveEngineAvailability({
            llmEnabled,
            llmCredentialPresent,
            llmConnected,
            authorizedCliCount,
          })
          combos += 1

          // 三態轉移
          if (!llmEnabled) {
            assert.equal(result.llmCheck, 'disabled', '未啟用 → disabled')
          } else if (llmCredentialPresent && llmConnected === true) {
            assert.equal(result.llmCheck, 'ok', '啟用+憑證+通連 → ok')
          } else {
            assert.equal(
              result.llmCheck,
              'unverified',
              `啟用但未通連（credential=${llmCredentialPresent}, connected=${llmConnected}）→ unverified`,
            )
          }

          // 引擎可用性對齊 engine useLlm 語義：enabled+憑證即算可用（未測試=可），
          // 只有連線測試失敗（connected===false）才排除；或任一已授權 CLI。
          const expectUsable =
            (llmEnabled && llmCredentialPresent && llmConnected !== false) || authorizedCliCount > 0
          assert.equal(result.anyEngineUsable, expectUsable)
          assert.equal(result.bannerVisible, !expectUsable, 'banner = 沒有任何可用引擎')

          // ok 永不伴隨橫幅；unverified（尚未測試）在無 CLI 時也不橫幅——引擎會真的跑
          if (result.llmCheck === 'ok') assert.equal(result.bannerVisible, false)
          if (llmEnabled && llmCredentialPresent && llmConnected === null && authorizedCliCount === 0) {
            assert.equal(result.bannerVisible, false, '啟用+金鑰+未測試：引擎會跑真實 LLM，不橫幅')
          }
        }
      }
    }
  }
  assert.equal(combos, 36, '全枚舉應涵蓋 36 種組合')
}

// ── 2. 具體情境抽查 ──
{
  // 全新使用者：什麼都沒設 → 橫幅出現
  const fresh = deriveEngineAvailability({
    llmEnabled: false,
    llmCredentialPresent: false,
    llmConnected: null,
    authorizedCliCount: 0,
  })
  assert.deepEqual(fresh, { llmCheck: 'disabled', anyEngineUsable: false, bannerVisible: true })

  // 啟用但沒測過連線 → unverified，但已有 CLI → 不橫幅
  const cliOnly = deriveEngineAvailability({
    llmEnabled: false,
    llmCredentialPresent: false,
    llmConnected: null,
    authorizedCliCount: 1,
  })
  assert.equal(cliOnly.bannerVisible, false, '有已授權 CLI 就不橫幅')

  // 啟用+金鑰+測試失敗 → unverified（不能假裝可用）
  const failed = deriveEngineAvailability({
    llmEnabled: true,
    llmCredentialPresent: true,
    llmConnected: false,
    authorizedCliCount: 0,
  })
  assert.equal(failed.llmCheck, 'unverified')
  assert.equal(failed.bannerVisible, true)
}

// ── 3. fromSettings 投影：apiKey 空白 vs 已填、cliProviders 過濾語義 ──
{
  const base = {
    enabled: true,
    apiKey: '  ',
    cliProviders: [
      { id: 'codex', enabled: true, authorized: true },
      { id: 'claude-off', enabled: false, authorized: true },
      { id: 'grok-unauth', enabled: true, authorized: false },
    ],
  } as unknown as LlmSettings

  const view = deriveEngineAvailabilityFromSettings(base, true)
  assert.equal(view.llmCheck, 'unverified', 'apiKey 全空白 = 憑證未填')
  assert.equal(view.anyEngineUsable, true, '僅 codex（enabled+authorized）算可用 CLI')
  assert.equal(view.bannerVisible, false)

  const keyed = deriveEngineAvailabilityFromSettings({ ...base, apiKey: 'sk-test' }, true)
  assert.equal(keyed.llmCheck, 'ok')

  const noCli = deriveEngineAvailabilityFromSettings(
    { ...base, apiKey: 'sk-test', cliProviders: [] },
    null,
  )
  assert.equal(noCli.llmCheck, 'unverified', '尚未測試連線 → unverified')
  assert.equal(noCli.bannerVisible, false, '啟用+金鑰+未測試：引擎會真的跑，不橫幅')

  // 啟用+金鑰+連線測試失敗+無 CLI → 誠實橫幅（引擎會 fallback 失敗/模擬）
  const tested = deriveEngineAvailabilityFromSettings(
    { ...base, apiKey: 'sk-test', cliProviders: [] },
    false,
  )
  assert.equal(tested.llmCheck, 'unverified')
  assert.equal(tested.bannerVisible, true)
}

// ── 4. 文案 key 完整性（i18n 前的穩定 key） ──
{
  for (const state of ['disabled', 'unverified', 'ok'] as const) {
    assert.ok(LLM_CHECK_COPY[state].title.length > 0, `${state} title`)
    assert.ok(LLM_CHECK_COPY[state].hint.length > 0, `${state} hint`)
  }
  assert.ok(ENGINE_BANNER_COPY.title && ENGINE_BANNER_COPY.body && ENGINE_BANNER_COPY.cta)
}

// ── 5. Simulation 標示真值表：runner × LLM 設定 × overrides ──
{
  const llmOn = { llmEnabled: true, llmApiKey: 'sk-test' }
  const llmOff = { llmEnabled: false, llmApiKey: '' }

  // builtin + 無 LLM → 標示
  assert.equal(isSimulationRun({ runner: 'builtin', ...llmOff }), true)
  // builtin + 有 LLM → 不標
  assert.equal(isSimulationRun({ runner: 'builtin', ...llmOn }), false)
  // 外部 CLI runner 一律不標（即使沒有 LLM——CLI 用自己的憑證）
  for (const runner of ['codex', 'claude', 'grok', 'opencode', 'gemini', 'cursor']) {
    assert.equal(isSimulationRun({ runner, ...llmOff }), false, `${runner} 不走內建模擬路徑`)
  }
  // overrides.useLlm === false 強制模擬（即使 LLM 已設）
  assert.equal(isSimulationRun({ runner: 'builtin', ...llmOn, overrideUseLlm: false }), true)
  assert.equal(isSimulationRun({ runner: 'builtin', ...llmOn, overrideUseLlm: true }), false)
  assert.equal(isSimulationRun({ runner: 'builtin', ...llmOn, overrideUseLlm: null }), false)
  // 金鑰全空白視同未填
  assert.equal(isSimulationRun({ runner: 'builtin', llmEnabled: true, llmApiKey: '   ' }), true)
  // 投射文案存在且提及模擬
  assert.ok(SIMULATION_NOTE.includes('模擬') && SIMULATION_NOTE.includes('未使用語言模型'))
}

console.log('Engine availability smoke: 5 groups passed (36 combos + simulation truth table)')
