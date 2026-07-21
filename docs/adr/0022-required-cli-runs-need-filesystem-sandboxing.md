---
status: accepted
---

# Required CLI runs need filesystem sandboxing

A Sanitized Workspace changes what appears under the runner's working directory but cannot stop an ordinary host process from opening the original project or another absolute path. Under `required` guard, an external CLI therefore runs only inside a verified filesystem sandbox that exposes the provider-specific Sanitized Workspace and necessary runtime paths while denying the real project, home, external symlink targets, and unrelated device paths. If verified isolation is unavailable, external CLI execution is unavailable but sanitized direct-LLM requests may continue. Demo and optional modes may run without verified filesystem isolation only when UI and evidence report that limitation.
