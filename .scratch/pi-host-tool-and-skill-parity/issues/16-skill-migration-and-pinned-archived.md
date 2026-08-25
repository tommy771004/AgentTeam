# 16 — 技能遷移與 pinned / archived 語意

**What to build:** 使用者升級到新版之後，他先前寫的技能還在、而且開始真的生效；他釘選的技能不管這次講法有沒有撞到關鍵字都會套用；他封存的技能不會再進 context，但要找回來時還在。

遷移必須**會回報**。一個沒說話的遷移，跟資料遺失在使用者眼裡是同一件事。

**Blocked by:** 02

**Status:** 可交給代理

- [x] 新版首次啟動時，renderer `skillsStore` 的技能寫入 Host 的技能目錄
- [x] 每個技能一筆遷移結果；格式錯誤的技能被回報，不是靜默丟棄
- [x] localStorage 副本保留唯讀一個 release 作為回退
- [x] pinned 技能的 body 事前展開（比照 Pi 既有的 `/skill:<name>` 展開），不另建第二條 discovery
- [x] archived 技能對應 `disable-model-invocation`：不出現在 `<available_skills>`，但仍在 `resources/list` 裡
- [x] 測試在單一接縫：餵一份 fixture localStorage payload，斷言產生的檔案與逐筆報告
