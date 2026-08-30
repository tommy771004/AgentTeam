import type { ReviewFileManifestEntry } from '../src/agent/reviewContract.ts'

export type GitNameStatusChange = {
  status: ReviewFileManifestEntry['status']
  path: string
  oldPath?: string
}

/** Parse `git diff --name-status -z`, including rename/copy two-path records. */
export function parseGitNameStatus(value: string): GitNameStatusChange[] {
  const fields = value.split('\0').filter(Boolean)
  const changes: GitNameStatusChange[] = []
  for (let index = 0; index < fields.length;) {
    const code = (fields[index++] || '')[0]
    if (code === 'R' || code === 'C') {
      const oldPath = fields[index++] || ''
      const path = fields[index++] || ''
      changes.push({ status: code === 'R' ? 'renamed' : 'copied', path, oldPath })
      continue
    }
    const path = fields[index++] || ''
    changes.push({
      status: code === 'A' ? 'added' : code === 'D' ? 'deleted' : code === 'T' ? 'type-changed' : 'modified',
      path,
    })
  }
  return changes.filter((change) => change.path)
}
