# API provider settings design QA

- Source visual truth: `/Users/xieyuanyou/Desktop/截圖 2026-07-12 下午5.48.07.png`
- Implementation screenshots:
  - `/var/folders/88/v618v0vj3cjc6rqvm4yyr0p40000gn/T/subagents-aihubmix-settings.png`
  - `/var/folders/88/v618v0vj3cjc6rqvm4yyr0p40000gn/T/subagents-aihubmix-fallback-settings.png`
- Full-view comparison evidence: `/private/tmp/subagents-aihubmix-settings-comparison.png` — the supplied screenshot and the rendered settings page were placed side by side in one comparison image.
- Viewport: desktop browser preview, 1280 × 720.
- State: Settings → 語言模型, with the AIHubMix preset selected. API key remains empty; no secret was entered or transmitted.
- Primary interactions tested: selected AIHubMix from the API provider dropdown; verified Base URL changes to `https://aihubmix.com/v1`, default model changes to `gpt-4.1-mini-free`, and the three backup model choices appear.
- Console errors checked: none.

## Full-view and focused comparison

The supplied screen establishes a dark, dense OpenAI-compatible model-settings form with a single connection card. The implementation keeps the same dark setting surface, input hierarchy, rounded controls, and vertical form rhythm, while adding a compact provider preset selector above the original connection controls. The focused lower-region capture confirms that fallback models are presented as one editable field plus small direct-switch buttons, rather than creating a second full card.

The surrounding application navigation and the browser-preview banner are product-specific context, not part of the supplied form target. The supplied screenshot predates provider presets, so the provider selector and the no-channel explanation are intentional product additions.

## Fidelity surfaces

- **Fonts and typography:** Existing product type scale remains: a prominent page title, compact setting labels, and smaller muted helper text. The fallback note is readable without competing with the API key and model fields.
- **Spacing and layout rhythm:** The new selector is the first row in the existing connection group. It uses the same input width, section borders, padding, and radius as the supplied configuration controls.
- **Colors and visual tokens:** Dark surfaces, subtle borders, muted metadata, cyan actions, and error/success semantics use the existing application tokens. The fallback note is deliberately neutral rather than an alarming error state.
- **Image quality and asset fidelity:** The target is a controls-only screen; no logos, illustrations, or custom image assets were added or substituted.
- **Copy and content:** The title now names AIHubMix, OpenAI, OpenRouter, and other OpenAI-compatible APIs. It explicitly states that fallback retries happen only for `no_available_channel`, so authentication, quota, and schema errors remain visible.

## Findings and comparison history

1. [P1, fixed] The supplied AIHubMix configuration could only surface the raw `no_available_channel` error. The implementation now gives AIHubMix a supported endpoint, a safer default model, and ordered fallback models.
2. [P1, fixed] Selecting a provider previously required manually changing every field. The provider dropdown now applies a matching base URL, model, and fallback set in one interaction.
3. [P2, fixed] The user could not distinguish transient router failure from credential or request failures. The visible helper text and runtime retry policy restrict automatic retries to the transient router condition.

No actionable P0/P1/P2 visual differences remain. The real provider request was intentionally not tested because no API key was supplied; the Electron request path is covered by TypeScript build and smoke tests.

## Implementation checklist

- [x] Keep the original OpenAI-compatible Base URL, API key, and model fields.
- [x] Add AIHubMix, OpenAI, OpenRouter, and manual-compatible provider choices.
- [x] Apply AIHubMix endpoint and recommended defaults from a single selection.
- [x] Add ordered fallback models for transient no-channel responses only.
- [x] Verify rendered selector behavior, fallback controls, console health, build, and smoke tests.

## Follow-up polish

- [P3] With a user-provided non-production key, run the Electron connection check against the current AIHubMix routing state; no key was entered during QA.

final result: passed

---

# SubDesign Open Design entry-view QA

- Source visual truth: `/private/tmp/open-design-source/docs/screenshots/01-entry-view.png`.
- Implementation screenshot: `/private/tmp/subdesign-open-design-entry-implementation.png`.
- Viewport: 1024 × 768.
- State: `#/subdesign`, initial Product prototype selection, High fidelity selected, no brief entered.
- Primary interactions tested: selected 資料儀表板, selected Wireframe, entered a brief, clicked Create, and verified that a `SubDesign · 資料儀表板` Plan thread was created with the brief and fidelity in the composer draft.
- Console errors checked: none.

## Full-view and focused comparison

The reference and implementation were opened as rendered images at the same 1024 × 768 desktop viewport. The SubDesign work area follows the reference's compact left creation rail, small top-level tabs, warm off-white canvas, fine dividers, restrained radius, low-saturation orange action, and project-thumbnail workspace. The host product's dark global navigation and desktop chrome remain intentionally outside the copied workbench surface.

## Fidelity surfaces

- **Fonts and typography:** compact product type and small uppercase workspace metadata match the reference's quiet hierarchy; no display hero remains.
- **Spacing and layout rhythm:** the creation rail, 53px top bar, narrow gaps, thin rules, and content-first empty space match the reference's IDE density.
- **Colors and visual tokens:** the SubDesign canvas uses warm whites and grey dividers with a single terracotta action color; the surrounding application keeps its existing dark chrome.
- **Image quality and asset fidelity:** the reference uses a controls-only workspace; the implementation uses the existing Material icon set, not substitute illustrations or generated art.
- **Copy and content:** Open Design labels are adapted to SubDesign's four actual task surfaces and its existing Plan/HITL workflow.

## Findings and comparison history

1. [P2, fixed] The initial implementation imposed a 900px inner workbench and showed a horizontal scrollbar at the reference 1024px viewport. The workbench minimum width is now 720px and its card grid becomes three columns at this viewport; the final rendered view has no horizontal overflow.

No actionable P0/P1/P2 visual differences remain for the selected reference direction. The dark host sidebar is an intentional integration constraint rather than a discrepancy in the SubDesign workbench.

## Implementation checklist

- [x] Replace the hero/card landing page with an IDE-style two-column workbench.
- [x] Keep surface selection, brief entry, fidelity selection, and task creation interactive.
- [x] Verify 1024 × 768 rendering, primary interaction flow, and console health.

## Follow-up polish

- [P3] If the global application navigation is redesigned later, provide an optional light shell theme so the outer chrome can match the Open Design reference end-to-end.

final result: passed
