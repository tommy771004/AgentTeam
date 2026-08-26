# 09 — 重新附著的 UI 呈現

Status: 可交給代理
Spec: `.scratch/active-run-reattachment/spec.md`

## What to build

生命週期正確之後才做畫面。三件事:

- **重新附著中**的狀態,讓使用者能分辨「重連中」與「沒東西在跑」,而不是看到空面板。
- **缺口告知**:保留有界,重新附著時若有未載入的更早範圍,如實說出來,不得把被截短的歷史當成完整歷史呈現。
- **重連中**與 run 失敗在視覺上必須可分辨。

沿用既有 Turn Record 投影與既有 design token,**不新增第二個進度來源、不新增假百分比、不新增漸層或 glow**。UI 文案維持 Traditional Chinese mixed with English。

## Acceptance criteria

- [ ] 重新附著中有明確狀態,與「閒置」可分辨
- [ ] 有缺口時如實告知未載入範圍,不假裝完整
- [ ] 重連中與 run 失敗視覺可分辨
- [ ] 沿用既有 Turn Record 投影,未新增第二個進度來源
- [ ] 未新增假百分比;樣式全用既有 design token
- [ ] `npm run build` 通過;既有面板行為不回歸

## Blocked by

05 — renderer bootstrap 重新附著 + 容量重建
