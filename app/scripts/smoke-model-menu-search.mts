import assert from 'node:assert/strict'
import { filterModelChoices } from '../src/components/modelMenuSearch.ts'

const models = [
  { id: 'gpt-5.2-codex', label: 'GPT 5.2 Codex', hint: 'OpenAI Codex' },
  { id: 'claude-sonnet-4', label: 'Claude Sonnet 4', hint: 'Anthropic' },
  { id: 'qwen3-coder', label: 'Qwen 3 Coder', hint: 'OpenCode' },
]

assert.deepEqual(filterModelChoices(models, ''), models)
assert.deepEqual(filterModelChoices(models, 'SONNET').map((model) => model.id), ['claude-sonnet-4'])
assert.deepEqual(filterModelChoices(models, 'openai').map((model) => model.id), ['gpt-5.2-codex'])
assert.deepEqual(filterModelChoices(models, 'coder').map((model) => model.id), ['qwen3-coder'])
assert.deepEqual(filterModelChoices(models, 'missing'), [])

console.log('Model picker filters immediately by id, label, and provider')
