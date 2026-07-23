# 09 — Edit files with one Approval Decision

**What to build:** Let Pi edit and write project files through the existing approval experience while producing one composed policy verdict and one observable tool lifecycle.

**Blocked by:** 08 — Read and search projects with Equivalent Pi Tools.

**Status:** resolved

- [x] Pi `edit` and `write` satisfy Equivalent Tool contracts before legacy implementations are disabled.
- [x] Allow, deny, ask, timeout, unattended denial, and cancellation produce one Approval Decision and structured events.
- [x] Approval Mode, stronger policy rules, and forced approval retain their documented precedence.
- [x] Approved mutations and failures are recorded in the Pi session and reflected in the desktop UI.
- [x] Tests assert external file results and protocol events rather than internal guard calls.

## Answer

Pi Host now owns edit/write execution, approval decisions, cancellation, session audit, and renderer-visible tool lifecycle events. The Pi edit/write and approval black-box suites pass.
