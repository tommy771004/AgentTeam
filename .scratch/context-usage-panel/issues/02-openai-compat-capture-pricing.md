# 02 — OpenAI-compat 路徑補抓 + ModelProfile pricing

Status: 可交給代理
Spec: `.scratch/context-usage-panel/spec.md`

## What to build

直接 OpenAI-compat 路徑（非 Pi runner）的用量補抓：transport 層從 provider 回應 parse `prompt_tokens` / `completion_tokens` / `prompt_tokens_details.cached_tokens`（現行只取 `total_tokens`）。`ModelProfile` 新增 optional `pricing`（input / output / cacheRead / cacheWrite 單價，Settings 的模型設定處可編輯）；成本僅在 pricing 存在時以 parse 到的 token 分項計得。無 pricing 或 provider 未回報分項時，對應欄位缺席——面板如實降級，不發明數字。

## Acceptance criteria

- [ ] transport 層保留 input / output / cached 分項並傳遞到 renderer 的 usage 累加路徑
- [ ] `ModelProfile.pricing` 為 optional，Settings 可編輯，舊設定檔缺欄位照常載入
- [ ] 有 pricing 時 `costUsd` 正確計得；無 pricing 或無分項時成本缺席
- [ ] 與 01 的 usage 欄位形狀一致（同一組 optional 欄位名），下游投影不需分叉

## Blocked by

01 — usage 記錄擴充 + Host 補抓
