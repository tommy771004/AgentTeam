# 04 — Effort 收口（gate 全綠＋tracker 對帳）

**What to build:** 全鏈 gate 綠、tracker 對帳完成：`.scratch/INDEX.md` 與 `DEV_STATE.md` 同步、票翻 resolved 附一 hop 證據（符合 triage-labels 的 resolved 證據定義）。

**Blocked by:** 03 — 生產路徑等價接線＋防復發 guards

**Status:** resolved

- [x] `npm run build` ＋ `npm run smoke` 全綠
- [x] INDEX/DEV_STATE 更新，resolved 註記指名證據 smoke
- [x] spec.md 存在且連結可達（drift guard 抓死連結的那支會過）
- [x] harness-gap-closure #06 下場對帳完成（其 Comments 已註記由本 effort 承接；收口時翻 resolved 或標 superseded 並附證據）

## Closure evidence

2026-08-26：`npm run smoke:workspace-text-search` 19/19、`npm run build`、完整 `npm run smoke` 全綠；設定 UI 已由 Browser 實點驗證持久化，INDEX／DEV_STATE 與 harness-gap-closure #06 已同步對帳。
