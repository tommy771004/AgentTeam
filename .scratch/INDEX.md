# `.scratch` issue tracker index

Local Markdown tracker per `docs/agents/issue-tracker.md`.  
**Status** vocabulary: `docs/agents/triage-labels.md`（`可交給代理` / `resolved` / …）.

## Active frontier (implement next)

| Effort | Spec | Frontier ticket | Notes |
|--------|------|-----------------|--------|
| **outbound-data-gate** | [spec-fail-closed-wiring.md](outbound-data-gate/spec-fail-closed-wiring.md)（parent [spec.md](outbound-data-gate/spec.md) 01–15 resolved） | [20 main CLI sandbox](outbound-data-gate/issues/20-main-enforced-cli-filesystem-sandbox.md) **或** [22 Policy Admin flavor](outbound-data-gate/issues/22-policy-admin-writes-flavor-gated-in-main.md) | 16–19 resolved；frontier 20 ‖ 22（21 blocked by 20） |
| **hermes-registry-executor-cleanup** | [spec.md](hermes-registry-executor-cleanup/spec.md) | [01 刪 runDelegatedTask](hermes-registry-executor-cleanup/issues/01-delete-runDelegatedTask-export.md) | C：刪 export + 拆 executor→registered |
| **hermes-aligned-runtime** | [spec.md](hermes-aligned-runtime/spec.md) | — | **resolved**（P0–P5；見 Answer 殘差） |

## This session chain (tool → Hermes)

| Order | Effort | Spec status | Tickets |
|-------|--------|-------------|---------|
| 1 | [tool-invocation-pipeline](tool-invocation-pipeline/spec.md) | **resolved** | 01–02 resolved（`invokeGatedTool` + heuristic） |
| 2 | [tool-invocation-review-cleanup](tool-invocation-review-cleanup/spec.md) | **resolved** | 01–02 resolved（契約 + 單一組裝 + 死碼） |
| 3 | [hermes-aligned-runtime](hermes-aligned-runtime/spec.md) | **resolved** | 01–07 resolved |
| 4 | [hermes-registry-executor-cleanup](hermes-registry-executor-cleanup/spec.md) | **可交給代理** | 01–05 open（刪 delegate export + 拆 executor） |

## All efforts

| Effort | Spec | # issues | Spec Status |
|--------|------|----------|-------------|
| [agent-runtime-deepening](agent-runtime-deepening/spec.md) | yes | 6 | resolved（tickets all resolved；spec 見下） |
| [execution-trust-and-safety](execution-trust-and-safety/spec.md) | yes | 4 | 可交給代理 |
| [execution-trust-hardening](execution-trust-hardening/spec.md) | yes | 3 | 可交給代理 |
| [hermes-aligned-runtime](hermes-aligned-runtime/spec.md) | yes | 7 | resolved |
| [hermes-registry-executor-cleanup](hermes-registry-executor-cleanup/spec.md) | yes | 5 | 可交給代理 |
| [outbound-data-gate](outbound-data-gate/spec.md) | yes | 15 resolved + **16–23 open** | [fail-closed wiring](outbound-data-gate/spec-fail-closed-wiring.md) 可交給代理 |
| [subagents-paid-beta](subagents-paid-beta/spec.md) | yes | 17+ | approved |
| [subdesign-project-workspace](subdesign-project-workspace/spec.md) | yes | 5 | 可交給代理 |
| [task-run-coordinator-deepening](task-run-coordinator-deepening/spec.md) | yes | 5 | 可交給代理（票多為已實作待審） |
| [task-run-single-owner-cleanup](task-run-single-owner-cleanup/spec.md) | yes | 4 | 可交給代理 |
| [tool-invocation-pipeline](tool-invocation-pipeline/spec.md) | yes | 2 | resolved |
| [tool-invocation-review-cleanup](tool-invocation-review-cleanup/spec.md) | yes | 2 | resolved |

## outbound-data-gate fail-closed wiring DAG (16–23)

```
16 main-owned guard mode          22 policy-admin writes flavor-gated (parallel)
 └─ 17 required view prepare fail-closed
     └─ 18 single restricted view-root truth
         ├─ 19 LLM egress company Provider Security Profile
         └─ 20 main-enforced CLI filesystem sandbox (+ canary off original)
              └─ 21 builtin shell cannot escape view
16 + 19 + 20 ─→ 23 main-only evidence at true egress
```

Source: code review bugs 1–11 → [spec-fail-closed-wiring.md](outbound-data-gate/spec-fail-closed-wiring.md)

## hermes-aligned-runtime ticket DAG

```
01 P0a intercept
 └─ 02 P0b FC+MCP → invokeGatedTool
     └─ 03 P1 Registry big bang
         └─ 04 P2 ContextEngine + compress
             └─ 05 P3 single conversation loop
                 └─ 06 P4 nested → runTask
                     └─ 07 P5 parallel tool_calls
```

## Conventions

- Spec: `.scratch/<slug>/spec.md`
- Tickets: `.scratch/<slug>/issues/<NN>-<slug>.md`
- One ticket per file; **Blocked by** near top; **Status** near top
- Do not invent paths in acceptance criteria beyond durable names
