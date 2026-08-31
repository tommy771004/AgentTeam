import fs from 'node:fs'
import { validatePackagedInstallEvidence } from './packaged-install-evidence.mjs'

const [evidencePath, expectedPlatform] = process.argv.slice(2)
if (!evidencePath || !expectedPlatform) {
  throw new Error('Usage: verify-packaged-install-evidence.mjs <evidence.json> <expected-platform>')
}

const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'))
const validation = validatePackagedInstallEvidence(evidence, expectedPlatform)
if (!validation.ok) throw new Error(validation.reason)

console.log(`Packaged lifecycle evidence verified with current schema ${validation.schemaVersion}`)
