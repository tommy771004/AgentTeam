# Use a versioned Pi Host Protocol

Renderer, Electron main, and Pi Core Host communicate through a versioned, capability-negotiated request/event protocol with generated TypeScript types. The protocol gives initialization, durable sessions, Task runs, Pi turns, streamed items, approvals, settings, steering, and cancellation distinct identities and schemas, avoiding ad hoc IPC handlers and preventing Pi Core implementation classes from becoming desktop API contracts.
