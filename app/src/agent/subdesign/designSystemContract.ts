export const DESIGN_SYSTEM_ROOT = '.subagents/subdesign/design-systems'

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/

export function isSafeDesignSystemId(value: string): boolean {
  return SAFE_ID.test(value) && value !== '.' && value !== '..'
}

export function designSystemPath(id: string): string {
  if (id === 'project') return 'DESIGN.md'
  if (!isSafeDesignSystemId(id)) throw new Error('design system id 只能包含英數、句點、底線與連字號。')
  return `${DESIGN_SYSTEM_ROOT}/${id}/DESIGN.md`
}

export function defaultDesignSystemMarkdown(title: string, category = 'custom'): string {
  const safeTitle = title.trim() || 'New Design System'
  return `---\ntitle: ${safeTitle}\ncategory: ${category}\n---\n\n# ${safeTitle}\n\n## Overview\n\nDescribe the product context and the visual principle.\n\n## Audience\n\nDescribe the primary audience and their needs.\n\n## Color\n\n- Primary: #2B6CB0\n- Accent: #ED8936\n- Surface: #F7FAFC\n\n## Typography\n\nUse a readable sans-serif with clear hierarchy.\n\n## Spacing/Layout\n\nUse a consistent spacing scale and responsive constraints.\n\n## Components\n\nDocument component states, focus, loading, empty, and error states.\n\n## Motion\n\nKeep motion purposeful and respect reduced-motion preferences.\n\n## Content voice\n\nBe direct, useful, and human.\n\n## Do/Don't\n\n- Do make hierarchy visible.\n- Don't use color as the only signal.\n`
}
