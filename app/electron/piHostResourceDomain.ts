import { discoveredPiSkills, readPiSkillCatalog, syncPiSkillsFromRenderer } from './piSkills.ts'
import { resolvePiAgentDir } from './piUserConfig.ts'
import { PiResourceRegistry, type PiResource } from './piResourceRegistry.ts'
import type { PiHostMessage } from './piHostProtocol.ts'

function errorResponse(id: string | number, code: 'invalid_request' | 'runtime_error', message: string): PiHostMessage {
  return { id, error: { code, message } }
}

export function handlePiHostResourceDomain(input: {
  method: string
  params?: Record<string, unknown>
  id: string | number
  resources: PiResource[]
  activeTools: string[]
  commit: (resources: PiResource[]) => void
}): PiHostMessage[] | Promise<PiHostMessage[]> | undefined {
  if (!input.method.startsWith('resources/')) return undefined
  if (input.method === 'resources/list') {
    const found = discoveredPiSkills()
    const readActive = input.activeTools.length === 0 || input.activeTools.includes('read')
    const skills: Array<PiResource & {
      reason?: string
      packageProvenance?: NonNullable<(typeof found.skills)[number]['packageProvenance']>
    }> = found.skills.filter((skill) => skill.name).map((skill) => ({
      id: skill.name,
      kind: 'skill',
      source: skill.filePath,
      enabled: !skill.disableModelInvocation,
      ...(skill.packageProvenance ? { packageProvenance: { ...skill.packageProvenance } } : {}),
      ...(!readActive && !skill.disableModelInvocation ? { reason: 'read 工具未啟用：此技能在 run 中不可用' } : {}),
    }))
    return [{ id: input.id, result: {
      resources: [...skills, ...input.resources.map((resource) => ({ ...resource }))].sort((left, right) => left.id.localeCompare(right.id)),
      ...(found.diagnostics.length ? { diagnostics: found.diagnostics.map((item) => ({ path: item.path, message: item.message })) } : {}),
    } }]
  }
  if (input.method === 'resources/reload') {
    if (!Array.isArray(input.params?.resources)) return [errorResponse(input.id, 'invalid_request', 'resources must be an array')]
    const registry = new PiResourceRegistry()
    try {
      registry.reload(input.params.resources as PiResource[])
      const resources = registry.list()
      input.commit(resources)
      return [{ id: input.id, result: { resources: resources.map((resource) => ({ ...resource })) } }]
    } catch (error) {
      return [errorResponse(input.id, 'invalid_request', error instanceof Error ? error.message : 'Invalid Pi resources')]
    }
  }
  if (input.method === 'resources/sync-skills') {
    if (!Array.isArray(input.params?.skills)) return [errorResponse(input.id, 'invalid_request', 'skills must be an array')]
    return syncPiSkillsFromRenderer(resolvePiAgentDir(), input.params.skills as never)
      .then((report) => [{ id: input.id, result: { report: { skillsDir: report.skillsDir, results: report.results } } }])
      .catch((error: unknown) => [errorResponse(input.id, 'runtime_error', error instanceof Error ? error.message : 'Skill sync failed')])
  }
  if (input.method === 'resources/read-skill-files') {
    const projectRoot = typeof input.params?.projectRoot === 'string' && input.params.projectRoot.trim()
      ? input.params.projectRoot.trim()
      : undefined
    return readPiSkillCatalog({ agentDir: resolvePiAgentDir(), projectRoot })
      .then(({ files, diagnostics }) => [{ id: input.id, result: { files, skillDiagnostics: diagnostics } }])
      .catch((error: unknown) => [errorResponse(input.id, 'runtime_error', error instanceof Error ? error.message : 'Skill file read failed')])
  }
  return [errorResponse(input.id, 'invalid_request', `Unknown resource method: ${input.method}`)]
}
