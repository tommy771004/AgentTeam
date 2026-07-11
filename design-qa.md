# Persisted execution-summary design QA

- Source visual truth: `/Users/xieyuanyou/Desktop/截圖 2026-07-11 晚上9.19.14.png`
- Implementation screenshot: `/var/folders/88/v618v0vj3cjc6rqvm4yyr0p40000gn/T/subagents-persisted-execution-summary.png`
- Viewport: desktop browser preview, 1280 × 720.
- State: completed agent run, long assistant answer collapsed, saved execution-summary cards collapsed.
- Interactions tested: completion creates a saved summary; summary expands to show operations; long assistant output expands; browser console contains no errors.

## Full-view and focused comparison

The source places the final answer first and a concise, expandable file/action record directly below it. The implementation follows this order: assistant content stays in the normal conversation flow, while each completed run appends one independent summary card. The focused comparison covers the answer-to-summary transition and the card's collapsed/expanded states; surrounding navigation is product-specific and outside the supplied target.

## Fidelity surfaces

- **Fonts and typography:** The assistant answer keeps the product's readable message typography; execution cards use smaller, mono-style metadata and a clear 13px summary title.
- **Spacing and layout rhythm:** The summary is a single rounded card with a compact header, mirroring the reference's dense change summary. Detail rows are only introduced after expansion.
- **Colors and visual tokens:** Existing dark surface, subdued borders, primary additions, and error removals preserve the reference's low-noise dark contrast.
- **Image quality and asset fidelity:** Neither target state relies on custom raster imagery. Existing icon-library symbols are used for actions and files.
- **Copy and content:** Persistent cards state only operation count, duration, and file count; command text and paths are hidden until the user asks to view them.

## Findings and comparison history

1. [P1, fixed] The prior process feed was ephemeral and vanished after reloading a thread. Completion now writes a compact `run` bubble into the thread beside the final answer.
2. [P1, fixed] The prior UI exposed all tool rows in the conversation. It now collapses the entire run by default, with independent disclosure for command detail and file lists.
3. [P2, fixed] The previous feed appeared before the final assistant response. Persisted summaries now render after the response, matching the requested answer-then-work-record hierarchy.

No actionable P0/P1/P2 differences remain. The reference shows a richer native environment panel and literal diff counts; this product intentionally focuses the conversation card on the runner's available tool and file events.

## Implementation checklist

- [x] Capture streamed CLI operations and file changes.
- [x] Persist the compact summary in the thread.
- [x] Render the summary below the assistant result.
- [x] Support collapsed summary, expanded operation details, file list, and long-answer disclosure.
- [x] Verify the completed state, interaction behavior, and console health.

## Follow-up polish

- [P3] In Electron with a real authorized CLI, validate vendor-specific diff counts where the CLI reports additions and deletions.

final result: passed
