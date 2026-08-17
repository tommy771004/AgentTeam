/** Run the fixed evaluation tasks and emit only journal/artifact projections. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tasks = JSON.parse(
  fs.readFileSync(path.join(appRoot, 'evaluation/tasks.json'), 'utf8'),
)
const jiti = createJiti(import.meta.url, { interopDefault: true })
const { runEvaluationBatch } = await jiti.import('../src/agent/evaluationHarness.ts') as typeof import('../src/agent/evaluationHarness.ts')
const result = await runEvaluationBatch(tasks, { settingsPatch: { enabled: false } })
const outputDir = path.join(appRoot, '.tmp', 'evaluation')
fs.mkdirSync(outputDir, { recursive: true })
const outputPath = path.join(outputDir, 'latest.json')
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
process.stdout.write(`${JSON.stringify({ outputPath, score: result.score, tasks: result.tasks.length })}\n`)
