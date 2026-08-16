import type { MessageCatalog } from '../index.ts'

/**
 * English translations.
 *
 * Only the shell is translated — never model output. Keys absent here fall back
 * to zh-TW rather than rendering blank, and `smoke-i18n` prints how many remain
 * so a partial translation is visible progress instead of a silent hole.
 */
export const en: MessageCatalog = {
  // ── Appearance settings ─────────────────────────────────────────
  'settings.appearance.group.theme': 'Theme',
  'settings.appearance.group.tour': 'Tour',
  'settings.appearance.group.fontSize': 'Text size',
  'settings.appearance.theme.label': 'Appearance',
  'settings.appearance.theme.summary': 'Dark, light, or follow the system.',
  'settings.appearance.theme.dark': 'Dark',
  'settings.appearance.theme.light': 'Light',
  'settings.appearance.theme.system': 'System',
  'settings.appearance.reducedMotion.label': 'Reduce motion',
  'settings.appearance.reducedMotion.summary':
    'Tone down animation, or follow the system reduce-motion preference.',
  'settings.appearance.reducedMotion.on': 'On',
  'settings.appearance.reducedMotion.off': 'Off',
  'settings.appearance.translucentSidebar.label': 'Translucent sidebar',
  'settings.appearance.translucentSidebar.summary':
    'Give the sidebar a translucent material; turn it off on slower machines for smoother scrolling.',
  'settings.appearance.tour.label': 'Replay the product tour',
  'settings.appearance.tour.summary':
    'Walk through the four ideas again: loop pattern, execution engine, approval mode, and honesty.',
  'settings.appearance.tour.action': 'Replay tour',
  'settings.appearance.uiFontSize.label': 'Interface text size',
  'settings.appearance.uiFontSize.summary': 'Text size across the whole interface.',
  'settings.appearance.codeFontSize.label': 'Code text size',
  'settings.appearance.codeFontSize.summary':
    'Monospace size for the terminal, code blocks, and diffs.',

  // ── Interface language ──────────────────────────────────────────
  'settings.appearance.language.label': 'Interface language',
  'settings.appearance.language.summary':
    'Language used for interface text. Takes effect immediately — no restart needed.',
  'settings.appearance.language.system': 'Follow system',
  'settings.appearance.language.zhTW': '繁體中文',
  'settings.appearance.language.en': 'English',

  // ── Settings shell ──────────────────────────────────────────────
  'settings.view.showAdvanced': 'Show advanced',
  'settings.view.basicHint':
    'Basic view: everyday settings only. Advanced options are still there, and their values are untouched.',
  'settings.view.advancedHint': 'Advanced view: engineering parameters and rarely-used switches.',
  'settings.field.advancedBadge': 'Advanced',
  'settings.search.placeholder': 'Search settings',
  'settings.search.label': 'Search settings',
  'settings.search.resultsLabel': 'Settings search results',
  'settings.search.empty': 'No matching settings.',
  'settings.footer.autoApply': 'Changes apply immediately — nothing to save.',
}
