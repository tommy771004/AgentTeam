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

---

# Task timeline diff disclosure - Design QA

Reviewed: 2026-08-28

## Visual comparison

- Source visual truth: `/var/folders/88/v618v0vj3cjc6rqvm4yyr0p40000gn/T/codex-clipboard-e60d883c-b675-4b6e-b7e8-ccbf4ef94f5a.png` (`2296 x 268`) and `/var/folders/88/v618v0vj3cjc6rqvm4yyr0p40000gn/T/codex-clipboard-7a89bcae-4902-4844-ab9e-6f0967339c40.png` (`1496 x 428`).
- Browser-rendered implementation: `.scratch/design-qa-inline-diff.png` (`953 x 887`) and `.scratch/design-qa-summary-diff.png` (`953 x 887`).
- Viewport: `1280 x 720` CSS pixels, device scale factor 1. Focused component crops were compared at native density; the references are examples with different crops rather than pixel-identical full-screen mocks.
- State: dark theme; one successful edit row expanded; terminal run summary expanded; changed-files card and Git diff expanded.
- Full-view evidence: the task row, completion summary, changed-files list, disclosure actions, and diff remain inside their existing conversation width with no horizontal page overflow.
- Focused evidence: both source/implementation pairs were opened together. The line-number gutter, red removal tint, green addition tint, monospaced code, file counts, per-file stats, three-file preview, and “顯示另外 N 個檔案” disclosure are visible. Focused comparison was required because the diff text is not legible in the full-page capture.

## Comparison history

1. The initial implementation increased the completion renderer and timeline merge complexity beyond the repository gate.
2. The changed-files/diff area was extracted into one component, and tool-row merging into a bounded projection helper. The production build then passed.
3. Browser interaction verified both diff disclosures, the additional-files disclosure, and all four fixture paths. Console errors: 0.
4. Follow-up comparison removed unified-patch metadata (`---`, `+++`, and `@@`) from both disclosures while retaining it internally for line-number calculation. A fresh DOM check found no metadata noise and did find the expected source lines.
5. The completion area initially nested the changed-files card inside an expanded execution card, repeating the file count and adding two borders. The changed-files card is now a standalone sibling after the assistant answer; when no plan, operations, agents, or SubDesign details exist, the empty execution wrapper is omitted entirely.

## Findings

- No actionable P0/P1/P2 differences remain. The references use a larger screenshot crop and richer language syntax colors; the implementation intentionally preserves AgentStudio's existing 11–12px timeline typography and semantic red/green diff tokens.
- Fonts and typography: existing UI and mono families, weights, and compact hierarchy are preserved; code lines do not wrap.
- Spacing and layout rhythm: the inline diff remains nested under its action; the final file list and Git diff share one bordered card directly below the assistant answer. There is no redundant execution-card shell in the files-only state.
- Colors and visual tokens: existing surface, line, accent, red, green, and tint tokens are used; no new palette or gradient was introduced.
- Image quality and assets: this flow contains no raster imagery; icons come from the existing `Icon` system.
- Copy and content: “已編輯 N 個檔案”, “查看 diff”, and “顯示另外 N 個檔案” describe their states directly. The rendered diff contains only source context and changed lines, not patch transport metadata.

## Primary interactions tested

- Expand and collapse one durable edit-row diff.
- Expand the terminal run summary.
- Expand the integrated changed-files/Git-diff card.
- Reveal the files beyond the first three.
- Confirm line-numbered add/remove rendering, absence of `---` / `+++` / `@@` metadata, and zero browser console errors.
- Confirm DOM order is assistant answer → changed-files card, and that the files-only fixture contains no “執行過程” wrapper.

## Follow-up polish

- P3: language-aware token highlighting could be added later if the product adopts a shared code highlighter; it is not required to understand the diff.

final result: passed
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

---

# Design QA — 本機技能庫

## Source visual truth

- `/var/folders/88/v618v0vj3cjc6rqvm4yyr0p40000gn/T/codex-clipboard-5f64fc1f-8fab-4233-a348-2e4cb180a4c4.png`
- Source pixels: 2228 × 1854. Target state: dark desktop Skill browser with search, compact two-column installed rows, bounded initial results, and source/scope navigation.

## Rendered implementation

- Desktop: `.scratch/skill-library-audit/09-implemented-font-ready.png`
- Selected detail: `.scratch/skill-library-audit/05-implemented-detail.png`
- Compact breakpoint: `.scratch/skill-library-audit/06-implemented-narrow.png`
- Desktop browser viewport/capture: 1280 × 720 CSS px / 1280 × 720 pixels. Compact check: 380 × 800 CSS px / 380 × 800 pixels.
- State: dark theme; plain-browser preview contains two representative managed skills. Host-side qualification separately projects 32 installed local skills across AgentStudio, user, and system sources.

## Full-view and focused comparison

- Full view: reference and implementation share the same title/subtitle hierarchy, prominent rounded search, quiet「已安裝」heading, borderless two-column rows, one-line descriptions, trailing status icons, and source tabs.
- Focused interaction: selecting a row exposes source, scope, path, management actions, and a collapsed `SKILL.md` disclosure without making raw Markdown dominate the browsing screen.
- App chrome is intentionally retained because this is an existing AgentStudio route; the source is a page-only crop.

## Findings and comparison history

1. Initial P1: the first implementation placed source tabs before the installed summary and would render every local skill at once. This diverged from the reference and scaled poorly at the verified 32-item catalog.
   - Fix: installed results now appear first, default to six rows, expose `查看另外 N 項`, and place source/scope tabs after that summary.
   - Post-fix evidence: `.scratch/skill-library-audit/09-implemented-font-ready.png`; no remaining P0/P1/P2 mismatch.
