# 02 — pi-agent-runtime-contract 對帳

**What to build:** 以 smoke gate 為唯一證據核對 22 張票的勾選框現實，翻正 spec 狀態、在 Comments 記錄證據清單、對敘述過期處補帶日期的對帳註記。

**Blocked by:** 01

Status: resolved

## 已知現實（待本票核對後確認）

- 22 張中 19 張驗收框全滿。
- 開框殘餘：#14 Linux bwrap 真機 qualification（需 Linux CI 綠）、#18 git preferences 移除裁決、#22 rollup 2.1／3.1。
- `KNOWN_UNGATED_TESTS` 依 ADR-0052 為「列出非豁免」清單，#22 的 3.1（清空）需如實記錄為未達。

## Comments

**2026-08-26 — resolved（核對完成；殘餘如實列於 INDEX）。**

勾選框現實（逐檔計數）：22 張中 19 張驗收框全滿。開框殘餘：
- #14 Linux bwrap 真機 qualification：3 框開（真實 Pi bash turn 成功 settlement／view 外失敗／Linux 六情境覆蓋）——本質需 Linux CI 首綠，macOS seatbelt tracer 已完成且 `smoke-pi-seatbelt-builtin-shell.mts`、`smoke-pi-bwrap-builtin-shell.mts` 都在主鏈。
- #18 git preferences：1 框開（移除裁決＋連動清除）——屬維護者裁決，列入 INDEX 待裁決 queue。
- #22 rollup：2 框開——2.1 即 #14 的三框；3.1「KNOWN_UNGATED_TESTS 清空」需重新表述：ADR-0052 後它是「列出非豁免」的恆常清單（commit b8e1888），不是待清空欠債。

Gate 證據：`npm run qualify:pi-runtime-contract`（展開 `scripts/qualify-pi-agent-runtime-contract.mts`）在主 smoke 鏈；Guard 7（check-pi-contract gate-reachability）雙向斷言在 `npm run build`。spec 敘述未發現誤導性過期段落，不加註記。
