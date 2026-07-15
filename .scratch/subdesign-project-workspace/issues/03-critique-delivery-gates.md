# 03 — Critique 與 Delivery 工作區整合

**What to build:** 使用者能在 SubDesign project context 內直接理解 Critique Theater 與交付 gate 的狀態，並知道何時可 tweak、review 或 deliver；流程仍使用真實多輪多 panelist critique，未通過或中止時不可誤開放交付。

**Blocked by:** 01 — SubDesign 階段與下一關卡

**Category:** enhancement

**Status:** 可交給代理

- [x] Critique pending、running、interrupted、failed、passed 狀態在 stage rail、next gate 與 workspace inspector 中一致。
- [x] Critique Theater 的 round、panelist、live trace 與中止行為維持既有真實 runtime 契約。
- [x] delivery 僅在 canonical critique pass 條件成立時啟用；其他狀態明確顯示鎖定原因。
- [x] selected artifact / revision 在 preview、critique、tweak 與 delivery 間保持一致。
- [x] 回歸測試確認不會透過 UI 重組而繞過 critique gate 或偽造 pass。
