# 22 — Policy Admin 寫入僅 policy-admin Flavor（Main 硬閘）

**What to build:** 僅 `SUBAGENTS_BUILD_FLAVOR=policy-admin` 的產物可暴露政策草稿儲存、啟用、回滾等 **管理寫入**；standard build 必須在 main（及 preload 表面）硬拒絕，而不只是 Settings 隱藏導覽。

**Blocked by:** None

**Status:** resolved

- [x] `assertPolicyAdminWriteAllowed` — standard 硬拒絕。
- [x] save / activate / rollback / seed 均 gate。
- [x] policy-admin flavor 下既有 lifecycle smoke 通過。
- [x] smoke：ticket22 in policy-admin-bridge + shell-evidence。

## Parent

[spec-fail-closed-wiring.md](../spec-fail-closed-wiring.md) · ADR-0016

## Answer

- pure: `assertPolicyAdminWriteAllowed` in `policyAdmin.ts`
- `policyAdminBridge` 四個 mutation 入口
