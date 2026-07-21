---
status: accepted
---

# Company policy fails closed at AI egress

The deployment setting `SUBAGENTS_OUTBOUND_GUARD` establishes the organization posture: `required` forces inspection and cannot be disabled in the UI, `optional` lets the UI setting determine whether inspection is active, `demo` exercises sanitization without company assurance, and `off` disables inspection. Runtime derives one effective mode from deployment plus UI state, and only an effective `off` may bypass the Outbound Data Gate. Demo may use a loopback classifier before sending sanitized content to any configured external LLM or CLI; if that classifier is unavailable it continues with deterministic baseline inspection and displays the degraded state. When protection is active and a provider profile is missing, the security layer creates and executes an independent baseline profile before continuing. If no valid baseline can be established or executed under mandatory protection, SubAgents AI remains open for diagnosis and local use but blocks outbound LLM and external CLI requests. This preserves a fail-closed confidentiality boundary without making the entire desktop application unavailable.
