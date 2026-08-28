import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/pages/KnowledgePage.tsx', import.meta.url), 'utf8')

assert.doesNotMatch(source, /<ThemePage\b/, 'Knowledge graph must not reserve width for the redundant section nav')
assert.doesNotMatch(source, /label:\s*['"]任務圖譜['"]/, 'The no-op task/codegraph tabs must stay removed')
assert.match(source, /h-full min-h-0 bg-background p-3 md:p-5/, 'Knowledge graph should fill the page with only edge spacing')
assert.match(source, /任務實體 \+ CodeGraph 程式索引/, 'The unified view must explain both graph sources')

console.log('Knowledge graph uses one unified near-full-page surface without the redundant section nav')
