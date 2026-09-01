# ADR-0055: Inline attended decisions without deadlines

## Status

Accepted

## Context

An attended agent run can pause for an `ask_user` answer or a tool approval. The previous renderer used one global modal and both the renderer and Pi Host independently auto-denied after 90 seconds. This interrupted the conversation, hid which task owned the request, created head-of-line blocking between concurrent threads, and could reject a request while the user was still reading it.

Unattended work has a different safety requirement. It must never wait for a person who is not present and must remain fail-closed.

## Decision

- Attended requests are shown inline immediately above the owning task's composer.
- The request remains pending until the user chooses, or until the owning run is cancelled or settles.
- Requests are selected by `threadId` and resolved by request identity, so one thread cannot block another thread's visible decision.
- Pi Host remains the approval authority. A wire `timeoutMs` value of `0` means an attended request has no countdown.
- Host resolution is projected back to the renderer so cancelled or terminal runs remove stale inline requests.
- Unattended requests continue to deny fail-closed without presenting interactive UI.

## Consequences

- Switching conversations hides and restores each conversation's own pending request without changing its order.
- Escape, route changes, and component unmounts do not silently deny a request.
- A crashed renderer can reconstruct the pending request from the Host attachment journal.
- ADR-0003's earlier choice to keep a single FIFO modal is superseded for presentation and request selection. Its run/thread identity requirements remain in force.
