# 11 — Onboarding Tour

**What to build:** spotlight 式一次性導覽，四個概念點：四種 Loop Pattern 差異、執行引擎（內建 vs 外部 CLI 的誠實標示意義）、Approval Mode 三段風險差異、誠實性橫幅的意義。完成／跳過狀態持久化；設定「外觀」節提供「重新導覽」；reduced-motion 時降級為無動畫逐步提示。與精靈的出現順序：精靈先、tour 後，不互相遮擋。

**Blocked by:** 01, 03

**Status:** resolved

- [x] 全新 profile 首次進入時可觸發，四點內容正確、可跳過
- [x] 與 07 精靈順序協調（精靈完成／跳過後才輪到 tour）
- [x] 設定「重新導覽」入口可用
- [x] reduced-motion 降級為無動畫
- [x] 元件測試：步驟推進與跳過

## Answer

`src/components/OnboardingTour.tsx`（掛 Layout）：四概念點（Loop Pattern 差異與 Time/Proactive fail-closed 語義、執行引擎誠實標示、Approval Mode 三段風險、誠實性橫幅／模擬章意義）。順序協調：監聽精靈的 `subagents:first-run-wizard:settled` 事件，精靈完成或跳過後才接棒（精靈未落定不出現，不互相遮擋）。狀態持久化 `subagents.onboardingTour.state.v1`；Esc 視同跳過；設定→外觀新增「導覽」群組（重新導覽按鈕 → `reopenOnboardingTour()`）；動效僅 `animate-macos-enter`（受全域 data-reduced-motion 閘門）。元件測試 5 案（接棒時序、已完成/跳過隱藏、四步推進完成、跳過/Esc、重開與上一步）。`npm test` 29 passed、`tsc -b` 綠。

**Code-review 補記（2026-08-16）**：spec 稱「spotlight 式」——本實作為底部定位的覆蓋層卡片（dim + 卡片），未錨定實際 UI 元素。這是簡化版 spotlight；錨定式 spotlight（高亮 composer／Approval Mode pill 等真實元素）記為後續強化項，不影響四概念點內容傳達。
