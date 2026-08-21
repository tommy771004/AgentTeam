/**
 * The one list of SubDesign metadata kinds.
 *
 * Deliberately free of DOM and Node APIs: the renderer (metadata.ts), the
 * preload bridge, and the Electron main process all import it, so a new kind
 * is a single edit rather than four parallel unions drifting apart.
 */
export const SUBDESIGN_METADATA_KINDS = [
  'brief',
  'artifact',
  'critique',
  'export',
  'open-design-pack',
  'open-design-snapshot',
  'open-design-provider-settings',
  'open-design-provider-run',
] as const

export type SubDesignMetadataKind = (typeof SUBDESIGN_METADATA_KINDS)[number]

export function isSubDesignMetadataKind(value: unknown): value is SubDesignMetadataKind {
  return SUBDESIGN_METADATA_KINDS.includes(value as SubDesignMetadataKind)
}
