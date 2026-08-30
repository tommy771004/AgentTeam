# 11 — Host publish adapter evidence 與 unknown recovery

**What to build:** 發布 side effect 僅由 Host adapter 使用 vault credential 執行，並以 adapter-issued evidence 分類結果；API 回應遺失等 unknown outcome 不會自動重送。

**Blocked by:** 10 — Content publish intent 進入 Task run lifecycle

**Status:** 可交給代理

- [ ] raw token 只在 Host/main vault boundary 解析，renderer 與 Turn Record 不取得 credential body
- [ ] 成功發布附帶 trusted content-publish evidence、remote identity 與 bounded receipt
- [ ] auth、configuration、missing media、API rejection、timeout 與 unknown outcome 使用 typed failure classification
- [ ] crash before request、during request、after response 與 response-lost recovery 遵循 idempotency/unknown policy
- [ ] pending delivery 可重送保存的 outcome，但不重跑未知 publish effect
