import type {
  SubDesignPluginExecutionProjection,
  SubDesignPluginExecutionRequest,
} from '../src/agent/subdesign/pluginExecution.ts'
import type { PluginInputValues } from '../src/agent/subdesign/pluginInputs.ts'
import { fakePipelineProvider } from '../src/agent/subdesign/providers/fakePipelineProvider.ts'
import {
  DEFAULT_OUTPUT_BUDGET_BYTES,
  type ProviderEvidence,
  type ProviderExecutionReceipt,
  type ProviderId,
} from '../src/agent/subdesign/providers/providerContract.ts'
import { executeChromeDevToolsEvidenceAdapter } from './subDesignChromeDevToolsAdapter.ts'
import { executeHarnessGoalAdapter } from './subDesignHarnessAdapter.ts'
import type { ProviderAttachmentPayload } from './subDesignProviderAttachments.ts'
import { executeStorybookContextAdapter } from './subDesignStorybookAdapter.ts'

export type SubDesignProviderAdapterResult = {
  receipt: ProviderExecutionReceipt
  evidence: readonly ProviderEvidence[]
  context?: SubDesignPluginExecutionProjection['context']
  findings?: SubDesignPluginExecutionProjection['findings']
  goalResult?: SubDesignPluginExecutionProjection['goalResult']
  attachments?: ProviderAttachmentPayload[]
  partial?: boolean
}

export type SubDesignProviderAdapterInput = {
  request: SubDesignPluginExecutionRequest
  runId: string
  threadId: string
  projectRoot: string
  signal: AbortSignal
  timeoutMs: number
  atoms: string[]
  inputs: PluginInputValues
  onProgress: (summary: string) => void
}

export type SubDesignProviderAdapter = {
  providerId: ProviderId
  execute: (input: SubDesignProviderAdapterInput) => Promise<SubDesignProviderAdapterResult>
}

const adapters = new Map<ProviderId, SubDesignProviderAdapter>([
  ['storybook', {
    providerId: 'storybook',
    execute: executeStorybookContextAdapter,
  }],
  ['chrome-devtools', {
    providerId: 'chrome-devtools',
    execute: executeChromeDevToolsEvidenceAdapter,
  }],
  ['harness', {
    providerId: 'harness',
    execute: executeHarnessGoalAdapter,
  }],
  ['fake-pipeline', {
    providerId: 'fake-pipeline',
    execute: async (input) => {
      const session = fakePipelineProvider.execute({
        stageId: input.request.stageId,
        atoms: input.atoms,
        inputs: input.inputs,
      }, {
        runId: input.runId,
        stageId: input.request.stageId,
        threadId: input.threadId,
        timeoutMs: input.timeoutMs,
        outputBudgetBytes: input.request.outputBudgetBytes ?? DEFAULT_OUTPUT_BUDGET_BYTES,
        signal: input.signal,
      })
      const [receipt, evidence] = await Promise.all([session.promise, session.evidence])
      return { receipt, evidence }
    },
  }],
])

export function resolveSubDesignProviderAdapter(providerId: ProviderId): SubDesignProviderAdapter | null {
  return adapters.get(providerId) || null
}

export function isSubDesignProviderAvailable(providerId: ProviderId): boolean {
  return adapters.has(providerId)
}
