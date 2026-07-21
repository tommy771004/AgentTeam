# 21 — 保護下 Builtin Shell 不得逃出 Restricted Project View

**What to build:** 當保護啟用（尤其 `required`）時，builtin shell / bash 類工具不能只靠 cwd 指到 view，而仍可用絕對路徑讀取原始專案、home 或其他逃逸路徑。必須 **拒絕** 未隔離 shell，或套用與 required CLI 同等級的 filesystem isolation，使「僅存在於 original root 的 sentinel」在保護 run 中不可讀。

**Blocked by:** 18 — View root 單一真相源；20 — Main 強制 CLI Filesystem Sandbox

**Status:** 可交給代理

- [ ] 保護啟用時，builtin shell 無法讀取僅存在於 original project 的敏感 sentinel（絕對路徑攻擊失敗或工具被 deny）。
- [ ] 行為與 ADR-0007 / ADR-0022 一致：cwd 變更 alone 不算 isolation。
- [ ] `required` 下若無法提供等價 sandbox，shell 出站/執行必須 fail-closed 而非 silent host shell。
- [ ] optional/demo 若允許較弱 shell，必須可觀測標記，不得與 verified 混淆。
- [ ] smoke：protected run + absolute path to original secret → deny 或不可讀內容。

## Parent

[spec-fail-closed-wiring.md](../spec-fail-closed-wiring.md) · review bug 5
