---
status: accepted
---

# Use sanitized sidecars for PDF and Office documents

The first non-text implementation parses PDF, DOCX, XLSX, and PPTX locally, applies deterministic and optional company-endpoint classification, and emits a structured Markdown or JSON Sanitized Sidecar rather than rebuilding the original binary. AI runners see only the sidecar, cannot overwrite the source document, and may create a separate textual result. Images can enter the Sanitized Workspace only as policy-authorized masked derivatives; archives, databases, unknown binaries, and formats without trusted adapters remain unavailable until a dedicated adapter and locator contract is added.
