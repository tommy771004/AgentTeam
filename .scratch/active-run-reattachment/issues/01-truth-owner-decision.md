# 01 — 決定重新附著的真相歸屬

Status: 可交給代理
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

- [ ] 決策記錄寫進本 effort 目錄,說明選了哪一個以及為什麼
- [ ] 明確回答:落地位置、保留上限(ack／TTL)、記憶體上界
- [ ] 明確回答:是否需要新 ADR 或升 ADR-0038 protocol 版本;需要就先寫
- [ ] 確認未新增第二個 coordinator、未移動結算歸屬(若會移動則先寫 ADR)
- [ ] 決策後回填 spec 的 Implementation Decisions,把「未決」改為已決

## Blocked by

無（本 effort 的第一個決策點）
