# 08 — 其餘工具接上呈現契約（批次）

**What to build:** 參考工具以外的其餘內建工具各自宣告自己的卡片，讓執行過程整體讀起來一致，而不是一半有型、一半通用。批次進行，每批之後 UI 仍然可用 —— 未接上的工具本來就安全退回通用卡。

**Blocked by:** 07

**Status:** done

- [x] 其餘內建工具依其行為宣告 `presentCall` / `presentResult`（必要時含 `locations`）
- [x] 每一個宣告都是 replay-pure，且在畸形舊參數下退回通用卡
- [x] 會產生副作用的工具正確宣告為 `diff` 或帶 `locations`，因此自動進入產出檔案清單
- [x] 批次可分次落地：任一批之後 build 與 smoke 全綠
- [x] Seam 2 smoke：以帳本 fixture 覆蓋每個新接上的卡片型別

## Comments

**Implemented and verified.** All 51 catalog tools now declare a card; the coverage smoke fails the build if a new tool is added without one.

**The declarations were not being read.** `presentToolCall` only consulted the stand-in table for Pi Core's builtin loop tools, so the three catalog declarations ticket 07 added (`workspace_write`, `workspace_grep`, `bash`) were declared and then ignored — decoration, not contract. A `presenterFor()` lookup now takes the catalog declaration first and falls back to the builtin table, so declaring a card is what makes it render. Without this, ticket 08 would have added 48 more declarations nothing reads.

Five shared builders carry the recurring shapes so each declaration is one line next to the schema: `readCard`, `pathsCard`, `mutationCard`, `touchCard`, `labelledCard`.

**The distinction that matters is `kind: 'edit'`.** That is what puts a card's locations on the produced-files list, so it belongs only to calls that genuinely produce or modify a file. A delete declares `touchCard`: it still carries its path so an editor can follow along, but it never claims the run produced that file. The smoke asserts exactly that — a download appears, a read does not, a delete does not, and a *failed* mkdir does not.

**Totality is asserted, not assumed.** Every presenter is called with `undefined`, `null`, `{}`, a wrong-typed field, a string, and an array; none may throw. These run on Turn Record replay, where the arguments are whatever an older build recorded.

Removed `asLocations`, dead since ticket 07 — oxlint flagged it once this file was in scope.
