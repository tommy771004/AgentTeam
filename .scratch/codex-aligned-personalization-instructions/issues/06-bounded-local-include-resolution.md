# 06 — 有界且安全的本機 include resolution

**What to build:** 支援自訂指令中的本機 `@path` include，包含使用者目前以絕對路徑重用 RTK 類規則的情境；Host 展開 include、保留 transitive provenance，並阻止 cycle、symlink escape、未授權 project escape 與無界 context growth。

**Blocked by:** 05 — 階層 override 與 fallback discovery.

**Status:** 可交給代理

- [x] Global custom instruction 可引用明確的 absolute local file，effective snapshot 包含解析後內容而非只把 path 字串交給模型。
- [x] Project-owned instruction 預設只能 include canonical project/worktree 內檔案；root escape 需要針對 exact canonical target 的 durable explicit authorization。
- [x] Resolver 在 scope check 前 canonicalize path 與 symlink，不能以 symlink 或 `..` 繞過 allowed root。
- [x] Nested include 有固定 depth、source-count、per-file byte 與 total-byte caps。
- [x] Cycle、missing、unreadable、unauthorized、unsupported target 與 oversized source 產生不同 typed diagnostics。
- [x] Snapshot 與 Turn Record 保存每個 transitive source 的 canonical identity、hash、bytes、父 include 關係與 applied/degraded 結果。
- [x] Personalization 顯示 include tree 與錯誤，不能把未展開的來源標示為已套用。
- [x] Public resolver corpus 覆蓋 absolute include、nested include、cycle、Unicode path、symlink escape、project escape authorization 與所有 budget edges。
