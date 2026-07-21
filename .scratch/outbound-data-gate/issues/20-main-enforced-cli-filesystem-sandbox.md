# 20 — Main 強制 CLI Filesystem Sandbox（含 canary 不污染原專案）

**What to build:** external CLI 在 `required` 下只有經 **main** 驗證、綁定該 run Restricted Project View 的 filesystem sandbox 才可建立 process；renderer 省略 wrap 或偽造 isolation 狀態不得成功 spawn。Sandbox probe 的 forbidden canary 不得寫入原始專案樹。`verified` 至少保證原專案路徑不可讀；並記錄 adapter 最小允許面，避免「只過 cat canary」卻讓營運以為隔離成立。

**Blocked by:** 16 — Main 擁有 effective Guard Mode；18 — Restricted Project View Root 單一真相源

**Status:** 可交給代理

- [ ] main 在 `cli:runAgent`（或等價 spawn）前於 `required` 下拒絕無 verified sandbox / cwd 不在 bound view 內的請求。
- [ ] 不得僅信任 renderer 傳入的 optional wrap 或 `isolationStatus` 字串。
- [ ] forbidden canary 位於 original project 與 view 之外（例如專用 temp），probe 不得在原專案建立檔案。
- [ ] optional/demo 若允許 unverified 執行，必須在 UI/evidence 標示 isolation unverified（既有契約保持）。
- [ ] smoke / 靜態契約：required + 無 wrap → deny；canary 路徑不在 original root 下。
- [ ] 文件或測試註明 seatbelt/bwrap 最小 allow 與殘餘開口；「verified」不得與原專案可讀並存。

## Parent

[spec-fail-closed-wiring.md](../spec-fail-closed-wiring.md) · review bugs 4, 6, 7（profile 可用性底線）
