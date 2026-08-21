export type ProviderAttachmentPayload = {
  kind: 'screenshot' | 'trace' | 'replay'
  extension: 'png' | 'json'
  content: Uint8Array
  name?: string
}
