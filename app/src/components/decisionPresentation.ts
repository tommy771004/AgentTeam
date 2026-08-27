export type QuestionDecisionState = {
  isQuestion: boolean
  hasOptions: boolean
  hasSelection: boolean
  allowFreeform: boolean
  hasFreeform: boolean
}

export function canSubmitDecision(state: QuestionDecisionState): boolean {
  if (!state.isQuestion) return true
  if (state.hasOptions) return state.hasSelection || (state.allowFreeform && state.hasFreeform)
  return !state.allowFreeform || state.hasFreeform
}

export function submitsChoiceImmediately(input: {
  multiSelect: boolean
  allowFreeform: boolean
}): boolean {
  return !input.multiSelect && !input.allowFreeform
}

export function nextSelectedOptions(
  current: readonly string[],
  value: string,
  multiSelect: boolean,
): string[] {
  if (!multiSelect) return current[0] === value ? [] : [value]
  return current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value]
}
