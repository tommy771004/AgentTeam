# 01 — Follow-up 動作契約與「中止並接手」語意展開

Spec: `../spec.md`

**What to build:** 建立可向後相容的 interactive follow-up 動作契約，讓使用者與系統明確區分 true steer、queue 與現有的 abort-and-replace takeover。External CLI 執行中的既有接手流程維持可用，但所有 UI、回傳結果與 activity 都改以「中止並接手」表達，不再冒充同 turn 引導；每次提交同時取得穩定 client identity 與 frozen runner capability，供後續 Host 接受、去重與恢復使用。

**Blocked by:** None — can start immediately.

**Status:** 可交給代理

- [ ] Follow-up 公開契約可表示 `steer`、`queue` 與 `takeover`，並攜帶穩定 client identity、conversation identity、runner kind 與 frozen capability
- [ ] External CLI 不公開 true steer；執行中的 abort-and-replace 在 composer、system notice、activity 與回傳結果一致顯示「中止並接手」
- [ ] Builtin Pi 的 true steer 與 takeover 在型別及使用者文案上不可混用，現有 abort path 不再被命名為 steer
- [ ] Global follow-up setting 只決定新提交的預設動作，不會改寫已建立 submission 的 frozen action
- [ ] 相同文字但不同 client identity 可形成兩筆意圖；同 identity 的 transport retry 不產生第二筆
- [ ] 所有會形成新 Task run 的動作仍通過唯一 `runTask` ingress，UI 不直接 dispatch runner
- [ ] 現有 queue／busy policy 行為在 expand 階段保持可建置，尚未遷移的 caller 有明確 compatibility mapping
- [ ] Focused contract smoke 覆蓋 runner capability matrix、stable identity、舊值 migration 與 takeover 文案，並掛入實際 smoke gate

