# 01 — OpenDesign Plugin Contract v1 相容載入

Status: 可交給代理

## Parent

[Integrate Open Design harness contracts into SubDesign](../spec.md)

## What to build

讓 SubDesign 以一個權威契約載入 legacy 與 OpenDesign Plugin Contract v1 manifests，並把相容性與拒絕原因呈現給使用者。這是後續 trust、pipeline 和 providers 共用的 contract seam，不執行外部工具。

## Acceptance criteria

- [ ] 現有只含 `SKILL.md` 或舊 manifest 欄位的 plugins 仍可被 catalog 載入與選擇。
- [ ] v1 manifest 可表達 spec version、plugin kind、task kind、mode、inputs、pipeline、capabilities、evals、preview 與 provenance。
- [ ] Catalog、plugin 詳情與 Task run admission 使用同一份 validation result，不各自重新推斷欄位。
- [ ] 支援的 v1 plugin 顯示可執行；未知 major version 顯示明確 incompatibility，不會靜默降級。
- [ ] Unknown capability、malformed stage、invalid repeat/until 或不合法 input schema 會 fail closed 並顯示可理解原因。
- [ ] Parser 接受未知非安全性 metadata，以保留 minor-version forward compatibility，但不讓未知欄位取得執行權限。
- [ ] Shipped-module smoke 同時覆蓋 legacy success、v1 success、unknown version 與 malformed manifest。
- [ ] 沒有新的 Open Design daemon、runner 或 renderer execution owner 被引入。

## Blocked by

None — can start immediately.
