# 19 — 呼叫 inactive 工具時 Turn Record 不帶 contract identity

**What to build:** 一個對「這回合未啟用」的工具的呼叫，在 Turn Record 中要帶著 contract identity 並記成明確的拒絕，而不是留下一筆沒有身分的 `tool-call`。

**Blocked by:** 無。

**Status:** 可交給代理

## 問題

在 `qualify-pi-agent-runtime-contract` 開發過程中發現：模型呼叫一個 `active: false` 的工具（例如尚未載入 `mcp-bridge` 前的 MCP 工具）時，Turn Record 寫下的 `tool-call` entry 是：

```json
{"kind":"tool-call","tool":"mcp_fixture-mcp_inspect-item","callId":"…","args":{…}}
```

`contractRevision`、`contractDigest`、`schemaDigest`、`toolSource`、`invocationOrigin` **全部缺席**。對照同一回合的 builtin：

```json
{"kind":"tool-call","tool":"read","…","contractRevision":1,"contractDigest":"…","schemaDigest":"…","toolSource":"builtin","invocationOrigin":"model"}
```

成因：`modelToolContractIdentity()`（`piHostProtocol.ts:309`）在 `lookupCurrent` 失敗時回 `undefined`，而 inactive 工具不在該回合的 frozen contract 內，於是整組欄位被靜默略過。

## 為什麼要修

- **稽核無法回答「這是什麼」。** 一筆沒有 identity 的 `tool-call` 無法對應回任何 schema 或 revision，replay 也無從還原它的 presentation（ADR-0050）。
- **與 issue 15 的核心主張衝突。** 該票要求「每個 model-originated call 的 schema digest、contract revision、args、result 與 Turn Record identity 一致」。這條路徑上不一致。
- **拒絕與遺漏長得一樣。** 目前無法從記錄分辨「工具未啟用所以沒跑」與「記錄寫漏了」。

## 驗收條件

- [x] 呼叫 inactive 工具時，Turn Record 的 `tool-call` 仍帶 contract identity —— 來源是該工具在 catalog 中的投影（它有 `schemaDigest`，只是 `active: false`）。
- [x] 該呼叫記成明確拒絕：`tool-result` 的 settlement 為 `denied`，理由帶出 catalog 已有的 `reason`（例如「Inactive this turn: load the mcp-bridge capability」）。
- [x] 事件流一致：發出 decision 與恰好一個終局 result，與 issue 16 建立的生命週期相同。
- [x] 無法投影身分的工具（完全未知的名稱）與「已知但未啟用」要能區分，兩者都不得留下無身分的記錄。
- [x] Qualification 以真實 Pi turn 覆蓋：已知但 inactive、完全未知、以及載入後成功三種情形。

## Comments

### 已完成：拒絕與遺漏不再長得一樣

`TurnRecordToolContractIdentity` 新增 `contractStatus?: 'not-in-turn-contract'`，並在 `piHostProtocol` 寫 `tool-call` 時，於 identity 解析不到的情況下標記。原本這兩件事的記錄完全相同：

- 這個工具不在本回合的 frozen contract 裡（inactive capability 工具、或未知名稱）
- 記錄本身漏寫了它有的 identity

現在前者有明確標記，後者仍是空白 —— 兩者可分辨。`qualify-pi-agent-runtime-contract` 加了對稱斷言：計畫內的每一筆呼叫都在 contract 內，因此**必須**帶 identity 且**不得**帶標記。

### 已完成：catalog 投影成為可查詢狀態

`HostState` 新增 `catalogProjection`，在 `tools/list` 組出 catalog 的當下寫入。`modelToolContractIdentity` 在 frozen contract 查不到時，改為回退到這份投影：

- `schemaDigest` / `toolSource` / `toolPack` 來自 catalog —— 記錄因此仍說得出**被呼叫的是什麼**。
- `contractRevision` / `contractDigest` **刻意留空**：該工具不屬於那個 revision，宣稱它屬於會是比留白更糟的謊。
- `contractStatus` 現在有兩個值：`catalogued-not-in-turn-contract`（Host 認得但這回合沒啟用）與 `not-in-turn-contract`（完全不認得）。

`tool_execution_end` 對「catalog 認得、available、但未啟用」的失敗改記為 `denied`，並帶上 catalog 原本的 `reason`（例如「Inactive this turn: load the mcp-bridge capability」）—— 也就是那句唯一能告訴人怎麼修好的話。事件流走 issue 16 建立的同一條生命週期。

### 過程中修掉一次過度概括

第一版的條件是「isError 且 catalog 說 active===false」。這讓一個**傳輸失敗**的 MCP 工具（`available: false`）被改記成 `denied` —— 把真正的故障藏在政策訊息後面，`smoke-pi-mcp-native` 當場抓到。

已收緊為三個條件同時成立：identity 是從 catalog 回退來的、catalog 說它 `available: true`、且 `active: false`。也就是「這工具是好的，只是這回合沒開」，而不是「這工具壞了」。

### 已完成：phase 對稱性從推論變成事實

原本這裡寫著「走同一個 publisher，因此理論上對稱 —— 但那是推論」。斷言補上後，
`qualify-pi-agent-runtime-contract` 多了三條檢查，答案比推論更精確：

- **執行的兩個 phase 對稱。** inactive 路徑在 `session.toolAudit` 留下 `start` 與
  **恰好一個** `result`（settlement `denied`、reason 帶著「load the mcp-bridge
  capability」）—— 與 allow/deny 兩條路同形。「恰好一個」是刻意釘的：issue 19
  修掉的正是雙終局。
- **第三個 phase 刻意不對稱。** allow 與 deny 有 `decision` 是因為 Approval
  Decision 真的跑過；activation 在那道閘門**之前**就拒絕了這個呼叫，所以沒有
  裁決可記。補一個假的 `decision` 會把沒人做過的決定寫進稽核，缺席才是誠實的
  答案。已用斷言釘住，防止日後「讓 phase 統一」把它偽造出來。
- **拒絕與故障在稽核層也分得開。** 未知名稱記 `failed`，未啟用記 `denied`，
  斷言直接比對兩者不得相等。

以 mutation 驗證過會咬：在 inactive 分支插入一個假的 `host/tool-decision`，
斷言立刻失敗。

### 已知但未處理（不屬本票）

`PiToolAuditRecord` 不帶 contract identity —— `contractStatus` / `schemaDigest`
只進 Turn Record，不進 `session.toolAudit`。稽核串流因此無法自己分辨
「catalogued 但未啟用」與「完全不認得」，只能靠 settlement 與 reason 推斷。
Turn Record 是 ADR-0050 的事實來源，這條不影響本票的驗收條件，但若要讓
`session.toolAudit` 獨立可稽核，需要另開一票。
