import type { DesignSystemDocument, DesignSystemSummary } from './types'

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

function unique(items: string[], limit = 12): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(0, limit)
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/)
  if (!match) return {}
  const values: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([\w.-]+)\s*:\s*(.*?)\s*$/)
    if (pair) values[pair[1]] = pair[2].replace(/^['"]|['"]$/g, '')
  }
  return values
}

function sectionBody(content: string, names: string[]): string {
  const wanted = names.map((name) => name.toLowerCase())
  const headings = [...content.matchAll(/^##\s+(.+)$/gim)]
  for (let index = 0; index < headings.length; index += 1) {
    const title = headings[index][1].trim().toLowerCase()
    if (!wanted.some((name) => title.includes(name))) continue
    const start = (headings[index].index || 0) + headings[index][0].length
    const end = headings[index + 1]?.index ?? content.length
    return content.slice(start, end)
  }
  return ''
}

function extractColors(content: string, frontmatter: Record<string, string>): string[] {
  const colorSection = sectionBody(content, ['color', 'colour', '色彩'])
  const source = `${frontmatter.colors || ''}\n${colorSection || content}`
  return unique(
    source.match(/(?:#[0-9a-f]{3,8}\b|rgba?\([^)]{3,80}\)|hsla?\([^)]{3,80}\))/gi) || [],
    10,
  )
}

function extractTypography(content: string, frontmatter: Record<string, string>): string | undefined {
  if (frontmatter.typography) return frontmatter.typography.slice(0, 240)
  const body = sectionBody(content, ['typography', 'font', '字體'])
  const line = body
    .split(/\r?\n/)
    .map((item) => item.replace(/^[-*]\s*/, '').replace(/`/g, '').trim())
    .find(Boolean)
  return line?.slice(0, 240)
}

export function parseDesignSystemMarkdown(
  content: string,
  input: { id: string; sourcePath: string; tokenPaths?: string[] },
): DesignSystemSummary {
  const frontmatter = parseFrontmatter(content)
  const title =
    frontmatter.title ||
    content.match(/^#\s+(.+)$/m)?.[1]?.trim() ||
    input.id
  const headings = [...content.matchAll(/^##\s+(.+)$/gim)].map((match) => match[1].trim())
  const overview = sectionBody(content, ['overview', '概覽'])
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .find(Boolean)
  const tokenPaths = unique([
    ...(input.tokenPaths || []),
    ...(content.match(/(?:tokens?\.(?:css|json)|--[a-z0-9-]+)/gi) || []),
  ])
  return {
    id: input.id,
    title: title.slice(0, 160),
    category: frontmatter.category?.slice(0, 80) || undefined,
    description: overview?.slice(0, 500),
    sourcePath: input.sourcePath,
    colors: extractColors(content, frontmatter),
    typography: extractTypography(content, frontmatter),
    tokenPaths,
    sections: unique(headings, 12),
  }
}

type WorkspaceApi = NonNullable<NonNullable<Window['subagents']>['tools']>

function workspaceTools(): WorkspaceApi | undefined {
  return window.subagents?.tools
}

async function readWorkspace(path: string, projectRoot?: string): Promise<string | null> {
  const api = workspaceTools()
  if (!api?.workspaceRead) return null
  const result = await api.workspaceRead(path, projectRoot)
  return result.ok ? result.content : null
}

export async function readDesignSystem(
  id: string,
  projectRoot?: string,
): Promise<DesignSystemDocument | null> {
  const sourcePath = designSystemPath(id)
  const content = await readWorkspace(sourcePath, projectRoot)
  if (content == null) return null
  return { ...parseDesignSystemMarkdown(content, { id, sourcePath }), content }
}

export async function scanDesignSystems(projectRoot?: string): Promise<DesignSystemSummary[]> {
  const api = workspaceTools()
  if (!api?.workspaceList || !api.workspaceRead) return []
  const systems: DesignSystemSummary[] = []
  try {
    const rootEntries = await api.workspaceList('.', projectRoot)
    const projectDesign = rootEntries.entries.find((entry) => entry.name === 'DESIGN.md' && !entry.dir)
    if (projectDesign) {
      const content = await readWorkspace('DESIGN.md', projectRoot)
      if (content != null) {
        systems.push(parseDesignSystemMarkdown(content, { id: 'project', sourcePath: 'DESIGN.md' }))
      }
    }
  } catch {
    /* An unavailable project root is an empty registry, not a fatal page error. */
  }
  try {
    const root = await api.workspaceList(DESIGN_SYSTEM_ROOT, projectRoot)
    const directories = root.entries.filter((entry) => entry.dir && isSafeDesignSystemId(entry.name))
    for (const directory of directories.slice(0, 40)) {
      try {
        const entries = await api.workspaceList(`${DESIGN_SYSTEM_ROOT}/${directory.name}`, projectRoot)
        if (!entries.entries.some((entry) => entry.name === 'DESIGN.md' && !entry.dir)) continue
        const content = await readWorkspace(
          `${DESIGN_SYSTEM_ROOT}/${directory.name}/DESIGN.md`,
          projectRoot,
        )
        if (content == null) continue
        systems.push(
          parseDesignSystemMarkdown(content, {
            id: directory.name,
            sourcePath: `${DESIGN_SYSTEM_ROOT}/${directory.name}/DESIGN.md`,
            tokenPaths: entries.entries
              .filter((entry) => !entry.dir && entry.name !== 'DESIGN.md')
              .map((entry) => entry.name),
          }),
        )
      } catch {
        /* Skip one malformed design system and keep the registry useful. */
      }
    }
  } catch {
    /* The .subagents directory may not exist yet. */
  }
  return systems
}

export function formatDesignSystemContext(system: DesignSystemSummary | undefined): string {
  if (!system) return 'Design system：未選定；先掃描專案 DESIGN.md 與 .subagents/subdesign/design-systems。'
  return [
    `Design system：${system.title} (id=${system.id})`,
    `Source：${system.sourcePath}`,
    system.category ? `Category：${system.category}` : '',
    system.description ? `Overview：${system.description}` : '',
    system.colors.length ? `Colors：${system.colors.join(', ')}` : '',
    system.typography ? `Typography：${system.typography}` : '',
    system.tokenPaths.length ? `Related tokens/assets：${system.tokenPaths.join(', ')}` : '',
    system.sections.length ? `Sections：${system.sections.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export function defaultDesignSystemMarkdown(title: string, category = 'custom'): string {
  const safeTitle = title.trim() || 'New Design System'
  return `---\ntitle: ${safeTitle}\ncategory: ${category}\n---\n\n# ${safeTitle}\n\n## Overview\n\nDescribe the product context and the visual principle.\n\n## Audience\n\nDescribe the primary audience and their needs.\n\n## Color\n\n- Primary: #2B6CB0\n- Accent: #ED8936\n- Surface: #F7FAFC\n\n## Typography\n\nUse a readable sans-serif with clear hierarchy.\n\n## Spacing/Layout\n\nUse a consistent spacing scale and responsive constraints.\n\n## Components\n\nDocument component states, focus, loading, empty, and error states.\n\n## Motion\n\nKeep motion purposeful and respect reduced-motion preferences.\n\n## Content voice\n\nBe direct, useful, and human.\n\n## Do/Don't\n\n- Do make hierarchy visible.\n- Don't use color as the only signal.\n`
}

