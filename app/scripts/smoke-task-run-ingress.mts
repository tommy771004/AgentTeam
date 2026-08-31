import path from 'node:path'
import { assertCanonicalTaskRunIngress } from './lib/task-run-ingress-guard.mjs'

const appRoot = path.resolve(import.meta.dirname, '..')
assertCanonicalTaskRunIngress(appRoot)

console.log('all Task sources preserve the canonical runTask ingress boundary')
