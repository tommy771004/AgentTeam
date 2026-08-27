/**
 * Shared OpenAI-compatible tool shape used by capability/catalog projections.
 */

export interface OpenAiToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}
