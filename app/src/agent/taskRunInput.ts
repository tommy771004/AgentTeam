/** Pure ingress normalization shared by the canonical coordinator smoke seam. */
export function normalizeTaskObjective<T extends { objective: string }>(input: T): T {
  const objective = input.objective.trim()
  return objective === input.objective ? input : { ...input, objective }
}
