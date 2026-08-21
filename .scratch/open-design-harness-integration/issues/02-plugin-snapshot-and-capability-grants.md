# 02 — Plugin resolved snapshot 與 capability grants

Status: 可交給代理

## Parent

[Integrate Open Design harness contracts into SubDesign](../spec.md)

## What to build

讓使用者採用一個相容 plugin 時，得到可重現的 resolved snapshot，並在任何具權限的 stage 執行前看見、核准或拒絕 capability requests。Trust 決定必須可撤銷、可稽核，且不能包含 raw credentials。

## Acceptance criteria

- [ ] 採用 plugin 會保存 source identity、resolved version 或 commit、content hash、requested capabilities 與 granted capabilities。
- [ ] Snapshot 儲存在 project-relative 範圍，重新啟動或切換對話後仍解析到同一份內容。
- [ ] 遠端或 vendor pack 更新不會靜默取代既有 project snapshot；使用者必須明確 refresh。
- [ ] Filesystem-write、subprocess、shell、network、MCP 與 connector capabilities 預設不授權。
- [ ] Capability request 進入現有 Pi Core approval policy，並維持 run/thread scope 與 unattended timeout 規則。
- [ ] 使用者可以查看與撤銷既有 grant；撤銷後下一次執行會重新要求核准或 fail closed。
- [ ] Source hash 或 capability fingerprint 改變時，舊 grant 不再有效並要求重新核准。
- [ ] Snapshot、activity 與 UI Projection 只包含 credential reference 或 redacted metadata，不包含 raw token。
- [ ] 絕對路徑、path traversal 與 project-root 外 snapshot location 會被拒絕。
- [ ] Smoke 覆蓋 deterministic hash、changed fingerprint、denied grant、revocation 與 restart recovery。

## Blocked by

- 01 — OpenDesign Plugin Contract v1 相容載入
