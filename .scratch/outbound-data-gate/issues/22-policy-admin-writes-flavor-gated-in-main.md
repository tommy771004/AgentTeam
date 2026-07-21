# 22 — Policy Admin 寫入僅 policy-admin Flavor（Main 硬閘）

**What to build:** 僅 `SUBAGENTS_BUILD_FLAVOR=policy-admin` 的產物可暴露政策草稿儲存、啟用、回滾等 **管理寫入**；standard build 必須在 main（及 preload 表面）硬拒絕，而不只是 Settings 隱藏導覽。UI 藏 nav 可保留，但不得成為唯一控制。既有草稿驗證、activate 不繞過 Outbound Data Gate 的契約維持不變。

**Blocked by:** None — can start immediately（可與 16 平行）

**Status:** 可交給代理

- [ ] standard flavor 下 policy save / activate / rollback / seed 等 mutation IPC 回傳明確拒絕（或未註冊且呼叫失敗），無法寫入 company policy 樹。
- [ ] policy-admin flavor 下既有草稿生命週期仍可用，且仍不能 bypass Outbound Data Gate 或讀取受保護明文。
- [ ] preload / renderer 表面不在 standard 上提供可成功的寫入捷徑。
- [ ] smoke 或靜態契約：standard 產物無成功 policy write channel；`check-build-flavor` 與 matrix 仍涵蓋 unknown fail-closed。
- [ ] Settings 導覽 gating 與 main hard-deny 一致，避免「按鈕在、IPC 通」或「按鈕無、IPC 仍通」的落差未記錄。

## Parent

[spec-fail-closed-wiring.md](../spec-fail-closed-wiring.md) · review bug 3 · ADR-0016
