import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

const within = (root: string, candidate: string): boolean => {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

export async function resolveCriterionPath(workspaceRoot: string, requestedPath: string): Promise<{
  root: string
  candidate: string
  canonical?: string
  valid: boolean
}> {
  const root = await realpath(workspaceRoot)
  const rawPath = requestedPath.startsWith('@') ? requestedPath.slice(1) : requestedPath
  const candidate = resolve(root, rawPath)
  if (!within(root, candidate)) return { root, candidate, valid: false }
  try {
    const canonical = await realpath(candidate)
    return { root, candidate, canonical, valid: within(root, canonical) }
  } catch {
    return { root, candidate, valid: true }
  }
}