2. The initial reload capture briefly showed Material Symbol names before the font finished loading. This was capture timing rather than product layout drift.
   - Fix: final evidence waits for `document.fonts.ready`; browser reports 40 loaded font faces.

## Required fidelity surfaces

- Fonts and typography: existing AgentStudio type family and optical weights are retained; title, description, secondary metadata, truncation, and disclosure text preserve the reference hierarchy without introducing a competing display font.
- Spacing and layout rhythm: content uses a centered bounded column, 48 px search control, compact 2-column rows, quiet dividers, and responsive single-column collapse. The 380 px check reports `scrollWidth === clientWidth`.
- Colors and tokens: existing AgentStudio surface, outline, primary, error, and text tokens are used; selected and hover states remain low-contrast and consistent with the product shell.
- Image quality and assets: the reference contains UI icons rather than raster imagery. Existing Material Symbols are used consistently; no placeholder imagery, custom SVG, CSS art, or generated asset was introduced.
- Copy and content: `技能`, `搜尋技能`, `已安裝`, source labels, result counts, and read-only ownership are coherent in Traditional Chinese. Product name correctly remains AgentStudio.
- Accessibility: search has a programmatic label, source controls use tab semantics and `aria-selected`, rows expose listbox/option selection, read-only state has text in details, and keyboard-native buttons drive every primary interaction.

## Functional verification

- Search for `web` narrows 2 representative rows to exactly 1; clear restores both.
- Selecting `safe-export` sets the option selected and reveals its details; raw Markdown remains collapsed.
- Narrow viewport has no horizontal overflow.
- Browser console warnings/errors: 0 after the final load.
- Host catalog smoke: AgentStudio, project, user, and system installs are discovered with deterministic ownership and immutable run snapshots.

## Intentional differences / P3

- The source uses several product-specific colored skill logos; AgentStudio preserves its existing Material Symbols icon family and distinguishes source through icon and text metadata.
- The source capture omits application navigation; AgentStudio keeps its global and Learning Center navigation around the skill browser.

Final severity count: **P0 0 · P1 0 · P2 0**

final result: passed

---

# Design QA — 日誌追蹤資訊排版

## Source visual truth

- Existing AgentStudio compact key/value treatment was retained as the product reference: fixed labels, flexible values, quiet dividers, and existing dark-theme tokens.
- User requirement: 「追蹤脈絡」must read as left-side labels and right-side content; long 任務定義 must not be squeezed into a narrow sidebar.

## Rendered implementation

- Final representative capture: `.scratch/records-trace-layout-qa-final.png`
- The status and trace summary now occupy a full-width information band above the log viewer at the tested 1160 px viewport.
- At 768 px viewport, every value column measured 343 px inside a 467 px row; no horizontal overflow was present.

## Visual and interaction audit

- Hierarchy: status and retry action form one operational group; 追蹤脈絡 forms a separate structured details group; raw logs remain the dominant lower surface.
- Alignment: all three fields share a 5.5 rem label column and a `minmax(0, 1fr)` content column.
- Long content: 任務定義 uses natural wrapping with preserved line breaks and word breaking; Agent ID remains safely breakable.
- Density: subtle border, row dividers, and a low-contrast surface preserve the existing AgentStudio visual language without adding decorative cards.
- Responsive behavior: the summary stacks before its content becomes unreadable, then switches to a two-column status/context band only when sufficient width is available.
- Controls: download and retry behavior are unchanged.

## Verification

- `npx oxlint src/pages/RecordsPage.tsx` — passed
- `npx tsc -b --pretty false` — passed
- `git diff --check -- src/pages/RecordsPage.tsx` — passed
- Browser DOM and visual checks at default and 768 px viewports — passed

Final severity count: **P0 0 · P1 0 · P2 0**

final result: passed

---

# Design QA — 日誌追蹤滿版融合

## Source visual truth

- Before capture: `.scratch/records-log-shell-before.png`
- The source state shows the former bordered「執行日誌」card and its empty blue log panel.

## Rendered implementation

- Final capture: `.scratch/records-log-shell-after.png`
- Side-by-side comparison: `.scratch/records-log-shell-comparison.png`
- Viewport and capture density: 1280 × 720 CSS px, normalized to matching 1280 × 720 captures.
- State: no logs, idle agent.

## Findings and comparison history

- Initial P2: an inner bordered card repeated the page hierarchy and visually separated execution details from「日誌追蹤」.
  Fix: removed the card shell and duplicate「執行日誌」header; status and trace details now sit directly on the page surface.
- Initial P2: the no-log state reserved a large blue block for a message that did not help the user take action.
  Fix: the log viewer is not rendered until logs exist; the empty message and empty-state download action are both omitted.
- Post-fix comparison: the page has one clear heading, no nested frame, and no artificial empty region. Existing status, retry, trace details, and conditional log/download functionality remain available.

## Required fidelity surfaces

- Typography: existing AgentStudio sizes, weights, and line heights are unchanged.
- Spacing and layout: content aligns to the page grid; the former inset card padding and redundant header row are removed.
- Colors and tokens: existing surface, divider, state, and text tokens are retained; no new color treatment was introduced.
- Assets and icons: existing Material Symbols remain; no new imagery or replacement assets were needed.
- Copy and content: redundant「執行日誌」and the low-value empty-state sentence are absent; operational copy remains unchanged.

## Verification

- Empty-state DOM: duplicate title 0, empty message 0, empty download action 0.
- Browser console errors: 0.
- `npx oxlint src/pages/RecordsPage.tsx` — passed.
- `npx tsc -b --pretty false` — passed.
- `git diff --check -- src/pages/RecordsPage.tsx` — passed.

Final severity count: **P0 0 · P1 0 · P2 0**

final result: passed
