# 13 — Execute isolated CodeMode batches

**What to build:** Let an agent run model-generated JavaScript to coordinate active Pi tools efficiently while withholding direct Host authority and preserving every nested invocation lifecycle.

**Blocked by:** 09 — Edit files with one Approval Decision; 10 — Run and cancel Pi Bash; 12 — Progressively reveal Pi tools and runbooks.

**Status:** resolved

- [x] Generated programs cannot directly access Node, filesystem, process, network, XHR, WebSocket, or Host secrets.
- [x] Only currently active Pi tools are callable from CodeMode.
- [x] Every nested tool call produces its own arguments, approval, updates, result, cancellation, and parent identity.
- [x] Cancelling the outer invocation propagates to active nested calls and settles predictably.
- [x] Isolation and nested-call behavior are verified through black-box protocol tests.

## Answer

Added Host-owned CodeMode execution with blocked host globals, active-tool gating, nested call identities, bounded budgets, and cancellation propagation. The black-box CodeMode suite passes.
