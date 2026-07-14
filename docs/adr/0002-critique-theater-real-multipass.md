# Critique Theater must run real multi-pass critique, not single-call staging

**Status**: accepted

Critique Theater's UI presents a 2-round × 3-panelist design review, but the implementation behind it issues exactly one `design_critique` call; `subDesignCritiqueSessionStore` synthesizes the panelist and round rows by re-slicing that single result's four scores. `SUBDESIGN_WORKFLOW_GAP_REVISION_PLAN_2026-07-13_R3.md` marked this "✅ 已完成," describing "兩輪三 panelist、live trace、可中止," without verifying the underlying engine — the gap between the documented status and actual behavior shipped silently.

We're building the engine to match the UI it already ships: `runCritique()` must issue three distinct panelist-scoped critique calls (visual/brand, accessibility, implementation-readiness) for round 1, then a round 2 pass that specifically re-checks round-1 blockers, instead of one call decorated to look like many.

The feature already promises multi-pass review to users and was documented as complete. Shipping cosmetic staging over a single-pass result is a correctness/trust bug, not an open scope question — descoping the UI instead was considered and rejected because it throws away a shipped differentiator (Open Design's own critique system does real multi-panelist review) to paper over the gap rather than close it. This is a real cost: more LLM calls per critique run (latency and cost scale with panelist/round count), accepted deliberately in exchange for an honest, differentiated feature.

## Implementation status

- [Ｘ] 已實作並驗證：Critique Theater 以三個 round-1、三個 round-2 的 `design_critique_note` 為必要輸入；session runtime 會拒絕重複 panelist、跳輪與未完成六個 note 的 final，並以 single-claim gate 保證只寫入一次 `design_critique`。已通過 build 與 capability smoke。
