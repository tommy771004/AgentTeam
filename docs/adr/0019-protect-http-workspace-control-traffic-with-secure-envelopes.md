---
status: accepted
---

# Protect HTTP Workspace control traffic with secure envelopes

Workspace control plane may use HTTPS/mTLS or policy-approved HTTP, but HTTP never carries plaintext control data. A server public key provisioned outside that connection and a per-device key pair protect enrollment, authentication material, evidence HMAC keys, Policy Bundles, and incremental evidence through a standard authenticated-encryption envelope with replay protection. The full endpoint is pinned, redirects are refused, and prompts, agents, provider supplements, and HTTP responses cannot change the pinned key or transport mode. Failure to authenticate or decrypt an envelope follows cached-policy behavior rather than falling back to plaintext.

Electron main reads rotatable trust anchors from `SUBAGENTS_WORKSPACE_PUBLIC_KEYS` at startup as key-ID/public-key pairs. Overlapping old and new keys support staged rotation; renderer code, settings, policies, and server responses cannot edit the list. Policy-approved HTTP Workspace mode is unavailable when the list is empty, while HTTPS mode does not require the application-layer key list.
