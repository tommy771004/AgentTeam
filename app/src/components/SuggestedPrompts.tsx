import { useSettingsStore } from '../store/settingsStore'

/**
 * Suggested prompts on an empty conversation.
 *
 * The `ambientSuggestions` setting has promised this since it was added, but
 * nothing ever rendered it — the switch was there and the feature was not.
 * This is the behaviour it names, so the toggle now means what it says.
 *
 * They fill the composer rather than starting a run: a suggestion is a
 * starting point the user edits, not a command they fired by accident.
 */

const SUGGESTIONS: ReadonlyArray<{ label: string; prompt: string }> = [
  {
    label: '看看這個專案',
    prompt: '請閱讀這個專案的結構與說明文件，用幾句話說明它在做什麼、進入點在哪。',
  },
  {
    label: '找出待辦與缺口',
    prompt: '請掃過專案，列出 TODO、FIXME 與明顯未完成的地方，並依風險排序。',
  },
  {
    label: '解釋最近的改動',
    prompt: '請看最近幾次 commit 的 diff，說明改了什麼、為什麼，以及有沒有值得注意的風險。',
  },
]

export function SuggestedPrompts({ onPick }: { onPick: (prompt: string) => void }) {
  const enabled = useSettingsStore((state) => state.settings.ambientSuggestions)
  // Default on: the setting is a way to turn this OFF, so an unset value must
  // not hide it.
  if (enabled === false) return null
  return (
    <div className="mt-5 w-full max-w-md text-left">
      <ul className="divide-y divide-white/5 border-y border-white/5">
        {SUGGESTIONS.map((suggestion) => (
          <li key={suggestion.label}>
            <button
              type="button"
              onClick={() => onPick(suggestion.prompt)}
              className="w-full px-1 py-2.5 text-left group"
            >
              <span className="text-sm text-on-surface-variant group-hover:text-primary transition-colors">
                {suggestion.label}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
