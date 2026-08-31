# 03 — Package Skills 共享到 Chat／SubDesign

**What to build:** 讓已安裝 Pi Package 中的相容 skills 在下一個 Agent Chat 與 Pi-backed SubDesign run 中可用。Package resources 由 Pi Core Host 解析後投影進每輪 immutable Skill Resource View，沿用既有容量、檔案數、symlink 與 digest 邊界；Chat 與 SubDesign 讀取同一份 Host-owned package state，不各自安裝、掃描或同步 skills。移除 package 後，下一輪 frozen view 不再包含其 skills。

**Blocked by:** 02 — Pinned npm 安裝、移除與安全 reload

**Status:** claimed

- [x] 安裝含 skill 的 pinned package 後，下一個 Agent Chat run 的 frozen Skill Resource View 包含該 skill
- [x] 同一 package skill 在下一個 Pi-backed SubDesign run 可用，且來源與版本和 Agent Chat 一致
- [x] Package skill 帶可查核的 package name、exact version、resource origin 與 content digest provenance
- [x] Package skills 沿用既有 file-count、total-size、symlink 與 unreadable-resource fail-closed 規則，不取得較寬鬆例外
- [x] Renderer 不直接掃描 package skill directories，也不建立第二份 package skill catalog
- [x] Runtime mutation 前已凍結的 turn view 不漂移；成功安裝或移除只影響安全 reload 後的新一輪 view
- [x] 移除 package 後，下一個 Agent Chat 與 Pi-backed SubDesign run 均不再看見該 skill
- [x] 非 Pi-backed external CLI runner 不被誤標為支援 package skills

## Comments

- 2026-08-31：`npm run build`、既有 `smoke-pi-host-skills.mts` package fixture、`smoke-pi-host-resources.mts`、`smoke-pi-host-runner.mts`、`smoke-runner-contract.mts`、focused oxlint與`git diff --check`通過。Fixture證明configured pinned package skill進入同一frozen prompt view，且`resources/list`回傳package name、exact version、configured source、origin與frozen SHA-256 content digest。Standards／Spec defect review修正symlink root與半套bundle materialization邊界，未留待修finding。
- 完整`npm run smoke`再次停在既有`smoke-instruction-run-snapshot.mts:335` durable-memory revision斷言：預期`1`、實得`14`。此blocker與package skill snapshot無直接關係，未修改instruction/memory行為掩蓋；ticket暫維持`claimed`，不宣稱resolved。
