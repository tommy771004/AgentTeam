/**
 * Safety constraint evaluation — human-in-the-loop gate.
 * Triggers manual intervention when proposed actions touch sensitive resources.
 */

import type { SafetyCheck } from './types.ts'

const SENSITIVE_TABLES = [
  'user_credentials',
  'credentials',
  'password',
  'ssn',
  'credit_card',
  'private_key',
  'secret',
  'auth_token',
]

const SENSITIVE_KEYWORDS = [
  'dump credentials',
  'export secrets',
  'full_dump',
  'user_credentials',
  'exfiltrate',
  'bypass auth',
  'delete all users',
  'drop table',
]

const HIGH_AUTH_LEVEL = 4
const DEFAULT_AGENT_LEVEL = 2

export function evaluateSafety(
  objective: string,
  stepDescription: string,
  action: string,
  authLevel: number = DEFAULT_AGENT_LEVEL,
): SafetyCheck {
  const haystack = `${objective} ${stepDescription} ${action}`.toLowerCase()

  const hitKeyword = SENSITIVE_KEYWORDS.find((k) => haystack.includes(k.toLowerCase()))
  const hitTable = SENSITIVE_TABLES.find((t) => haystack.includes(t.toLowerCase()))

  // Also trigger for demo when objective explicitly mentions sensitive extract
  const forceDemo =
    /sensitive|credentials|privacy|p0|authorization/i.test(objective) &&
    /extract|dump|export|query|access/i.test(`${stepDescription} ${action}`)

  const tables = ['user_profiles', 'transaction_history']
  if (hitTable || forceDemo) tables.push(hitTable || 'user_credentials')

  const payload: Record<string, unknown> = {
    method: 'POST',
    path: '/api/v2/data/extract',
    body: {
      target_database: 'prod_core',
      query_type: hitKeyword || forceDemo ? 'FULL_DUMP' : 'SELECT',
      tables,
      export_destination: 's3://temp-analysis-bucket/',
      step: action,
      objective_snippet: objective.slice(0, 120),
    },
  }

  const resourceOk = true
  const privacyOk = !hitTable && !hitKeyword && !forceDemo
  const authOk = privacyOk || authLevel >= HIGH_AUTH_LEVEL

  const evaluations = [
    {
      name: 'Resource Limits',
      passed: resourceOk,
      detail: 'Estimated query size (45MB) is within the 500MB limit.',
    },
    {
      name: 'Data Privacy Policy (P0)',
      passed: privacyOk && authOk,
      detail: privacyOk
        ? 'No restricted tables detected in payload.'
        : `Table ${hitTable || 'user_credentials'} requires Level ${HIGH_AUTH_LEVEL} authorization. Current agent session is operating at Level ${authLevel}.`,
    },
  ]

  const ok = evaluations.every((e) => e.passed)

  return {
    ok,
    constraint: ok
      ? 'None'
      : 'Unauthorized access to sensitive data structures',
    reason: ok
      ? 'All safety constraints satisfied.'
      : `Proposed action violates safety constraint: Unauthorized access to sensitive data structures.`,
    recommendation: ok
      ? 'Proceed.'
      : 'Remove restricted table from payload or elevate session authorization manually.',
    payload,
    evaluations,
  }
}

export function formatPayloadForDisplay(payload: Record<string, unknown>): string {
  const body = payload.body as Record<string, unknown> | undefined
  if (!body) return JSON.stringify(payload, null, 2)

  const tables = (body.tables as string[]) || []
  const tableLines = tables
    .map((t) => {
      const violation = SENSITIVE_TABLES.some((s) => t.toLowerCase().includes(s))
      return violation ? `    "${t}"  /* Violation */` : `    "${t}"`
    })
    .join(',\n')

  return `${payload.method as string} ${payload.path as string}
{
  "target_database": ${JSON.stringify(body.target_database)},
  "query_type": ${JSON.stringify(body.query_type)},
  "tables": [
${tableLines}
  ],
  "export_destination": ${JSON.stringify(body.export_destination)}
}`
}
