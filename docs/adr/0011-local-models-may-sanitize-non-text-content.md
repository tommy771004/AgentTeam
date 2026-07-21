---
status: accepted
---

# Company classifiers may identify non-text content for deterministic sanitization

Company Base Policy may authorize a Company Classification Endpoint to semantically classify content extracted by a local format-aware parser. Image inspection remains disabled by default and requires an explicit vision capability; when enabled, the endpoint returns protected regions while deterministic local code performs masking and creates a derivative. The classifier cannot weaken another detector, and only successfully rebuilt and verified derivatives may enter a provider-specific Sanitized Workspace. If the endpoint is absent or unavailable, baseline inspection continues and unsupported content remains excluded rather than stopping the service.

The first implementation does not reconstruct PDF, DOCX, XLSX, or PPTX binaries. Local adapters extract safe structure, classification removes protected locations, and the system emits a Markdown or JSON Sanitized Sidecar that the AI can read without access to the original document. Images may produce masked derivatives when vision is authorized. ZIP, SQLite, unknown binaries, and formats without a trusted adapter remain unavailable to AI runners until a dedicated contract exists.
