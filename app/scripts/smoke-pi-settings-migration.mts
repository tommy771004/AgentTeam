import { strict as assert } from 'node:assert'
import { migrateLegacySettings } from '../electron/piSettingsMigration.ts'

const result = migrateLegacySettings({
  provider: 'openai', model: 'gpt-pi', baseUrl: 'http://127.0.0.1:4318/v1', thinkingLevel: 'high', activeTools: ['read', 'read'], compaction: 'manual', apiKey: 'secret-only-main',
})
assert.equal(result.version, 1)
assert.deepEqual(result.settings, { provider: 'openai', model: 'gpt-pi', thinkingLevel: 'high', activeTools: ['read'], compaction: 'manual', approvalMode: 'auto', bashRequireAsk: true, unattended: false })
assert.deepEqual(result.credential, { provider: 'openai', apiKey: 'secret-only-main' })
assert.deepEqual(result.modelConfig, { provider: 'openai', model: 'gpt-pi', baseUrl: 'http://127.0.0.1:4318/v1' })
assert.deepEqual(result.electronOwned, ['theme', 'shortcuts', 'windowBounds'])
console.log('pi settings migration is validated')
