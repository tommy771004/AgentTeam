/**
 * Built-in capability ids — closed union for tool ownership type-checks.
 * Dynamic skill/mcp capability ids remain open strings on AgentCapability.id.
 */
export type BuiltinCapabilityId =
  | 'interaction'
  | 'planning'
  | 'core-utils'
  | 'web-research'
  | 'workspace'
  | 'shell'
  | 'monitoring'
  | 'memory'
  | 'skills'
  | 'codegraph'
  | 'delegate'
  | 'messaging'
  | 'code-mode'
  | 'mcp-bridge'
  | 'subdesign-workflow'
  | 'design-critique'
