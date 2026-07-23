# 10 — Run and cancel Pi Bash

**What to build:** Execute Pi's canonical Bash tool with streamed output, composed approval, bounded execution, and reliable cancellation from the desktop UI.

**Blocked by:** 08 — Read and search projects with Equivalent Pi Tools.

**Status:** resolved

- [x] Pi Bash matches the legacy parameter, result, error, stream, cancel, scope, and recording contract required by the product.
- [x] Bash policy evaluates the complete command/segment behavior through the single Approval Decision authority.
- [x] Output updates remain bounded and visible as one tool item lifecycle.
- [x] User and Host cancellation terminate the underlying execution and settle the Task run accurately.
- [x] No duplicate legacy Bash tool remains enabled after parity passes.

## Answer

Pi Host owns Bash policy and execution with bounded updates, structured tool events, project scope checks, and abort propagation. The Bash tool and stream/cancel black-box suites pass.
