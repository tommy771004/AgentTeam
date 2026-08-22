# 02 — Let active work survive the five-minute boundary

**What to build:** Replace the blanket five-minute external-process deadline with scoped startup, idle, and absolute safety deadlines, so healthy high-reasoning work continues while genuinely inactive or unbounded work terminates with an accurate explanation.

**Blocked by:** 01 — Expand the External CLI Run Session seam.

**Status:** 可交給代理

- [ ] No external adapter silently applies a five-minute wall-clock deadline to the entire Task run.
- [ ] Interactive policy defaults to a ten-minute idle deadline and a sixty-minute absolute safety cap, centrally bounded in the immutable run snapshot.
- [ ] Startup timeout, idle timeout, absolute safety cap, operation timeout, cancellation, and process failure are distinct terminal classifications.
- [ ] Meaningful model, tool, process, provider, approval, input, and terminal events update session activity through the typed lifecycle contract.
- [ ] A deterministic run that emits meaningful activity for more than five simulated minutes remains active and completes normally.
- [ ] A deterministic silent run reaches the idle deadline, terminates its owned process tree, and settles exactly once as idle timeout.
- [ ] A noisy run that continually resets idle activity still reaches the absolute safety cap and settles exactly once.
- [ ] A process that never emits its first valid lifecycle event reaches startup timeout rather than idle timeout.
- [ ] The activity projection and terminal copy show the actual timeout class; the headless-mode hint is not used as a generic timeout message.
- [ ] Focused deadline smokes, build, and the complete smoke chain pass.

