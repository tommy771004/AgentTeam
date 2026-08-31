# 03 — Package Skills 共享到 Chat／SubDesign

**What to build:** 讓已安裝 Pi Package 中的相容 skills 在下一個 Agent Chat 與 Pi-backed SubDesign run 中可用。Package resources 由 Pi Core Host 解析後投影進每輪 immutable Skill Resource View，沿用既有容量、檔案數、symlink 與 digest 邊界；Chat 與 SubDesign 讀取同一份 Host-owned package state，不各自安裝、掃描或同步 skills。移除 package 後，下一輪 frozen view 不再包含其 skills。

**Blocked by:** 02 — Pinned npm 安裝、移除與安全 reload

**Status:** 可交給代理

- [ ] 安裝含 skill 的 pinned package 後，下一個 Agent Chat run 的 frozen Skill Resource View 包含該 skill
- [ ] 同一 package skill 在下一個 Pi-backed SubDesign run 可用，且來源與版本和 Agent Chat 一致
- [ ] Package skill 帶可查核的 package name、exact version、resource origin 與 content digest provenance
- [ ] Package skills 沿用既有 file-count、total-size、symlink 與 unreadable-resource fail-closed 規則，不取得較寬鬆例外
- [ ] Renderer 不直接掃描 package skill directories，也不建立第二份 package skill catalog
- [ ] Runtime mutation 前已凍結的 turn view 不漂移；成功安裝或移除只影響安全 reload 後的新一輪 view
- [ ] 移除 package 後，下一個 Agent Chat 與 Pi-backed SubDesign run 均不再看見該 skill
- [ ] 非 Pi-backed external CLI runner 不被誤標為支援 package skills
