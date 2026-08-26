# 01 — Settings 訂閱面誠實性：文案、分支順序、可刷新

Status: resolved
Effort: subscription-surface-hardening

## 問題

1. 診斷訊息衍生把訂閱分支排在 `if (!s.apiKey)` 之後；訂閱連線永不攜帶 apiKey（Host 端剝除），所以「沒有 Host」的誠實訊息是新 profile 上的死碼，使用者永遠看到「API key is empty」。
2. 文案含異體字「訂閲」（U+95B2），違反 CLAUDE.md 繁中慣例（應為「訂閱」U+95B1）。
3. 兩個 settings 元件各自一次性 `settings.get()`（mount 後不再更新）：使用者在 CLI 登出解決 provider 衝突後，Settings 畫面不反映——spec story 3 要求衝突「必須由使用者在 Settings 明確解決」，但癒合無法被觀察。
4. `isSubscriptionProviderPreset(settings.apiProvider || 'custom')` 在 SettingsPage 出現六處。

## 驗收條件

- [x] 訊息衍生順序：無 Host／無訂閱連線的診斷先於 apiKey 檢查；drift guard 以 source-text 斷言釘住順序。
- [x] 「訂閲」改「訂閱」（rg 全 repo 無 U+95B2 殘留）；全檔其餘繁中字形掃過一遍無同類錯字。
- [x] catalog 載入收斂為單一共享 hook，兩個 settings 元件都經由它；refresh() 入口落在衝突提示旁與 loadFailed 狀態（drift guard：onClick={refresh}）；focus/visibilitychange 自動重查。證據：smoke-subscription-catalog「Ticket 01」段全綠。
- [x] 六處重複運算式推導為單一 boolean local（SettingsPage 僅剩定義處一處呼叫）。
- [ ] 相關 smoke 全綠（`npm run build`、oxlint 0 error、smoke-caps）。

## 接縫

既有：settingsStore 衍生函式的行為斷言＋source-text drift guard（prior art：smoke-composer-approval-handoff.mts 的 guard 形態）。不新增接縫。
