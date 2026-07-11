/**
 * Agent Prompt Schema parser — implements 03_Agent_Prompt_Schema
 * Converts raw user input into a structured Loop Configuration.
 */

import type { LoopConfiguration, LoopType, ParseResult, ExecutionStep } from './types'

const GOAL_KEYWORDS = [
  'find',
  'analyze',
  'research',
  'compare',
  'synthesize',
  'generate',
  'build',
  'create',
  'investigate',
  'extract',
  'until',
  'complete',
  'report',
  'summary',
]

const TIME_KEYWORDS = [
  'daily',
  'every day',
  'cron',
  'schedule',
  'at ',
  'every hour',
  'weekly',
  '定時',
  '每日',
  '每週',
  '每小時',
  '排程',
]

const PROACTIVE_KEYWORDS = [
  'when',
  'if email',
  'webhook',
  'on event',
  'monitor',
  'trigger when',
  '當',
  '如果',
  '若',
  '一旦',
  '每當',
  '事件',
]

function classifyLoopType(input: string): LoopType {
  const lower = input.toLowerCase()

  if (TIME_KEYWORDS.some((k) => lower.includes(k) || input.includes(k))) return 'Time-based'
  if (PROACTIVE_KEYWORDS.some((k) => lower.includes(k) || input.includes(k))) return 'Proactive'
  if (GOAL_KEYWORDS.some((k) => lower.includes(k)) || input.length > 40) return 'Goal-based'

  // Short imperative → turn-based
  return 'Turn-based'
}

function deriveSteps(input: string, loopType: LoopType): string[] {
  if (loopType === 'Turn-based') {
    return ['Receive and parse user request', 'Execute single action', 'Return result for user validation']
  }

  if (loopType === 'Time-based') {
    return [
      'Validate schedule trigger',
      'Fetch data from source',
      'Process and transform payload',
      'Deliver to target endpoint',
    ]
  }

  if (loopType === 'Proactive') {
    return [
      'Match event against boolean criteria',
      'Extract event parameters',
      'Execute bound action',
      'Confirm delivery',
    ]
  }

  // Goal-based: break objective into research pipeline
  const steps = [
    'Initialize Agents',
    'Data Ingestion',
    'Pattern Extraction',
    'Model Synthesis',
    'Format & Validate Output',
  ]

  // Specialize from keywords
  if (/search|find|tools|software/i.test(input)) {
    return [
      'Search target domain',
      'Extract features and pricing',
      'Compare candidates',
      'Format Markdown table',
      'Validate Definition of Done',
    ]
  }

  if (/log|security|anomal/i.test(input)) {
    return [
      'Fetch logs',
      'Filter noise',
      'Pattern match anomalies',
      'Generate report',
      'Validate Definition of Done',
    ]
  }

  if (/price|market|competitor/i.test(input)) {
    return [
      'Initialize Agents',
      'Data Ingestion',
      'Pattern Extraction',
      'Model Synthesis',
      'Validate Definition of Done',
    ]
  }

  return steps
}

function deriveDoD(input: string, loopType: LoopType, stepCount: number): string {
  if (loopType === 'Turn-based') return 'Single action completed and output returned to user'
  if (loopType === 'Time-based') return 'Data retrieved successfully and delivered to target endpoint'
  if (loopType === 'Proactive') return 'Action executed successfully based on exact event parameters'

  // Goal-based heuristics
  const threeItems = input.match(/(\d+)\s+/i)
  if (threeItems) {
    return `Output contains exactly ${threeItems[1]} distinct items with required fields populated`
  }
  if (/table|compare/i.test(input)) {
    return 'Markdown comparison table with all required columns filled (use N/A if unavailable)'
  }
  return `All ${stepCount} execution steps completed with confidence ≥ 0.80`
}

function maxIterationsFor(loopType: LoopType): number {
  switch (loopType) {
    case 'Goal-based':
      return 5
    case 'Turn-based':
      return 1
    case 'Time-based':
      return 1
    case 'Proactive':
      return 1
  }
}

/**
 * Parse raw user request into Loop Configuration (schema from 03_Agent_Prompt_Schema).
 * @param forceLoopType When set (UI / automation), re-derive steps & DoD for that mode
 *                      instead of only overwriting the type label.
 */
export function parseUserRequest(
  rawInput: string,
  forceLoopType?: LoopType,
): ParseResult {
  const objective = rawInput.trim()
  if (!objective) {
    throw new Error('Empty request: provide an objective or command.')
  }

  const loopType = forceLoopType || classifyLoopType(objective)
  const sequence = deriveSteps(objective, loopType)
  let maxIterations = maxIterationsFor(loopType)
  // Goal default iterations are often overridden by settings in engine
  if (forceLoopType === 'Goal-based') {
    maxIterations = Math.max(maxIterations, 5)
  }

  const config: LoopConfiguration = {
    loopType,
    trigger:
      loopType === 'Turn-based'
        ? 'Received user input (synchronous)'
        : loopType === 'Goal-based'
          ? 'Complex objective assigned'
          : loopType === 'Time-based'
            ? 'System clock reaches predefined timestamp'
            : 'Event payload matches boolean criteria',
    executionSequence: sequence,
    definitionOfDone: deriveDoD(objective, loopType, sequence.length),
    maxIterations,
    fallbackProtocol:
      loopType === 'Goal-based'
        ? 'Halt and route to human-in-the-loop queue after max iterations'
        : 'Log error and halt',
    nextState: loopType === 'Turn-based' ? 'Await User Input' : 'Halt',
  }

  const steps: ExecutionStep[] = sequence.map((action, i) => ({
    step: i + 1,
    action: action.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
    description: action,
    status: 'PENDING' as const,
  }))

  return { config, objective, steps }
}

/** Render loop config as the markdown schema from the docs. */
export function formatConfigMarkdown(config: LoopConfiguration, objective: string): string {
  return `### [Loop Configuration]
- **Loop_Type**: ${config.loopType}
- **Trigger**: ${config.trigger}
- **Objective**: ${objective}

### [Execution Sequence]
${config.executionSequence.map((s, i) => `${i + 1}. ${s}`).join('\n')}

### [Validation & Constraints]
- **Definition_of_Done (DoD)**: ${config.definitionOfDone}
- **Max_Iterations**: ${config.maxIterations}
- **Fallback_Protocol**: ${config.fallbackProtocol}

### [Post-Execution]
- **Next_State**: ${config.nextState}`
}
