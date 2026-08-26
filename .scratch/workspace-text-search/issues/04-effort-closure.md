# 04 — Effort 收口（gate 全綠＋tracker 對帳）

**What to build:** 全鏈 gate 綠、tracker 對帳完成：`.scratch/INDEX.md` 與 `DEV_STATE.md` 同步、票翻 resolved 附一 hop 證據（符合 triage-labels 的 resolved 證據定義）。

**Blocked by:** 03 — 生產路徑等價接線＋防復發 guards

**Status:** 可交給代理

- [ ] `npm run build` ＋ `npm run smoke` 全綠
- [ ] INDEX/DEV_STATE 更新，resolved 註記指名證據 smoke
- [ ] spec.md 存在且連結可達（drift guard 抓死連結的那支會過）
- [ ] harness-gap-closure #06 下場對帳完成（其 Comments 已註記由本 effort 承接；收口時翻 resolved 或標 superseded 並附證據）
