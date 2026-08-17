/**
 * In-memory `Storage` for Node-side seams (headless run, evaluation harness).
 *
 * One implementation so the headless entry and the evaluation harness cannot
 * drift into two slightly different fakes of the same browser API.
 */
export function createMemoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size
    },
  } as Storage
}
