# 01 — Gate evidence contract + fail-closed verdict

**What to build:** Critique 的證據合約升級為可承載 gate 量測：critique 證據新增 `'gate'` kind（記載 gate id、輸入參數摘要、量測值、sha256），並且 critique store 在 verdict 為 pass 時強制驗證四項分數各自有對應的 gate 證據引用——缺任何一個就拒絕整筆 critique（fail-closed，回傳指明缺哪些 gate 的 errors，與現行 manifest invalid 同型）。使用者得到的第一個改變是：「pass」從此不可能由未經量測的分數取得。

**Blocked by:** None — can start immediately.

**Status:** 可交給代理

- [ ] Critique 證據型別新增 `'gate'` kind，gate 條目含 gate id、輸入摘要、量測值、sha256
- [ ] Pass verdict 缺任一分数的 gate 對應時，store record 失敗且 errors 指明缺口；帶齊時記錄成功
- [ ] design_critique tool 的輸出路徑同樣被此規則約束（不能繞過 store 驗證）
- [ ] Store-level smoke：fail-closed 拒絕 + 帶齊通過兩條路徑都斷言
- [ ] Drift guard 固定「gate 未執行不得宣稱分數」合約

## Comments

**2026-08-28 Pi Core owner 修復**：Pi extension gate schema 已移除模型可寫的 `passed`／`summary`／`evidencePath`。工具透過受限 Host service RPC 要求 Electron main 執行既有 contrast、console-error、build-success、responsive-overflow、token-consistency runner；verdict、summary、hash 與 HMAC attestation 均由 main 根據量測產生。`smoke-subdesign-critique-gates.mts` 新增 public pack seam 斷言，證明即使呼叫者夾帶 `passed: true`，輸出仍採 Host 的 failed measurement（9/9 通過）。原票要求 store 拒絕整筆；目前 shared normalizer 採 fail-closed 降級為 `needs-revision`，此產品語意差異仍需對帳後才能將本票標 resolved。
