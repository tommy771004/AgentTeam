# 07 — Run-level memory sink

**What to build:** 任務收尾(finalization)時沉澱知識:Host 側生成四段式摘要(objective / key decisions / failures / reusable procedure),以人話寫成,經既有 project 檔案橋接路徑落到專案的 memory 目錄(與 skills 寫入同一去處,可 commit、可分享)。同 thread 的新 run 在 admission 時注入最近數份沉澱作為前情提要,讓對話有記憶而不是每次歸零。模型不得直接宣稱已沉澱——以 journal 記錄的檔案寫入證據為準。

**Blocked by:** 05 — Summary compaction + preflight(避免 compaction 對 context 組裝的改動與前情提要注入撞同一區)

**Status:** resolved

- [x] run 完成後,memory 目錄出現一份四段結構的沉澱檔案
- [x] 摘要為人話(zh-TW 混英文技術詞),非內部術語
- [x] 寫入以 project 檔案橋接完成,路徑可被 git 追蹤
- [x] 同 thread 新任務的 prompt 含最近 N 份沉澱作為前情提要
- [x] 模型宣稱沉澱但無 journal 寫入證據的情境必須 fail
- [x] journal 記錄每次沉澱寫入事件
