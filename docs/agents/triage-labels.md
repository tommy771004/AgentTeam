# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the local Markdown `Status:` strings used in this repository.

| Label in mattpocock/skills | Local `Status:` | Meaning |
| --- | --- | --- |
| `needs-triage` | `待分流` | Maintainer needs to evaluate this issue |
| `needs-info` | `待補資訊` | Waiting on reporter for more information |
| `ready-for-agent` | `可交給代理` | Fully specified, ready for an AFK agent |
| `ready-for-human` | `需人工處理` | Requires human implementation |
| `wontfix` | `不處理` | Will not be actioned |

## `resolved` 的證據定義（2026-08-26 起）

Status 可翻 `resolved`，唯當滿足其一：

1. **程式碼票**：其驗收框全滿，且該票宣稱的 smoke 檔在 gate 上（`npm run smoke` / `build` / `dist*` 實際執行的腳本集合）並為綠。在 `KNOWN_UNGATED_TESTS` 清單上等於沒有證據。
2. **非程式碼決議**：本質為決議者（ADR accepted、維護者裁決、範圍裁決），需留下決議文件連結。

紀律：每個 effort 收口時同步更新 `.scratch/INDEX.md` 的 Status 與 `DEV_STATE.md`；翻牌的 Comments 需指名證據（gate smoke 或決議文件），一 hop 內可查核。

When a skill mentions a role (for example, "apply the AFK-ready triage label"), use the corresponding local `Status:` string from this table.
