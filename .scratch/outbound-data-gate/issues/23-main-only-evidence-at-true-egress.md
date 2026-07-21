# 23 — Security Evidence 僅 Main 於真實出站點寫入

**What to build:** Security Evidence Ledger 的 outbound-decision / isolation 相關 append 改由 **main 在真實控制點** 寫入（view prepare、CLI sandbox gate、LLM egress 等），renderer 不得任意 append 可偽造的 outbound-decision 記錄。紀錄仍只含 metadata（mode、action、provider、policy 版本、filesystemIsolation、locator），不含 prompt / 檔案內容 / 摘要。`required` 下關鍵出站應能對到至少一筆可查詢摘要。

**Blocked by:** 16 — Main 擁有 effective Guard Mode；19 — LLM 出站 company profile；20 — Main 強制 CLI sandbox

**Status:** 可交給代理

- [ ] renderer 對 outbound-decision 的自由 `appendEvidence` 被移除或降為無法偽造最終 ledger 的無特權路徑。
- [ ] main 在 view prepare、required CLI deny/allow、LLM 出站決策等真實點寫入 metadata-only 記錄。
- [ ] 紀錄不含受保護明文、prompt、模型輸出或內容摘要（ADR-0015）。
- [ ] 查詢摘要 API 仍可供 Settings / 稽核 UI 使用（read path）。
- [ ] smoke：偽造 renderer append 不影響正式鏈；真實 required deny CLI 可在摘要中見到 isolation/action 類事件。

## Parent

[spec-fail-closed-wiring.md](../spec-fail-closed-wiring.md) · review bugs 11, 18（egress ledger gaps）
