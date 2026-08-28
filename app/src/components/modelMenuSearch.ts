export type ModelMenuChoice = {
  id: string
  label: string
  hint: string
}

/** Case-insensitive model picker search across id, display label, and provider. */
export function filterModelChoices(
  models: ModelMenuChoice[],
  query: string,
): ModelMenuChoice[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return models
  return models.filter((model) =>
    `${model.id}\n${model.label}\n${model.hint}`.toLocaleLowerCase().includes(normalized),
  )
}
