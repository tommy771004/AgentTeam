# 11 — 外部 CLI run 產出同一份 Turn Record

**What to build:** 使用外部 CLI provider 的使用者，看到的執行過程與內建 run 是同一種形狀，不會因為換了 provider 就掉進一個比較差的舊檢視。同時，記錄上仍然明確寫著這條路徑沒有執行內建的 Parse／DoD／iterate —— 呈現一致永遠不等於保證一致。

**Blocked by:** 07

**Status:** done

- [x] 外部 CLI 執行寫入與內建相同的帳本條目種類，經同一個 seam
- [x] 外部 run 的對話列與執行過程列由同一個投影函式產生
- [x] runner 能力宣告（`parse` / `validateDoD` / `iterate` 為 false）隨記錄一起持久化並在 UI 可見
- [x] 外部 CLI 成功仍不得被呈現或記錄為 Definition of Done 已達成
- [x] 外部 CLI 的工具事件對應到宣告的卡片型別；無法對應者退回通用卡
- [~] 形狀一致與能力宣告以 seam 2 的純 builder fixture 斷言（`smoke-external-cli-record`）；未加真正跑一支 CLI 的 seam 1 smoke —— 見下方

## Comments

**Implemented and verified.**

`buildExternalCliRecord` turns the same CLI stream the feed renders into the same entry kinds a builtin turn records, so the conversation rows, the execution rows and the produced-files list all come from one projection. A user who switches provider does not drop into a worse, older view.

**What must not be the same is the claim.** `turn-start` now carries the runner and its capability declaration, and `EXTERNAL_CLI_RUNNER_CAPABILITIES` puts `parse` / `validateDoD` / `iterate` on the record as `false`. `recordRunnerDeclaration()` reads it back, the trajectory view shows `codex（未驗證 DoD）` in its header, and the smoke asserts the flags stay false — identical presentation can never be read as identical guarantees.

Accountability survives the path change: a `tool-call` is `source: 'model'` (the model asked) and its `tool-result` is `source: 'host'` (the runner reported), exactly as in the builtin path.

**One fix this ticket forced, and it improves the builtin path too.** `writeCard` returned `undefined` when a write's `content` was missing, so the call fell back to a plain generic row and its file silently vanished from the produced-files list. An external CLI reports the *path* it touched, not the text — so a content-less write now declares the mutation it can prove (`generic` + `kind: 'edit'` + locations) and drops only the diff it cannot. A recorded builtin write whose args were truncated benefits identically.

**Seam-1 coverage is honest about its limit.** The shape and the declaration are asserted against the pure builder with fixtures covering a shell call, a successful write, a failed write, an unknown CLI tool, and a non-tool event. Driving a real CLI binary end to end belongs with the external-CLI harness (`smoke-external-cli-durable-harness`), which owns a runnable fake; wiring the record assertion into that harness is worth doing but is a change to that harness, not to this seam. Marked `[~]` so it is not mistaken for done.
