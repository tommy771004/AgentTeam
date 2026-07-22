# Follow Pi's full-trust extension model

SubAgents AI will follow Pi's extension execution model: enabled extensions execute as trusted local application code with the host process's filesystem, process, network, environment, and credential authority. We accept the simpler, upstream-compatible extension contract instead of creating a second sandboxed extension ABI; installation and enablement therefore remain explicit user trust decisions, and the UI must not describe extensions as isolated or permission-limited.
