/**
 * Qualification-only record of the renderer tools removed when Pi Core Host
 * became the production owner. Nothing under electron/ or src/ imports this
 * file: it describes the old call shape solely so parity tests can translate
 * historical fixtures without restoring a live renderer catalog.
 */
export type PiLegacyToolTranslation = {
  legacyTool: string
  hostTool: string
  hostMethod: `tools/${string}`
  parameterRenames: Readonly<Record<string, string>>
  defaultMaterialization: Readonly<Record<string, unknown>>
  semanticTranslation: readonly string[]
}

export const PI_LEGACY_TOOL_TRANSLATIONS: readonly PiLegacyToolTranslation[] = [
  {
    legacyTool: 'workspace_read',
    hostTool: 'read',
    hostMethod: 'tools/read',
    parameterRenames: {},
    defaultMaterialization: {},
    semanticTranslation: ['Pi content parts replace the renderer path/content result envelope.'],
  },
  {
    legacyTool: 'workspace_list',
    hostTool: 'ls',
    hostMethod: 'tools/ls',
    parameterRenames: {},
    defaultMaterialization: { path: '.' },
    semanticTranslation: ['Pi returns a formatted directory listing instead of the renderer entry array.'],
  },
  {
    legacyTool: 'workspace_grep',
    hostTool: 'grep',
    hostMethod: 'tools/grep',
    parameterRenames: { query: 'pattern', maxResults: 'limit' },
    defaultMaterialization: { path: '.', ignoreCase: true, limit: 100 },
    semanticTranslation: [
      'Legacy query is a case-insensitive regular expression; Pi receives pattern plus ignoreCase=true.',
      'Legacy maxResults is translated to Pi limit.',
      'Pi formatted matches replace the renderer structured match array.',
    ],
  },
  {
    legacyTool: 'workspace_glob',
    hostTool: 'find',
    hostMethod: 'tools/find',
    parameterRenames: { maxResults: 'limit' },
    defaultMaterialization: { path: '.', limit: 200 },
    semanticTranslation: ['Pi formatted paths replace the renderer path array.'],
  },
  {
    legacyTool: 'workspace_write',
    hostTool: 'write',
    hostMethod: 'tools/write',
    parameterRenames: {},
    defaultMaterialization: {},
    semanticTranslation: ['Pi content parts replace the renderer mutation result envelope.'],
  },
  {
    legacyTool: 'bash',
    hostTool: 'bash',
    hostMethod: 'tools/bash',
    parameterRenames: { timeoutMs: 'timeout' },
    defaultMaterialization: {},
    semanticTranslation: ['Legacy timeout milliseconds are converted to Pi timeout seconds.'],
  },
] as const

/** Translate a historical renderer call without consulting live definitions. */
export function translateLegacyPiToolCall(
  legacyTool: string,
  input: Readonly<Record<string, unknown>>,
): { translation: PiLegacyToolTranslation; arguments: Record<string, unknown> } {
  const translation = PI_LEGACY_TOOL_TRANSLATIONS.find((entry) => entry.legacyTool === legacyTool)
  if (!translation) throw new Error(`No Pi legacy translation fixture for ${legacyTool}`)
  const arguments_: Record<string, unknown> = { ...translation.defaultMaterialization }
  for (const [name, value] of Object.entries(input)) {
    const target = translation.parameterRenames[name] || name
    // A same-name entry documents no translation and is therefore forbidden.
    if (translation.parameterRenames[name] === name) {
      throw new Error(`Same-name parameter ${name} must not be recorded as a rename`)
    }
    arguments_[target] = name === 'timeoutMs' && target === 'timeout' && typeof value === 'number'
      ? value / 1_000
      : value
  }
  return { translation, arguments: arguments_ }
}
