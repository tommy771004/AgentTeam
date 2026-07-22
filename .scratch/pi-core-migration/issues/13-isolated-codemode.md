# 13 — Execute isolated CodeMode batches

**What to build:** Let an agent run model-generated JavaScript to coordinate active Pi tools efficiently while withholding direct Host authority and preserving every nested invocation lifecycle.

**Blocked by:** 09 — Edit files with one Approval Decision; 10 — Run and cancel Pi Bash; 12 — Progressively reveal Pi tools and runbooks.

**Status:** 可交給代理

- [ ] Generated programs cannot directly access Node, filesystem, process, network, XHR, WebSocket, or Host secrets.
- [ ] Only currently active Pi tools are callable from CodeMode.
- [ ] Every nested tool call produces its own arguments, approval, updates, result, cancellation, and parent identity.
- [ ] Cancelling the outer invocation propagates to active nested calls and settles predictably.
- [ ] Isolation and nested-call behavior are verified through black-box protocol tests.
