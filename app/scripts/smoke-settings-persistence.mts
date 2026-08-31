import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  SettingsPersistence,
  type SettingsPersistenceCheckpoint,
} from '../electron/settingsPersistence.ts'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-persistence-'))

try {
  const file = path.join(root, 'config', 'settings.json')
  const initial = new SettingsPersistence(file)
  assert.deepEqual(initial.read(), { state: 'no-settings', value: null })

  const oldValue = { theme: 'dark', webhookPort: 8787 }
  const newValue = { theme: 'light', webhookPort: 9000 }
  initial.write(oldValue)
  assert.deepEqual(new SettingsPersistence(file).read(), { state: 'primary', value: oldValue })
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  fs.mkdirSync(`${file}.last-good`)
  assert.deepEqual(
    new SettingsPersistence(file).read(),
    { state: 'primary', value: oldValue },
    'a valid primary must not depend on reading last-good',
  )
  fs.rmSync(`${file}.last-good`, { recursive: true })

  const checkpoints: SettingsPersistenceCheckpoint[] = [
    'before-temp-write',
    'during-temp-write',
    'before-rename',
    'after-rename',
  ]
  for (const checkpoint of checkpoints) {
    initial.write(oldValue)
    const faulted = new SettingsPersistence(file, {
      checkpoint: (current) => {
        if (current === checkpoint) throw new Error('SECRET-CANARY')
      },
    })
    assert.throws(
      () => faulted.write(newValue),
      (error: unknown) => {
        assert.doesNotMatch(String(error), /SECRET-CANARY|theme|webhookPort/)
        return true
      },
    )
    const restarted = new SettingsPersistence(file).read()
    assert.ok(restarted.state === 'primary' || restarted.state === 'recovered-last-good')
    assert.ok(
      JSON.stringify(restarted.value) === JSON.stringify(oldValue)
        || JSON.stringify(restarted.value) === JSON.stringify(newValue),
      `${checkpoint} restart must recover one complete generation`,
    )
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, 'utf8')))
  }

  initial.write(oldValue)
  initial.write(newValue)
  fs.writeFileSync(file, '{"theme":', 'utf8')
  assert.deepEqual(new SettingsPersistence(file).read(), {
    state: 'recovered-last-good',
    value: oldValue,
  })

  fs.rmSync(file)
  assert.deepEqual(new SettingsPersistence(file).read(), {
    state: 'recovered-last-good',
    value: oldValue,
  })

  fs.writeFileSync(file, '{"theme":', 'utf8')
  fs.rmSync(`${file}.last-good`, { force: true })
  assert.deepEqual(new SettingsPersistence(file).read(), {
    state: 'corrupt-primary',
    value: null,
  })

  console.log('settings persistence: atomic generations, failure matrix, permissions, and explicit recovery states passed')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
