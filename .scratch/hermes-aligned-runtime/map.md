# hermes-aligned-runtime — map

## Notes

Hermes-aligned runtime program after architecture review vs NousResearch/hermes-agent and full-package grilling (decisions 1–21, scope expanded to all phases).

Depends on completed:

- `tool-invocation-pipeline` (heuristic `invokeGatedTool`)
- `tool-invocation-review-cleanup` (single assembly, contract)

## Decisions-so-far

- Same effort, serial phases P0–P5
- P0: intercept → FC+MCP via invokeGatedTool; halt rethrow; tool strings
- P1: Hermes full registry big bang
- P2: ContextEngine + Hermes-oriented compress rewrite
- P3: single conversation loop; drop public StepExecutor seam
- P4: all nested via runTask
- P5: parallel multi tool_calls (Hermes defaults)

## Fog

- P1 big bang migration blast radius
- P2 compress algorithm quality bar
- P3 merge size vs strategy-test rewrites

## Frontier

Open, unblocked, unclaimed: **01** (P0a agent-level intercept).
