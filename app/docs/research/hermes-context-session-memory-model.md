# Hermes Agent：Context、Session、Memory 與模型切換整合

> 研究範圍只涵蓋 NousResearch/hermes-agent 的 context management／compaction、session persistence／lifecycle、memory recall／storage、model／provider switching。來源固定在 upstream commit [`8436e0d`](https://github.com/NousResearch/hermes-agent/tree/8436e0d142b8756dc9f16c79ec24da2f549ad392)，避免 `main` 後續漂移。

## 結論

Hermes 最值得移植的不是某一個摘要 prompt，而是四個分離的資料面：

1. **Session transcript 是完整、持久的事實帳本**：SQLite 保存 session metadata、完整 messages、model／system-prompt snapshot 與 lineage；resume 與跨 session search 都從這裡讀。
2. **Active context 是每次模型請求的投影**：context engine 可以壓縮長對話，也可以只為本次 request 選擇 context；後者不得改寫 durable transcript。
3. **Memory 是 transcript 之外的長期知識層**：built-in memory 永遠存在，最多再掛一個 external provider；turn 前 recall，turn 後非同步 ingest。
4. **Model 是有 scope 的 runtime override**：`once`、`session`、`global` 分開；effective model 的唯一優先序為 session override > channel config > global config。切換後必須重算 context window 與 compaction 狀態，不能只換 model 字串。

這四層若混在同一個 thread store 或全域 agent singleton，常見結果就是：切換模型後沿用舊 token 閾值、不同對話互相覆蓋 runtime、摘要污染完整 transcript、memory provider 卡住整個 turn。

## 1. Context 與 compaction

Hermes 把 context 管理抽成單一 active `ContextEngine`。介面擁有 token usage 更新、壓縮判斷、壓縮、session start/end/reset，以及可選的每回合 context selection；engine 由 `context.engine` 選擇，built-in compressor 是預設值。來源：[agent/context_engine.py](https://github.com/NousResearch/hermes-agent/blob/8436e0d142b8756dc9f16c79ec24da2f549ad392/agent/context_engine.py)

關鍵邊界是 `compress()` 與 `select_context()` 不同：

- `compress()` 在 context 過長時產生較短且可延續的訊息序列。
- `select_context()` 每次 request 都可替換送往 provider 的 message list，但結果只屬於該次 request，不能被當作 persisted transcript；回傳內容仍要走 tool-pair、role、whitespace／JSON 等 sanitizer。
- 不變的 selection 應保持 byte-stable，否則會破壞 provider prompt-cache prefix。

預設 `ContextCompressor` 的主要流程是：先用 deterministic pass 修剪舊 tool result，再保留 system／開場 head，以 token budget 保留最近 tail，摘要中間區段，後續壓縮則迭代更新 rolling summary。它也對齊 tool-call/result 邊界、清掉 orphan pairs，並在輸出端剝除 `_db_persisted` marker，避免 child session flush 誤判「已持久化」而漏存壓縮後 transcript。來源：[agent/context_compressor.py](https://github.com/NousResearch/hermes-agent/blob/8436e0d142b8756dc9f16c79ec24da2f549ad392/agent/context_compressor.py)

其他可移植保護：

- threshold 不只看 context-window 百分比，也扣除 output-token reservation；小 context model 另有 floor／trigger 策略。
- 避免 anti-thrashing：連續壓縮節省太少時停止自動重試並回報 blocked reason。
- summary provider 發生 transient／quota 錯誤時有 cooldown；手動 `/compress` 可明確 bypass。
- tool-result pruning 與 full compression 是兩個 trigger；前者須達最低 reclaim 才 commit，以免每回合重寫舊 prefix、持續打掉 prompt cache。
- micro-compaction 預設關閉，因為每回合重寫歷史會每回合破壞 prompt cache。來源：[docs/micro-compaction.md](https://github.com/NousResearch/hermes-agent/blob/8436e0d142b8756dc9f16c79ec24da2f549ad392/docs/micro-compaction.md)

## 2. Session lifecycle 與 persistence

Hermes 將每段對話持久化到 `~/.hermes/state.db`：session metadata 與完整 messages 分表；session 保存來源、使用者、model／model config、system prompt snapshot、token／時間資料與 `parent_session_id`。FTS5 建立於 message transcript 上，因此 resume、browse、search 不依賴壓縮摘要。來源：[hermes_state.py](https://github.com/NousResearch/hermes-agent/blob/8436e0d142b8756dc9f16c79ec24da2f549ad392/hermes_state.py)、[session storage developer guide](https://github.com/NousResearch/hermes-agent/blob/8436e0d142b8756dc9f16c79ec24da2f549ad392/website/docs/developer-guide/session-storage.md)、[sessions user guide](https://github.com/NousResearch/hermes-agent/blob/8436e0d142b8756dc9f16c79ec24da2f549ad392/website/docs/user-guide/sessions.md)

Lifecycle 的語意也有刻意分層：

- `on_session_start`：載入該 session 的 engine/provider state。
- turn 完成：messages append 到 DB；不是 session 結束。
- `on_session_end`／finalize：CLI exit、reset、gateway expiry 等真正 lifetime boundary 才 flush／close。
- `/new`／reset：清空 conversation-scoped override、context-engine calibration、memory session binding；新 session 使用新 ID。
- context compression 可以建立 child session，使用 `parent_session_id` 串成 lineage；UI 應把 lineage 呈現為同一條可延續對話，而不是互不相關的重複 session。

Gateway 另外以 `session_key` 對應 platform/chat/user 到 durable session ID；它是 routing identity，不應與 transient run ID 混用。來源：[gateway/session.py](https://github.com/NousResearch/hermes-agent/blob/8436e0d142b8756dc9f16c79ec24da2f549ad392/gateway/session.py)、[gateway/session_context.py](https://github.com/NousResearch/hermes-agent/blob/8436e0d142b8756dc9f16c79ec24da2f549ad392/gateway/session_context.py)

## 3. Memory storage、recall 與同步

Hermes 的 `MemoryManager` 是唯一整合點：built-in provider 可與最多一個 external provider 共存；拒絕第二個 external provider，避免 tool schema 膨脹與多個 backend 對同一知識互相衝突。provider contract 明確區分 availability、initialize、static system-prompt block、prefetch、queue-prefetch、sync-turn、session-end 與 memory-write mirror。來源：[agent/memory_manager.py](https://github.com/NousResearch/hermes-agent/blob/8436e0d142b8756dc9f16c79ec24da2f549ad392/agent/memory_manager.py)、[agent/memory_provider.py](https://github.com/NousResearch/hermes-agent/blob/8436e0d142b8756dc9f16c79ec24da2f549ad392/agent/memory_provider.py)

每回合資料流：

```text
user input
  -> sanitize／移除 skill scaffolding
  -> provider prefetch(session_id, query)
  -> fenced memory-context 注入本次 request
  -> model/tool loop
  -> sync_turn(user, assistant, session_id)  [背景、同序]
  -> queue_prefetch(next turn)               [背景]
```

重要實作品質：

- external prefetch 有 timeout；一個 provider 失敗不阻擋其他 provider 或主要回合。
- post-turn sync 不在 response completion path 內執行，避免遠端 memory daemon 讓 task 長時間維持 running。
- 寫入由單 worker 序列化，保證同一 manager 中 turn N 先於 N+1；但 shutdown 只做 bounded drain，因此仍屬 eventual durability。
- recall context 會移除巢狀 fence、敏感內容與 URL credential，並套長度上限；它被標成 background data，不冒充新 user input。來源：[agent/context_engine.py](https://github.com/NousResearch/hermes-agent/blob/8436e0d142b8756dc9f16c79ec24da2f549ad392/agent/context_engine.py)、[agent/memory_manager.py](https://github.com/NousResearch/hermes-agent/blob/8436e0d142b8756dc9f16c79ec24da2f549ad392/agent/memory_manager.py)

Built-in `MEMORY.md`／`USER.md` 與 external provider 是 additive，不是同一份 transactional store；external provider 還可能把資料存到第三方。來源：[memory providers guide](https://github.com/NousResearch/hermes-agent/blob/8436e0d142b8756dc9f16c79ec24da2f549ad392/website/docs/user-guide/features/memory-providers.md)

## 4. Model／provider 切換與 routing

Hermes 將 `/model` 的解析與 scope 決策集中在 `model_switch.py`：

- `--once`：只影響下一 turn，不寫全域設定。
- `--session`：只影響目前 session。
- `--global`：寫入全域 config。
- 未指定 scope 時預設 session-only；provider switch 也預設 session-only。
- effective model 的唯一優先序是 `session override > channel/session config > global config`。

來源：[hermes_cli/model_switch.py](https://github.com/NousResearch/hermes-agent/blob/8436e0d142b8756dc9f16c79ec24da2f549ad392/hermes_cli/model_switch.py)

真正的 hot-switch 不只是換名稱。runtime resolver 先產生 provider client、base URL、API mode 與 credentials；fallback 亦走相同 provider resolution，而 auxiliary work（compression、vision、title 等）有獨立 routing config。來源：[hermes_cli/runtime_provider.py](https://github.com/NousResearch/hermes-agent/blob/8436e0d142b8756dc9f16c79ec24da2f549ad392/hermes_cli/runtime_provider.py)、[agent/auxiliary_client.py](https://github.com/NousResearch/hermes-agent/blob/8436e0d142b8756dc9f16c79ec24da2f549ad392/agent/auxiliary_client.py)、[provider runtime guide](https://github.com/NousResearch/hermes-agent/blob/8436e0d142b8756dc9f16c79ec24da2f549ad392/website/docs/developer-guide/provider-runtime.md)

切換後 `ContextCompressor.update_model()` 會重算 context length、threshold、tail budget、summary budget 與 output reservation，清掉前一模型的 token calibration、compression effectiveness strikes、provider-specific failure cooldown 與 prune runway。這可避免 200K model 切到 32K model 後仍跳過必要 preflight、第一個 request 直接 overflow。來源：[agent/context_compressor.py](https://github.com/NousResearch/hermes-agent/blob/8436e0d142b8756dc9f16c79ec24da2f549ad392/agent/context_compressor.py)

## 可移植到目前專案的設計合約

| 合約 | 建議資料 owner | 必要不變量 |
|---|---|---|
| `SessionRecord` | durable session repository | 完整 transcript append-only；保存 model/system snapshot；可用 lineage 連續呈現 |
| `RunSnapshot` | `runTask` admission 時建立 | model/provider/depth/speed/approval/project 等提交後不可被 Settings 或其他 thread 改寫 |
| `ContextProjection` | session-scoped context engine | request-only selection 不得覆寫 transcript；compaction commit 要保留 tool-pair 合法性 |
| `MemoryProvider` | memory manager | recall 有 session scope、timeout、redaction；sync 非阻塞但同 session 有序 |
| `RuntimeProfile` | model runtime resolver | scope 與 precedence 只有一個 owner；包含 client/API mode/context window/capabilities，不只是 model ID |
| conversation mutable state | keyed registry | 全部以 `threadId/sessionId` 分區；不得用全域 singleton 的 current model／messages／compressor |

建議補齊順序：

1. **先補 durable session ledger**：session/message/schema、resume、lineage、system/model snapshots，以及原子 append。
2. **再補 immutable run snapshot**：所有執行入口只吃 admission snapshot；Settings 只影響未提交 run。
3. **加入 session-scoped context engine**：先做 deterministic tool-result prune 與 threshold preflight，再做中段 summary；建立 request-only projection API。
4. **建立 memory manager seam**：built-in memory 先落地，external provider 用相同 interface 外掛；pre-turn bounded recall、post-turn ordered background sync。
5. **完成 model switch transaction**：resolve + validate 新 runtime → recalibrate context engine → 必要時 preflight compact → 原子替換該 session runtime；失敗保留舊 runtime。
6. **最後做 UI 與 observability**：顯示目前 effective model、override scope、context pressure、上次 compaction、memory recall provenance；lineage 在 UI 合併但保留可檢視 segment。

最低測試矩陣應涵蓋：兩個 thread 同時使用不同 model/provider；執行中修改 Settings 不影響既有 run；大窗切小窗先 preflight；tool-call/result 不被切開；request projection 不寫 DB；memory timeout 不拖住 turn；同 session memory sync 有序；reset 不殘留 model/context/memory state；resume 能還原 transcript、model snapshot 與 lineage。

## 不宜直接照搬的部分

- **壓縮是 lossy projection，不是刪除或隱私功能**：原始 messages 仍在 session DB。若需要「忘記」，要另做可驗證刪除流程。
- **Built-in flat-file memory 容量與衝突處理有限**：適合個人 facts/preferences，不等於版本化 domain knowledge 或 artifact index。
- **單一 external provider 是刻意限制**：若專案需要多 provider，必須先定義 ownership、dedupe、precedence、provenance 與 deletion fan-out，不能直接 fan-in 字串。
- **非同步 memory sync 是可用性優先**：程序在 bounded drain 前終止可能尚未完成遠端寫入；重要 facts 應先 durable outbox，再由 worker 投遞。
- **Session lineage 會增加 UI 複雜度**：若每次 compaction 都建 child session，清單必須 lineage-aware；否則使用者會看到大量「重複」對話。
- **模型切換會破壞部分 prompt cache**：模型／provider-specific system prompt、tool schema、cache-control 都可能變；應把 explicit switch 視為 cache boundary，不能宣稱無成本 hot swap。
