export type PiContextPacket = { objective: string; facts: string[]; constraints: string[] }
export type PiChildSession = { id: string; role: string; profile: Record<string, unknown>; context: PiContextPacket; depth: number }

export function createPiChildSession(input: { role: string; profile: Record<string, unknown>; context: PiContextPacket; depth: number; maxDepth?: number }): PiChildSession {
  if (input.depth > (input.maxDepth ?? 2)) throw new Error('delegation depth budget exceeded')
  return { id: `pi-child-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, role: input.role, profile: { ...input.profile }, context: { objective: input.context.objective, facts: [...input.context.facts], constraints: [...input.context.constraints] }, depth: input.depth }
}
