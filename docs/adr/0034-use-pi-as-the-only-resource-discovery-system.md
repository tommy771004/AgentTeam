# Use Pi as the only resource discovery system

Pi's resource loader and package discovery are the sole entry points for skills, prompts, extensions, and packages. MCP integrations are native Pi extensions and Marketplace installs Pi-compatible packages; legacy Hermes discovery and loading are removed after their persisted resources have been migrated and parity-checked, rather than retained as a second discovery system with conflicting names, precedence, and reload behavior.
