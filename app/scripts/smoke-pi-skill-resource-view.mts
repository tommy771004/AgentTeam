import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { snapshotPiSkillResources } from '../electron/piSkills.ts'
import { evaluatePiInvocationPolicy, freezePiRunPolicy } from '../electron/piPolicyEvidence.ts'

const root = await mkdtemp(join(tmpdir(), 'pi-skill-resource-source-'))
const skillsDir = join(root, 'skills')
const skillDir = join(skillsDir, 'deploy')
await mkdir(join(skillDir, 'references'), { recursive: true })
await writeFile(join(skillDir, 'SKILL.md'), '---\nname: deploy\ndescription: deploy\n---\nBODY\n')
await writeFile(join(skillDir, 'references', 'legal.md'), 'LEGAL RELATIVE\n')
await writeFile(join(root, 'auth.json'), 'PRIVATE\n')
await writeFile(join(skillsDir, 'root-sibling.txt'), 'NOT A SKILL RESOURCE\n')
await mkdir(join(skillsDir, 'not-a-skill'), { recursive: true })
await writeFile(join(skillsDir, 'not-a-skill', 'private.md'), 'NOT A SKILL BUNDLE\n')
await symlink(join(root, 'auth.json'), join(skillDir, 'references', 'escape.md'))

const previous = process.env.SUBAGENTS_PI_SKILLS_DIR
process.env.SUBAGENTS_PI_SKILLS_DIR = skillsDir
let snapshot
try {
  snapshot = await snapshotPiSkillResources(root, 'qualification')
  assert.ok(snapshot)
  assert.deepEqual(snapshot.manifest.sort(), ['deploy/SKILL.md', 'deploy/references/legal.md'])
  assert.equal(await readFile(join(snapshot.root, 'deploy', 'references', 'legal.md'), 'utf8'), 'LEGAL RELATIVE\n')
  assert.equal(snapshot.manifest.some((path) => /auth|escape|root-sibling|not-a-skill/.test(path)), false)

  const digest = 'd'.repeat(64)
  const policy = freezePiRunPolicy({
    approvalMode: 'full', projectRoot: join(root, 'project'),
    resourceView: snapshot,
  })
  const evaluate = (tool: string, path: string) => evaluatePiInvocationPolicy({
    coordinates: { sessionId: 'session', runId: 'run', callId: `${tool}-call` },
    origin: 'model', tool,
    contract: { contractRevision: 1, contractDigest: digest, schemaDigest: digest, toolSource: 'builtin' },
    args: { path }, policy, requirements: { pathArguments: ['path'] },
  })
  const legal = evaluate('read', join(snapshot.root, 'deploy', 'references', 'legal.md'))
  assert.equal(legal.verdict, 'allow')
  assert.equal(legal.evidence.resourceViewDecision, 'allow')
  assert.equal(legal.evidence.restrictedViewDecision, 'not-applicable')
  const escape = evaluate('read', join(snapshot.root, 'deploy', 'references', 'escape.md'))
  assert.equal(escape.verdict, 'deny')
  assert.equal(escape.evidence.resourceViewDecision, 'deny')
  assert.equal(escape.evidence.restrictedViewDecision, 'not-applicable')
  const nonmanifest = evaluate('read', join(snapshot.root, 'root-sibling.txt'))
  assert.equal(nonmanifest.verdict, 'deny')
  assert.equal(nonmanifest.evidence.resourceViewDecision, 'deny')
  assert.equal(nonmanifest.evidence.restrictedViewDecision, 'not-applicable')
  assert.equal(evaluate('write', join(snapshot.root, 'deploy', 'SKILL.md')).verdict, 'deny')
  assert.equal(evaluate('edit', join(snapshot.root, 'deploy', 'SKILL.md')).verdict, 'deny')
  assert.ok(Object.isFrozen(policy.resourceView) && Object.isFrozen(policy.resourceView?.manifest))

  const oversizedSkills = join(root, 'oversized-skills')
  const oversizedBundle = join(oversizedSkills, 'oversized')
  await mkdir(oversizedBundle, { recursive: true })
  await writeFile(join(oversizedBundle, 'SKILL.md'), '---\nname: oversized\ndescription: oversized\n---\n')
  for (let index = 0; index < 128; index += 1) {
    await writeFile(join(oversizedBundle, `resource-${index}.md`), String(index))
  }
  process.env.SUBAGENTS_PI_SKILLS_DIR = oversizedSkills
  await assert.rejects(snapshotPiSkillResources(root, 'oversized'), /exceeds 128 files/)

  const oversizedBytesSkills = join(root, 'oversized-bytes-skills')
  const oversizedBytesBundle = join(oversizedBytesSkills, 'oversized-bytes')
  await mkdir(oversizedBytesBundle, { recursive: true })
  await writeFile(join(oversizedBytesBundle, 'SKILL.md'), '---\nname: oversized-bytes\ndescription: oversized bytes\n---\n')
  await writeFile(join(oversizedBytesBundle, 'resource.bin'), Buffer.alloc(2 * 1024 * 1024))
  process.env.SUBAGENTS_PI_SKILLS_DIR = oversizedBytesSkills
  await assert.rejects(snapshotPiSkillResources(root, 'oversized-bytes'), /exceeds 2 MiB/)
} finally {
  if (previous === undefined) delete process.env.SUBAGENTS_PI_SKILLS_DIR
  else process.env.SUBAGENTS_PI_SKILLS_DIR = previous
  if (snapshot?.root) await rm(snapshot.root, { recursive: true, force: true })
  await rm(root, { recursive: true, force: true })
}

console.log('Skill Resource View snapshots only bounded regular manifest files and grants native read without mutation authority')
