import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readPiSkillCatalog, snapshotPiSkillResources } from '../electron/piSkills.ts'

const root = await mkdtemp(join(tmpdir(), 'local-skill-catalog-'))
const home = join(root, 'home')
const agentDir = join(root, 'agentstudio')
const projectRoot = join(root, 'project')

async function skill(directory: string, name: string, description: string) {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`)
}

try {
  await skill(join(agentDir, 'skills', 'managed'), 'managed', 'AgentStudio managed skill')
  await skill(join(home, '.agents', 'skills', 'global'), 'global', 'Global Agent Skill')
  await skill(join(home, '.codex', 'skills', '.system', 'system'), 'system', 'Codex system skill')
  await skill(join(projectRoot, '.agents', 'skills', 'project'), 'project', 'Project Agent Skill')
  // The Host-owned copy wins deterministic name collisions without mutating the external source.
  await skill(join(home, '.agents', 'skills', 'managed'), 'managed', 'External duplicate')

  const catalog = await readPiSkillCatalog({ agentDir, projectRoot, home })
  assert.deepEqual(catalog.files.map((entry) => entry.name).sort(), ['global', 'managed', 'project', 'system'])
  assert.equal(catalog.files.find((entry) => entry.name === 'managed')?.managed, true)
  assert.equal(catalog.files.find((entry) => entry.name === 'managed')?.description, 'AgentStudio managed skill')
  assert.equal(catalog.files.find((entry) => entry.name === 'global')?.source, 'user')
  assert.equal(catalog.files.find((entry) => entry.name === 'project')?.source, 'project')
  assert.equal(catalog.files.find((entry) => entry.name === 'system')?.source, 'system')
  assert.equal(catalog.files.filter((entry) => !entry.managed).every((entry) => entry.readOnly), true)
  assert.equal(catalog.diagnostics.some((entry) => entry.message.includes('collision')), true)

  const previousSkillsDir = process.env.SUBAGENTS_PI_SKILLS_DIR
  process.env.SUBAGENTS_PI_SKILLS_DIR = join(agentDir, 'skills')
  try {
    const snapshot = await snapshotPiSkillResources(agentDir, 'catalog-smoke', projectRoot, home)
    assert.ok(snapshot)
    assert.deepEqual(
      snapshot.manifest.filter((path) => path.endsWith('/SKILL.md')).sort(),
      ['global/SKILL.md', 'managed/SKILL.md', 'project/SKILL.md', 'system/SKILL.md'],
    )
  } finally {
    if (previousSkillsDir === undefined) delete process.env.SUBAGENTS_PI_SKILLS_DIR
    else process.env.SUBAGENTS_PI_SKILLS_DIR = previousSkillsDir
  }
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('Skill catalog projects AgentStudio, user, project, and system installs with deterministic ownership')
