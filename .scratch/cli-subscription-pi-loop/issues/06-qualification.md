# 06 — qualification

Status: resolved
Spec: `.scratch/cli-subscription-pi-loop/spec.md`

## What to build

本 effort 的完整驗收收口。跑全套驗證並逐項記錄證據到本目錄 `qualification.md`；任何一項 fail-closed 即 No-Go。

1. `npm run build`（含 typecheck）、`npx oxlint src`、完整 `npm run smoke` 全綠。
2. Protocol v4 negotiation：v4 client ↔ v4 host 成功、前一版 client 相容（02 的 smoke 證據引用）。
3. Fail-closed 矩陣實測（可用 fixture host 或 dev 機器）：conflict / 未登入 / 正常三情境的 Settings 呈現與 patch 內容正確。
4. 真實端到端（需一台有 Codex 或 Claude CLI 登入的機器）：選訂閱連線 → 起 builtin run → bubble／Turn Record／settlement 正常 → approval 與 outbound gate 行為與 API-key run 一致。
5. 安全抽查：devtools 網路面與 snapshot 全文無 token；`auth.json` 權限 0600。
6. 文件同步：CLAUDE.md 若有連線設定段落則補訂閱連線一行；INDEX.md 本 effort 標 resolved。

**Blocked by:** 01–05

## Acceptance criteria

- [x] 六項逐項記錄通過證據於 `qualification.md`
- [x] 任一 fail-closed 情境即記錄 No-Go 與原因，不降級通過（無 No-Go 情境；vendor 拒絕模型呈現為有解釋的 failed settlement，已誠實記錄）

## Comments

**GO。** 六項證據全數收口於 `qualification.md`：build/oxlint/99-smoke 全綠、v4 握手＋v2 相容、fail-closed 矩陣 fixture＋實機活體（codex=available(7)／anthropic=unavailable(0)）、真實訂閱 E2E PASS（隔離 dir 匯入真 codex OAuth → gpt-5.4-mini 經 builtin Pi loop 回答 pong → Turn Record 完整）、安全抽查（auth.json 0600 實測、snapshot 全文 7 種 credential 形狀零命中）、CLAUDE.md/INDEX.md 同步。

可重跑驗證腳本：`qualify-subscription-snapshot.mts`（安全探針）與 `qualify-subscription-e2e.mts <modelId>`（真實 E2E，支援單模型探測避免限流）；兩者需真機憑證，不進 smoke chain。
