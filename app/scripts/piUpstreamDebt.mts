import { readFile } from 'node:fs/promises'
import path from 'node:path'

export type PiUpstreamDebtReport = {
  owner: 'upstream'
  bunWebSocketProxyWorkaround: 'active' | 'not-present'
  xiaomiAbortUsageSkips: number
  xiaomiMultimodalSkips: number
}

const occurrences = (source: string, pattern: RegExp): number => [...source.matchAll(pattern)].length

/**
 * Inventory only: this never patches vendored Pi. Sync evidence records whether
 * upstream still carries the known workaround/skips so a version bump forces a
 * deliberate reconciliation instead of silently inheriting stale debt.
 */
export async function inspectPiUpstreamDebt(vendorRoot: string): Promise<PiUpstreamDebtReport> {
  const readOptional = async (relative: string): Promise<string> => {
    try {
      return await readFile(path.join(vendorRoot, relative), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
      throw error
    }
  }
  const [codex, tokens, images] = await Promise.all([
    readOptional('packages/ai/src/api/openai-codex-responses.ts'),
    readOptional('packages/ai/test/tokens.test.ts'),
    readOptional('packages/ai/test/image-tool-result.test.ts'),
  ])
  return {
    owner: 'upstream',
    bunWebSocketProxyWorkaround: codex.includes('github.com/oven-sh/bun/issues/15489')
      && codex.includes('TODO: remove this when bun supports proxy envs in websocket')
      ? 'active'
      : 'not-present',
    xiaomiAbortUsageSkips: occurrences(tokens, /FIXME\(xiaomi\)/g),
    xiaomiMultimodalSkips: occurrences(images, /FIXME\(xiaomi\)/g),
  }
}
