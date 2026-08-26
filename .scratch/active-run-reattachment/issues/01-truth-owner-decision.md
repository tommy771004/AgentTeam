# 01 — 決定重新附著的真相歸屬

Status: resolved
Type: grilling
Spec: `.scratch/active-run-reattachment/spec.md`

## What to build

**這是一個決策票,不是實作票。** 產出是一份決策記錄,不是程式碼。

「Host 擁有一份夠耐久的 active/terminal run journal」裡的「Host」在本專案有歧義,而兩種解讀導出的工程量差一個量級:

- **A:main 的 `piHostSupervisor`。** main 本來就活過 renderer reload,也本來就持有那個 pending 的 `turn/submit`;attachment record 放它旁邊即可。不動 Pi Host Protocol、不需 ADR-0038 版本升級、Pi child 完全不改。代價:main 死掉救不回來(但那已被本 effort 明確排除在範圍外)。
- **B:Pi Host child 的 durable journal。** 把 attach/ack 加進 Pi Host Protocol 本身,依 ADR-0038 升 protocol 版本,ADR-0040 的 journal 要擴出 automation queue 之外。好處是連 main 重啟也能救;代價是改動大很多,且會複製一份 supervisor 已經有的狀態。

選 B 會讓 03（IPC 面）與 02（attachment record）的形狀完全改變,所以必須先決出來。

決策時要一併回答:落地位置(記憶體／磁碟)、保留上限如何界定、以及是否觸發 ADR。若結論是移動執行或結算的歸屬,**先寫 ADR 再動工**。

## Acceptance criteria

- [x] 決策記錄寫進本 effort 目錄,說明選了哪一個以及為什麼
- [x] 明確回答:落地位置、保留上限(ack／TTL)、記憶體上界
- [x] 明確回答:是否需要新 ADR 或升 ADR-0038 protocol 版本;需要就先寫
- [x] 確認未新增第二個 coordinator、未移動結算歸屬(若會移動則先寫 ADR)
- [x] 決策後回填 spec 的 Implementation Decisions,把「未決」改為已決

## Blocked by

無（本 effort 的第一個決策點）

## Answer

選 **B：Pi Core Host child 的 run attachment journal**。完整決策見 [`../decision.md`](../decision.md)。

- Pi Core Host 保存 authoritative active／terminal metadata；main supervisor 只 relay，不保存第二份真相。
- active 保留至 terminal；terminal 到 ack 或 24 小時 TTL，硬上限 256 筆；attach 每頁 200 entries，terminal summary 上限 64 KiB。
- Pi Host Protocol v2 → v3；不新增 ADR，因 ADR-0039 已決定 Host canonical 與 snapshot + cursor。ADR-0040 的 automation queue record 不與 attachment record 混為一種語意。
- Pi execution settlement 與 `taskRunCoordinator` app finalization 維持既有 owner，未新增第二個 coordinator。若實作發現必須移動 owner，須另案先寫 ADR。
