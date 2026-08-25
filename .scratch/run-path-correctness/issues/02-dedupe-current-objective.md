# 02 — Prompt 去重守衛收斂為共用 helper

Status: 可交給代理
Spec: `.scratch/run-path-correctness/spec.md`

## What to build

「當前請求」在 builtin 與 Pi Host 路徑被重複注入 prompt 兩次（近期對話歷史一次、「當前請求」段落一次）。External CLI 路徑已有正確守衛。本票把該守衛語意提取為 chat-history 組裝層的單一共用 helper，三條執行路徑（Pi Host、legacy builtin、external CLI）全部改為呼叫它：組裝歷史前，若尾端 user 訊息 role 為 user 且內容與本次目標完全相等則切除。比對維持嚴格相等，不做模糊比對。帶附件的 user bubble 內容相等時同樣適用切除（附件另行準備，不受影響）。並加 source-text drift guard 防止未來第四條路徑繞過。

**Blocked by:** None — can start immediately

## Acceptance criteria

- [ ] 守衛提取為單一共用 helper；external CLI 路徑改呼叫 helper，行為不變
- [ ] Pi Host turn-context 建構路徑套用守衛：尾端 user 訊息等於本次目標時不再重複注入
- [ ] Legacy builtin 路徑同樣套用
- [ ] 內容不完全相等的歷史訊息一律保留（嚴格比對，零誤刪）
- [ ] Source-text drift guard 驗證三條路徑皆引用共用 helper（仿既有契約檢查風格，指向新 owner 而非弱化）
- [ ] Smoke 直接呼叫 helper 與 Pi turn-context 建構器驗證切除／保留兩種情境
- [ ] 連續兩 turn 的 prompt 中同一 objective 恰出現一處（可用字串計數斷言）
