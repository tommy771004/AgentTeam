import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildLocalCliArgv, runLocalCliAgent } from '../electron/localCliRunner.ts'
import { instructionDeliveryForRunner } from '../src/agent/runners/types.ts'
import { admitExternalInstructions } from '../src/agent/taskRunCoordinator.ts'

/**
 * The adapter contract is tested at the shipped owners, not by rebuilding an
 * argv or prompt in this smoke.  The process boundary is injected only so the
 * test cannot run a provider or mutate a project.
 */
const root = await mkdtemp(join(tmpdir(), 'agentteam-cli-adapter-'))
const prompt = 'ADAPTER_HANDOFF_SENTINEL'
const argvInputs: Array<{ file: string; args: string[]; cwd?: string }> = []

try {
  for (const kind of ['codex', 'claude'] as const) {
    const built = buildLocalCliArgv({ kind, binary: process.execPath, prompt, cwd: root })
    assert.equal(built.args.filter((item) => item === prompt).length, 1, `${kind} hands prompt once`)
    const result = await runLocalCliAgent({
      kind,
      binary: process.execPath,
      prompt,
      cwd: root,
      runId: `adapter-${kind}`,
      externalCliPolicy: { idleMs: 1_000, absoluteMs: 5_000, operationMs: 1_000 },
    }, {
      runArgv: async (input) => {
        argvInputs.push({ file: input.file, args: input.args, cwd: input.cwd })
        input.onStarted?.(`fake-${kind}`)
        return { ok: true, code: 0, stdout: '', stderr: '' }
      },
    })
    assert.equal(result.ok, true, `${kind} adapter settles through production runner`)
  }
  assert.equal(argvInputs.length, 2)
  for (const input of argvInputs) {
    assert.equal(input.cwd, root, 'project cwd crosses the argv process boundary')
    assert.equal(input.args.filter((item) => item === prompt).length, 1, 'prompt handoff is not duplicated')
  }

  // Native delivery owns filesystem discovery; only the DB-owned global text
  // is wrapped.  The project source remains for the provider's own discovery.
  const notices: string[] = []
  const originalWindow = (globalThis as { window?: Window }).window
  ;(globalThis as { window: Window }).window = {
    ...(originalWindow || {}),
    subagents: {
      ...((originalWindow as Window & { subagents?: unknown } | undefined)?.subagents as object || {}),
      piHost: {
        instructions: {
          resolve: async () => ({ instructionSnapshot: {
            id: 'adapter-snapshot', revision: 4, effectiveHash: 'a'.repeat(64),
            effectiveText: 'GLOBAL_SENTINEL\nPROJECT_SENTINEL', globalEffectiveText: 'GLOBAL_SENTINEL',
            sources: [
              { id: 'global', kind: 'global-custom', scope: 'global', revision: 4, bytes: 14, includedBytes: 14, droppedBytes: 0, hash: 'b'.repeat(64), applied: true, deduplicated: false, truncated: false, shadowed: false, content: 'GLOBAL_SENTINEL' },
              { id: 'project', kind: 'agents', scope: 'project', revision: 4, bytes: 15, includedBytes: 15, droppedBytes: 0, hash: 'c'.repeat(64), applied: true, deduplicated: false, truncated: false, shadowed: false, content: 'PROJECT_SENTINEL' },
            ],
            diagnostics: [], usage: { personalizationBytes: 14, projectInstructionBytes: 15, totalBytes: 29, budgetBytes: 1024 },
            deliveryMode: 'native', exactSnapshot: false,
          } }),
        },
      },
    },
  } as Window
  const overrides: { extraSystemContext?: string; instructionSnapshot?: unknown } = {}
  await admitExternalInstructions({ runner: 'codex', projectRoot: root, overrides, notice: (text) => notices.push(text) })
  assert.equal((overrides.extraSystemContext || '').split('GLOBAL_SENTINEL').length - 1, 1, 'native wrapper includes global once')
  assert.equal((overrides.extraSystemContext || '').includes('PROJECT_SENTINEL'), false, 'native wrapper does not duplicate project discovery')
  assert.match(notices[0] || '', /native/)
  assert.equal(instructionDeliveryForRunner('gemini').mode, 'unverified', 'unsupported native discovery is explicit')
  if (originalWindow) (globalThis as { window?: Window }).window = originalWindow
  else delete (globalThis as { window?: Window }).window
  console.log('external CLI adapter contract smoke passed: argv/prompt/cwd, native de-duplication, unsupported evidence')
} finally {
  await rm(root, { recursive: true, force: true })
}
