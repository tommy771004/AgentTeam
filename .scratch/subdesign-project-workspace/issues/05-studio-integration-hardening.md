# 05 — Studio 整合、響應式與回歸驗證

**What to build:** 將前四張 ticket 完成的 stage rail、Build inspector、Critique / Delivery gate 與 resume context 整合成正式 Variant A SubDesign Studio；在桌面 Electron 與窄版 browser preview 都能使用，並完成回歸驗證與 prototype 收尾。

**Blocked by:** 02 — Build 執行中的專案 Inspector; 03 — Critique 與 Delivery 工作區整合; 04 — 可恢復的最近設計清單

**Category:** enhancement

**Status:** 可交給代理

- [x] 正式 `/subdesign/:briefId` 使用 Variant A 的 project-oriented hierarchy，且所有既有 brief、reference、artifact、critique、tweak、delivery 功能仍可操作。
- [x] desktop 與窄版寬度下，current stage、next gate、selected artifact、critique status 與 delivery lock 都保持可發現。
- [x] prototype 仍被 dev-only guard 隔離；正式版不會載入假資料或觸發 prototype actions。
- [x] `npm run build`、`npm run smoke`、`npx oxlint src`、`git diff --check` 通過；既有 unrelated lint warnings 需明確列出。
- [ ] 完成手動 UI smoke：建立 brief、啟動 run、查看 live activity、resume、critique gate、artifact selection 與 delivery lock。（待安裝本機 Playwright Chromium executable；目前已完成 HTTP dev route smoke。）
