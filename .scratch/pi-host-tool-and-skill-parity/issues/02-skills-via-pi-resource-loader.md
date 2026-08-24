# 02 — 技能改由 Pi 的 resource loader 探索

**What to build:** 使用者寫了一個技能，存檔，下一次 run agent 就知道它存在，並在任務對得上時自己去讀完整內容。今天技能存在 renderer 的 localStorage，Host 讀不到，`resources/list` 永遠回空陣列 —— 使用者寫的東西被靜默丟棄。

Pi Core 其實已經完整支援這件事，只是沒接上：`DefaultResourceLoader` 已經在 Host 裡被建立並 `reload()`，它接受 `additionalSkillPaths`；`agent-session` 會把 `getSkills().skills` 餵進系統提示；`formatSkillsForPrompt` 會渲染成 `<available_skills>`（含 name / description / location）並指示模型用 `read` 載入該檔。這張票是接線，不是造新能力。

與 tools track 完全獨立，可與 01 同時進行。

**Blocked by:** None — can start immediately.

**Status:** 可交給代理

- [ ] Host 擁有一個技能目錄，一個技能一個 `SKILL.md`，frontmatter 帶 `name` / `description`
- [ ] `DefaultResourceLoader` 透過 `additionalSkillPaths` 指向該目錄
- [ ] 一個 turn 的系統提示出現 `<available_skills>`，內含技能的 name、description、location
- [ ] 模型能循 catalog 給的 location 讀到技能 body
- [ ] `PiResourceRegistry` 由 loader 的 `getSkills()` 填入，`resources/list` 回報實際找到的技能而非空陣列
- [ ] 格式錯誤的技能被回報為 diagnostic，不是靜默略過
- [ ] 測試在單一接縫：spawn `dist-electron/pi-host.js`，斷言 `resources/list` 與 turn 的系統提示
