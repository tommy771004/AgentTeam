/**
 * Policy-authorized image vision and deterministic local masking.
 * External AI only receives masked derivatives; originals never enter the view.
 */

import type { CompanyBasePolicy } from './policySchema.ts'
import type { ProviderSecurityProfile } from './policyMerge.ts'

export type BoundingBox = {
  /** Normalized 0..1 inclusive of top-left origin */
  x: number
  y: number
  w: number
  h: number
}

export type ImageVisionAuth =
  | { authorized: false; reason: string }
  | { authorized: true; endpointUrl: string }

/** Only Company Base Policy may authorize vision — never user settings or supplement alone. */
export function resolveImageVisionAuth(
  companyBase: CompanyBasePolicy,
  _profile?: ProviderSecurityProfile,
): ImageVisionAuth {
  void _profile // profile visionAuthorization is copy of base only; never trust supplement
  const auth = companyBase.visionAuthorization
  if (auth?.enabled === true && String(auth.endpointUrl || '').trim()) {
    return { authorized: true, endpointUrl: auth.endpointUrl.trim() }
  }
  return {
    authorized: false,
    reason: 'Image vision not authorized by Company Base Policy (deny-by-default).',
  }
}

export function validateBoundingBoxes(
  boxes: unknown,
  opts?: { maxBoxes?: number },
): BoundingBox[] | null {
  if (!Array.isArray(boxes)) return null
  const max = opts?.maxBoxes ?? 32
  if (boxes.length > max) return null
  const out: BoundingBox[] = []
  for (const b of boxes) {
    if (!b || typeof b !== 'object') return null
    const o = b as Record<string, unknown>
    const x = Number(o.x)
    const y = Number(o.y)
    const w = Number(o.w)
    const h = Number(o.h)
    if (![x, y, w, h].every((n) => Number.isFinite(n))) return null
    // Strict: no clamping to "fix" invalid boxes — reject entire response
    if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1 + 1e-9 || y + h > 1 + 1e-9) {
      return null
    }
    out.push({ x, y, w, h })
  }
  return out
}

/** Simple RGBA pixel buffer (width*height*4) for deterministic mask tests without image codecs. */
export type RgbaImage = {
  width: number
  height: number
  /** length = width * height * 4 */
  data: Uint8ClampedArray
  connectionId: string
  policyVersion: string
}

export function createRgbaImage(opts: {
  width: number
  height: number
  fill?: [number, number, number, number]
  connectionId: string
  policyVersion: string
}): RgbaImage {
  const data = new Uint8ClampedArray(opts.width * opts.height * 4)
  const fill = opts.fill || [200, 100, 50, 255]
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0]
    data[i + 1] = fill[1]
    data[i + 2] = fill[2]
    data[i + 3] = fill[3]
  }
  return {
    width: opts.width,
    height: opts.height,
    data,
    connectionId: opts.connectionId,
    policyVersion: opts.policyVersion,
  }
}

/**
 * Irreversible mask: solid black over boxes. Does not retain original pixels in those regions.
 */
export function maskImageRegions(
  image: RgbaImage,
  boxes: BoundingBox[],
): { ok: true; derivative: RgbaImage; evidence: ImageMaskEvidence } | { ok: false; reason: string } {
  if (!image.width || !image.height || image.data.length !== image.width * image.height * 4) {
    return { ok: false, reason: 'invalid image dimensions or buffer' }
  }
  const out = new Uint8ClampedArray(image.data) // copy — original buffer not mutated
  for (const box of boxes) {
    const x0 = Math.floor(box.x * image.width)
    const y0 = Math.floor(box.y * image.height)
    const x1 = Math.ceil((box.x + box.w) * image.width)
    const y1 = Math.ceil((box.y + box.h) * image.height)
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue
        const i = (y * image.width + x) * 4
        out[i] = 0
        out[i + 1] = 0
        out[i + 2] = 0
        out[i + 3] = 255
      }
    }
  }
  const derivative: RgbaImage = {
    width: image.width,
    height: image.height,
    data: out,
    connectionId: image.connectionId,
    policyVersion: image.policyVersion,
  }
  return {
    ok: true,
    derivative,
    evidence: {
      filename: '(image)',
      connectionId: image.connectionId,
      policyVersion: image.policyVersion,
      boxes: boxes.map((b) => ({ ...b })),
      width: image.width,
      height: image.height,
    },
  }
}

export type ImageMaskEvidence = {
  filename: string
  connectionId: string
  policyVersion: string
  boxes: BoundingBox[]
  width: number
  height: number
}

/**
 * Prepare image for external AI: unauthorized → unavailable; authorized + boxes → derivative only.
 */
export function prepareImageForExternalAi(opts: {
  companyBase: CompanyBasePolicy
  profile: ProviderSecurityProfile
  image: RgbaImage
  classifierBoxes: unknown
  classifierStatus: 'ok' | 'unavailable' | 'invalid'
}):
  | { ok: true; kind: 'derivative'; derivative: RgbaImage; evidence: ImageMaskEvidence }
  | { ok: false; kind: 'unavailable'; reason: string; evidence: { filename: string; classifierStatus: string } } {
  const auth = resolveImageVisionAuth(opts.companyBase, opts.profile)
  if (!auth.authorized) {
    return {
      ok: false,
      kind: 'unavailable',
      reason: auth.reason,
      evidence: { filename: '(image)', classifierStatus: 'not-authorized' },
    }
  }
  if (opts.classifierStatus !== 'ok') {
    return {
      ok: false,
      kind: 'unavailable',
      reason: `classifier ${opts.classifierStatus}; image remains unavailable`,
      evidence: { filename: '(image)', classifierStatus: opts.classifierStatus },
    }
  }
  const boxes = validateBoundingBoxes(opts.classifierBoxes)
  if (boxes == null) {
    return {
      ok: false,
      kind: 'unavailable',
      reason: 'invalid bounding boxes; image remains unavailable',
      evidence: { filename: '(image)', classifierStatus: 'invalid' },
    }
  }
  const masked = maskImageRegions(opts.image, boxes)
  if (!masked.ok) {
    return {
      ok: false,
      kind: 'unavailable',
      reason: masked.reason,
      evidence: { filename: '(image)', classifierStatus: 'sanitizer-failed' },
    }
  }
  return {
    ok: true,
    kind: 'derivative',
    derivative: masked.derivative,
    evidence: masked.evidence,
  }
}
