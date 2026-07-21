# 17 — required 下 View 準備失敗必須 Fail-closed

**What to build:** 當 effective mode 為 `required` 時，若無法建立 Restricted Project View（缺 project root、prepare 失敗、company policy 無法載入且不能建立可信 baseline），該 run 的 LLM 與 external CLI 出站必須被阻擋並以明確錯誤結束，不得 soft-continue 到原始專案或以較弱 baseline 靜默取代已損壞的公司政策樹。`optional` / `demo` 可在明確降級標記下繼續，且必須寫入可觀測的 degraded 狀態。

**Blocked by:** 16 — Main 擁有 deploy / effective Guard Mode

**Status:** resolved

- [x] `required` + 缺少可用 project root → run 不以「無 view、工具讀 UI 原始 root」方式成功出站。
- [x] `required` + prepare / policy tree 載入失敗 → 回傳失敗並阻擋 outbound；不得 `ok: true` 搭配較弱 profile 靜默續跑。
- [x] 當公司政策檔存在但無效時，不得默默換成僅 builtin baseline 並宣稱保護成功。
- [x] `optional` / `demo` 若降級繼續，UI 或 evidence 必須標示 unprepared / degraded，且不得假裝 isolation verified。
- [x] dispose / 失敗路徑：prepare 失敗不寫入 runViews；先前 view 仍會先 dispose 再重建。
- [x] smoke：`smoke-outbound-view-admission.mts` + coordinator / prepare 接線契約。

## Parent

[spec-fail-closed-wiring.md](../spec-fail-closed-wiring.md) · review bugs 8, 9

## Answer

- pure: `decideRestrictedViewAdmission` / `resolveProfileForProtectedView` in `outboundGate.ts`
- main: `prepareOutboundRunView({ effectiveMode })` — required + ensure fail → `{ ok: false }`（無 silent baseline）
- coordinator: admission 統一 block / use-view / continue-degraded；required 例外 catch 亦 fail-closed
- smoke 掛入 package.json smoke / smoke:ci
