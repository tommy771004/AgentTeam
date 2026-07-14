# SubAgents AI

An Electron desktop app (`app/`) that runs an agent loop (Turn/Goal/Time-based/Proactive) over local tools, capabilities, and CLI providers. This context covers the whole product; SubDesign and OpenDesign are workflows within it, not separate products.

## Language

**Design System**:
The canonical, project-owned brand/token contract for a project — a project-relative `DESIGN.md` (plus optional `tokens.css`, `assets/`) living at the project root or under `.subagents/subdesign/design-systems/<id>/`. This is the only form the SubDesign build/critique loop actually reads when generating or scoring artifacts.
_Avoid_: "design system pack", "system" alone when the project-owned form is meant.

**Design System Pack**:
A read-only OpenDesign vendor content record (`OpenDesignCatalogRecord`/`OpenDesignContentPackManifest` with `kind: 'design-system'`) sitting in the local catalog under `app/public/open-design/`. It is inert catalog metadata until explicitly installed/copied into a project, at which point it becomes a **Design System**.
_Avoid_: "design system" alone when referring to vendor/catalog content — this distinction was previously conflated in the codebase (no install path connected the two).

**SubDesign**:
The in-app design task workflow (brief → direction → build → critique → deliver) that runs on the same agent lifecycle (`runTask`) as every other task in the product. Not a separate app or runtime.
_Avoid_: "Open Design" (that's the upstream vendor product SubDesign draws concepts/content from, not this feature).

**OpenDesign** (in this codebase, `agent/openDesign/*`):
The read-only indexer/pack-installer for vendored Open Design content (templates, skills, design system packs) bundled under `app/public/open-design/`. A content source, not a runtime — it never executes agent turns itself.
_Avoid_: "Open Design" (capital, two words) when referring to this in-repo indexing layer — reserve that spelling for the external upstream product being vendored from.

**Chat turn**:
One message the user sends from the composer. Owns busy policy (steer/queue), the chat bubble, and thread continuity — but is not itself the unit that parses/executes.
_Avoid_: using "turn" interchangeably with "Loop run" — a single chat turn can dispatch a Turn-based, Goal-based, Time-based, or Proactive loop run underneath it; they are different layers (see `docs/CONVERSATION_LOOP_HERMES_FLOW.md` §5.2).

**Loop run**:
One `agentEngine.start()` invocation — the unit that actually Parses the request, picks a Loop Pattern (Turn/Goal/Time/Proactive per `docs/02_Execution_Rules`), executes steps, and evaluates DoD. Historically one loop run == one chat turn == the one globally-locked execution slot; as of the concurrent-runs decision (see ADR-0003) multiple loop runs can now be in flight at once, each still 1:1 with the chat turn that started it.
_Avoid_: "run" alone when the distinction from "chat turn" matters — spell out which layer.
