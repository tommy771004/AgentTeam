---
status: accepted
---

# Pin the company classifier origin without requiring TLS

Company Base Policy pins the classification endpoint's complete URL, including scheme, host, port, and path, and the client refuses redirects so candidate data cannot be forwarded elsewhere. The client posts the structured classification request directly to that URL (for example `http://1.2.3.4:1234/v1`) and never appends `/classify` or another route. HTTPS is recommended but not mandatory: policy may explicitly authorize plaintext HTTP for company infrastructure, in which case evidence records it as `company-approved plaintext` and never claims transport encryption. Prompts, agents, and provider supplements cannot change the endpoint or relax these transport constraints.

Endpoint authentication is independently optional. With no `auth` configuration the client sends no credentials; when company policy configures `bearer`, `custom-header`, or `mtls`, the JSON stores only a credential reference resolved by Electron main, and authentication failure never falls back to an unauthenticated request. Explicitly configured `none` and omitted `auth` are both unauthenticated states for evidence purposes.

Each classification batch permits at most three total attempts. Only timeouts, network failures, HTTP 429, and HTTP 5xx are retried with short backoff; HTTP 4xx, authentication failures, and invalid structured responses fail immediately. After the allowed attempts, the run continues with company rules and deterministic baseline inspection. Evidence records attempt count, status, and error class without request content.

Every structured classification request carries its workspace ID when applicable and Managed Device ID, but still contains only one source and one chunk so returned format-specific locations cannot cross source boundaries.
