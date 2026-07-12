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
