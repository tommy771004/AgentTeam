import type { DesignSystemDocument, DesignSystemSummary } from './types.ts'
export { DESIGN_SYSTEM_ROOT, defaultDesignSystemMarkdown, designSystemPath, isSafeDesignSystemId } from './designSystemContract.ts'
import { DESIGN_SYSTEM_ROOT, designSystemPath, isSafeDesignSystemId, defaultDesignSystemMarkdown } from './designSystemContract.ts'


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

export async function createDesignSystemDocument(input: {
  id: string
  title: string
  category?: string
  content?: string
  projectRoot?: string
}): Promise<{ ok: boolean; path?: string; error?: string }> {
  const id = input.id.trim()
  const title = input.title.trim()
  if (!input.projectRoot) return { ok: false, error: '請先選擇 project root。' }
  if (!isSafeDesignSystemId(id) || id === 'project' || !title) return { ok: false, error: 'id / title 不合法。' }
  const api = workspaceTools()
  if (!api?.workspaceMkdir || !api.workspaceWrite) return { ok: false, error: '建立 design system 需要 Electron workspace API。' }
  const dir = await api.workspaceMkdir(`${DESIGN_SYSTEM_ROOT}/${id}`, input.projectRoot)
  if (!dir.ok && !/exist/i.test(dir.error || '')) return { ok: false, error: dir.error || '建立 design system 資料夾失敗。' }
  const content = input.content?.trim() || defaultDesignSystemMarkdown(title, input.category || 'custom')
  const result = await api.workspaceWrite(designSystemPath(id), content, input.projectRoot)
  return result.ok ? { ok: true, path: result.path } : { ok: false, error: result.error || '寫入 DESIGN.md 失敗。' }
}

export async function updateDesignSystemDocument(input: {
  id: string
  content: string
  projectRoot?: string
}): Promise<{ ok: boolean; path?: string; error?: string }> {
  const id = input.id.trim()
  if (!input.projectRoot) return { ok: false, error: '請先選擇 project root。' }
  if (id !== 'project' && !isSafeDesignSystemId(id)) return { ok: false, error: 'design system id 不合法。' }
  if (!input.content.trim()) return { ok: false, error: 'DESIGN.md 內容不可為空。' }
  const api = workspaceTools()
  if (!api?.workspaceWrite) return { ok: false, error: '更新 design system 需要 Electron workspace API。' }
  const result = await api.workspaceWrite(designSystemPath(id), input.content, input.projectRoot)
  return result.ok ? { ok: true, path: result.path } : { ok: false, error: result.error || '更新 DESIGN.md 失敗。' }
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
