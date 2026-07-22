import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

function scoped(root: string, relative = '.') {
  const base = path.resolve(root)
  const target = path.resolve(base, relative)
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) throw new Error('path escapes project scope')
  return target
}

export async function piRead(root: string, relative: string): Promise<{ path: string; content: string }> {
  const target = scoped(root, relative)
  return { path: path.relative(root, target), content: await readFile(target, 'utf8') }
}

export async function piLs(root: string, relative = '.'): Promise<string[]> {
  const entries = await readdir(scoped(root, relative), { withFileTypes: true })
  return entries.map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`).sort()
}

export async function piFind(root: string, pattern: string, relative = '.'): Promise<string[]> {
  const start = scoped(root, relative)
  const matches: string[] = []
  const visit = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(full)
      else if (entry.name.includes(pattern)) matches.push(path.relative(root, full))
    }
  }
  await visit(start)
  return matches.sort()
}

export async function piGrep(root: string, query: string, relative = '.'): Promise<Array<{ path: string; line: number; text: string }>> {
  const files = await piFind(root, '', relative)
  const matches: Array<{ path: string; line: number; text: string }> = []
  for (const file of files) {
    const target = scoped(root, file)
    if ((await stat(target)).size > 1_000_000) continue
    const lines = (await readFile(target, 'utf8')).split(/\r?\n/)
    lines.forEach((text, index) => { if (text.includes(query)) matches.push({ path: file, line: index + 1, text }) })
  }
  return matches
}
