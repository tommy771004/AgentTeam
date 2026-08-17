# 09 — Decide whether the sandbox obligation extends to the builtin shell

**What to build:** An ADR deciding whether ADR-0022's filesystem-sandbox obligation covers the builtin shell, and — only if accepted — the implementation that feeds real probe results into the decision.

**Blocked by:** None. The ADR must be accepted before any code is written.

**Status:** 待分流

This is a scope decision, not a bug fix, and it needs a maintainer's judgement before an agent implements anything.

Today `decideBuiltinShellUnderProtection()` is called with a hardcoded `shellIsolationVerified: false`, so under `required` mode the builtin `bash` is **refused** rather than sandboxed. That is the correct reading of the current rule: ADR-0022 places the filesystem-sandboxing obligation on external CLI only, and states that if verified isolation is unavailable, external CLI execution is unavailable. The consequence is that the strictest mode is the least usable one.

Correction to the source analysis: the hardcoded call site is `src/agent/tools/registered/bash.ts:60`. `agent/outbound/cliSandbox.ts` declares the option (line 226) and consumes it (line 253); the comparison document attributes the call site to `cliSandbox.ts`.

The building blocks exist. `electron/cliFilesystemSandbox.ts` has the seatbelt and bwrap profile builders, and `buildSeatbeltProfile()` already produces SBPL. Technically they can be applied to the `electron/shellBridge.ts` spawn path. The open question is whether they should be, and what happens on Windows where no backend exists.

- [ ] An ADR is written stating whether the builtin shell falls under the ADR-0022 sandbox obligation, and why.
- [ ] The ADR defines what `required` mode means for the builtin shell: isolated execution, refusal, or refusal-with-fallback.
- [ ] The ADR defines Windows fallback semantics explicitly, since no backend exists there.
- [ ] The ADR states its relationship to ADR-0022 — revision or extension — and links `docs/DEEPSEEK_HARNESS_COMPARISON_2026-08-17.md` as the analysis of record.
- [ ] An ADR number is claimed from the free range (`docs/adr/` currently ends at `0046`).
- [ ] If and only if the ADR is accepted: `shellIsolationVerified` is fed by a real probe rather than a hardcoded `false`, and the profile builders are applied to the `shellBridge.ts` spawn path.
- [ ] If accepted: verification follows the real-probe pattern of `smoke-cli-sandbox`, `smoke-cli-main-sandbox`, and `smoke-cli-filesystem-sandbox.mts`.
- [ ] If accepted: `smoke:outbound-shell-evidence` shows builtin `bash` under `required` as isolated execution, not refusal.
- [ ] If rejected: the ADR records the rejection and the current refusal behaviour is documented as intentional in `CONTEXT.md`.

Files: `docs/adr/`, `app/src/agent/tools/registered/bash.ts`, `app/src/agent/outbound/cliSandbox.ts`, `app/electron/cliFilesystemSandbox.ts`, `app/electron/shellBridge.ts`.
