# Preserve Loop Patterns as Pi orchestration

Turn-based, Goal-based, Time-based, and Proactive remain SubAgents product semantics implemented by a trusted Orchestration Extension, while Pi Core exclusively executes agent turns and tool loops. Each SubAgents thread owns a durable Pi session and each Task run applies `runId`, trigger evidence, completion criteria, and multi-turn orchestration over that session; `taskRunCoordinator` remains a thin Electron-host ingress rather than a competing execution engine.
