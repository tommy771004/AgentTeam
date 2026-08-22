import type { SubDesignArtifact } from './types.ts'
import type { RendererCapabilities } from './streamingEnvelope.ts'

const HTML_PREVIEW_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"

export const ARTIFACT_RENDERER_CAPABILITIES: Record<SubDesignArtifact['renderer'], RendererCapabilities> = {
  html: { supportedKinds: ['html'], streaming: true, sandbox: HTML_PREVIEW_CSP, export: ['html', 'pdf', 'zip'] },
  'deck-html': { supportedKinds: ['deck'], streaming: false, sandbox: HTML_PREVIEW_CSP, export: ['pptx', 'pdf'] },
  markdown: { supportedKinds: ['markdown-document'], streaming: true, sandbox: "default-src 'none';", export: ['md'] },
  svg: { supportedKinds: ['svg'], streaming: false, sandbox: "default-src 'none';", export: ['svg'] },
  code: { supportedKinds: ['react-component'], streaming: false, sandbox: "default-src 'none';", export: ['jsx'] },
}

export function withPreviewCsp(content: string, renderer: SubDesignArtifact['renderer']): string {
  const policy = ARTIFACT_RENDERER_CAPABILITIES[renderer].sandbox
  const csp = `<meta http-equiv="Content-Security-Policy" content="${policy}">`
  if (/<head(?:\s[^>]*)?>/i.test(content)) return content.replace(/<head(\s[^>]*)?>/i, (head) => `${head}${csp}`)
  if (/<html(?:\s[^>]*)?>/i.test(content)) return content.replace(/<html(\s[^>]*)?>/i, (html) => `${html}<head>${csp}</head>`)
  return `<!doctype html><html><head>${csp}</head><body>${content}</body></html>`
}

export function isArtifactExportEligible(renderer: SubDesignArtifact['renderer'], format: string): boolean {
  return ARTIFACT_RENDERER_CAPABILITIES[renderer].export?.includes(format) === true
}
