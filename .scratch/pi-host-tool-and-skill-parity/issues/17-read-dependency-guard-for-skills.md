# 17 — 技能對 read 工具的依賴要顯性，不能靜默消失

**What to build:** 如果某個 capability 組態關掉了 `read`，使用者要被告知「技能在這次 run 不可用」，而不是技能整批無聲蒸發。

這是 spec 特別點名要獨立成票的耦合：Pi 的 `formatSkillsForPrompt` **只在 `read` 工具可用時**才會被附加到系統提示。也就是說，一個看起來與技能無關的工具設定，可以讓所有技能一次全部消失，而且不留任何痕跡 —— 正是這整個 effort 要消滅的那種失敗模式。

**Blocked by:** 02, 12

**Status:** 可交給代理

- [ ] `read` 不 active 時，技能不可用這件事被明確回報（run 記錄 + 使用者看得到的訊息）
- [ ] 目錄投影中技能相關項目帶上這個原因
- [ ] `read` 重新 active 後技能自動恢復，不需重啟
- [ ] 測試在單一接縫：關掉 `read` 的 turn 斷言告知存在且系統提示確實沒有 `<available_skills>`
