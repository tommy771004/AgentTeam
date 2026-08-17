# 13 — Write the ADR: a model cannot manufacture its own execution credential

**What to build:** An ADR stating evidence unforgeability as an independent architectural principle, so it can be cited outside the codebase.

**Blocked by:** None.

**Status:** 可交給代理

The property already holds in code and has never been written down on its own terms. `LoopRequest`'s `'time'` and `'proactive'` variants require a `ScheduleTriggerSnapshot` / `EventTriggerSnapshot` at the type level, so an evidence-free request is unrepresentable; `runLoop`'s entry refuses one again at runtime in case the type system is bypassed. Conversation text carrying cron or event intent produces an `automationSuggestion.ts` suggestion, never execution. `eventMatcher.ts` deliberately does not inspect target text — it derives canonical evidence only from an adapter-supplied rule and a normalized payload.

The contrast is concrete: in the compared harness, `schedule_create` is a model-callable tool, so a model can schedule itself.

ADR-0026 preserves the loop patterns but does not state evidence unforgeability as a principle in its own right. This is the clearest security differentiator the product has and it needs a citable document.

- [ ] An ADR states the principle: execution credentials are produced by non-model components, and no model output can constitute or synthesise one.
- [ ] It documents the two enforcement layers — type-level unrepresentability and the fail-closed runtime refusal at `runLoop`'s entry — and why both exist.
- [ ] It records that `eventMatcher.ts` intentionally does not read target text, and why that matters for the guarantee.
- [ ] It records the suggestion path as the safe outlet for conversational automation intent.
- [ ] It states the relationship to ADR-0026 and defines the principle's scope beyond loop patterns, setting up ticket 14.
- [ ] It names the contrast with model-callable scheduling explicitly, so the difference is legible to an external reader.
- [ ] It links `docs/DEEPSEEK_HARNESS_COMPARISON_2026-08-17.md` as the analysis of record.
- [ ] An ADR number is claimed from the free range (`docs/adr/` currently ends at `0046`), coordinating with ticket 09 so the two do not collide.

Files: `docs/adr/`, `CONTEXT.md`.
