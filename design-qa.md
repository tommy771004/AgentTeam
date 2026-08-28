# SubDesign unified Studio - Design QA

Status: **Passed**

Reviewed: 2026-08-20

Target: combined SubDesign conversation, lifecycle, artifact canvas, and direction selection flow

## Visual comparison

- Reference: `/Users/tommy/.codex/generated_images/01a0055a-ff01-77b3-8f06-f64cad0e8948/exec-3e81c8e6-2884-4640-adc8-65db2e1dfe22.png`
- Implementation: `.scratch/subdesign-design-qa/implementation-1568x1003.png`
- Combined review input: `.scratch/subdesign-design-qa/comparison.png`
- Both desktop captures use the same `1568 x 1003` viewport and the same Direction-stage state.
- Compact check: `.scratch/subdesign-design-qa/responsive-1024x768.png`

## Comparison history

1. Initial production flow capture found an internal workflow prompt rendered as the user message and an artifact canvas that pushed the direction action below the fold.
2. The conversation renderer was corrected to show the actual brief objective. Sources, older messages, and detailed execution remain available through explicit disclosure controls.
3. The artifact viewport was tightened so the canvas, three direction choices, rationale, and primary action share the first desktop screen.
4. A deck-specific fit-to-canvas renderer was added with `ResizeObserver`; wide deck HTML now scales proportionally instead of clipping or creating horizontal overflow.
5. Final exact-size comparison and compact breakpoint check found no remaining P0, P1, or P2 visual defects.

## Functional checks

- Home prompt creates the brief, navigates to the Studio, and starts the run through `runTask`.
- Conversation remains in the Studio instead of moving into a separate global transcript panel.
- Live execution uses the process feed; terminal execution is persisted as a collapsed run summary above the final response.
- Direction cards update `aria-pressed`; the adoption action enables only after a direction is selected.
- Preview and Code modes both render and switch correctly.
- Composer accepts follow-up text and Enter submission; Shift+Enter remains available for line breaks.
- Active computation exposes a run-scoped Stop action; awaiting-user state removes computation motion and keeps the composer available.
- Edit, Critique, and Deliver remain lifecycle-gated. Deliver stays disabled until critique passes.
- Browser console: 0 errors on a fresh final-load capture.
- Body overflow at `1024 x 768`: no horizontal page overflow.

## Visual and accessibility audit

- Hierarchy: one compact lifecycle header, one persistent conversation rail, one dominant artifact surface.
- Density: secondary sources and older messages are folded; no permanent inspector or kitchen-sink card stack.
- Content visibility: no content depends on an entrance animation; empty and waiting states are visible by default.
- Alignment: header, canvas controls, direction cards, and adoption action share stable axes; parallel cards reserve consistent roles.
- Clipping: deck HTML is scaled into the surviving canvas region; no live controls or labels are cut by containers.
- Contrast: copy and controls keep the existing SubAgents dark-theme token contrast.
- Motion: only meaningful progress indicators remain; waiting-for-user has no spinner.
- Controls: visible tabs, direction cards, composer, Preview/Code, and Stop have real behavior and accessible labels/states.
- Anti-slop recheck: no gradients, glows, floating cards, hover lift, fake window chrome, decorative pills, entrance-gated content, or invented assets were added. Existing product tokens and iconography were preserved.

## Intentional differences from the visual target

- Three direction choices are shown because the product contract caps generated directions at 2-3.
- Sources and references are folded to keep the interface clean; they remain available in the conversation rail.
- Open/Download are not exposed during Direction because delivery actions remain locked behind Build and Critique.
- The artifact shown in QA is a real bundled Open Design deck, not a recreated placeholder.

## Verification

- `npm run build` - passed
- `npx oxlint` - passed (existing repository warnings only in the broad run)
- `npm run smoke` - passed
- `smoke-subdesign-studio.mts` - 9 tests passed
- `git diff --check` - passed

Final severity count: **P0 0 · P1 0 · P2 0**

---

# Design QA — collapsible conversation activities

## Source visual truth

- `/var/folders/88/v618v0vj3cjc6rqvm4yyr0p40000gn/T/codex-clipboard-f697a375-ff68-4d90-9a77-40bf8c8e0ee4.png`
- Source pixels: 1482 × 1544. The reference is a long Codex Desktop conversation capture; its gray activity rows are the behavior and visual target.

## Rendered implementation

- Collapsed: `.scratch/visual-qa/timeline-groups-collapsed.png`
- Expanded: `.scratch/visual-qa/timeline-groups-expanded.png`
- Combined source/state comparison: `.scratch/visual-qa/timeline-group-comparison.png`
- Browser viewport: 1280 × 720 CSS px; DPR 2. Browser captures are normalized to 1280 × 720 pixels by the in-app capture API.
- Comparison normalization: collapsed and expanded captures were each scaled to 741 px wide and placed together beneath the 1482 px-wide source.

## State and interaction coverage

- Default collapsed state shows `已查看 3 項` and `執行了 2 個指令`.
- Clicking `已查看 3 項` changes `aria-expanded` from `false` to `true` and reveals exactly three original tool rows in Turn Record order.
- Assistant prose remains a hard boundary, so read and command groups stay separate.
- Browser console errors checked: none.

## Full-view and focused comparison

- Full view: the implementation keeps white narration and gray activity summaries interleaved like the source, without turning activities into a separate panel.
- Focused activity region: the collapsed line uses the existing AgentStudio icon, muted color, text density, and chevron treatment. The expanded state adds a quiet left rule and preserves the original per-tool rows and intrinsic-width path chips.

## Required fidelity surfaces

- Fonts and typography: existing Inter and JetBrains Mono hierarchy retained; gray activity summaries use the product's 12 px secondary text treatment.
- Spacing and layout rhythm: summaries occupy one compact row; expanded children use the existing row rhythm with a 20 px indentation.
- Colors and tokens: existing `text-ink-3`, `border-stroke`, failure red, and background tokens retained.
- Image and icon fidelity: no new raster assets were needed; the existing Material Symbols Outlined icon set matches the product and source behavior.
- Copy and content: counts use Traditional Chinese labels tied to semantic activity type; original titles and details remain visible after expansion.

## Findings and comparison history

- No actionable P0, P1, or P2 mismatch remains.
- Initial implementation behavior already passed the first comparison: adjacent activities of the same semantic kind collapse, while prose, different kinds, pending state, and failures create boundaries.
- P3: the source capture uses larger apparent typography than the existing AgentStudio density. Existing product typography was intentionally preserved.

final result: passed
