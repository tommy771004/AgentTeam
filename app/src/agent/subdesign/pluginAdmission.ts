/**
 * Task-run admission for plugin contract execution.
 * Every plugin-triggered Task run must be validated through the single
 * authoritative parser before dispatch.
 */
import { type PluginContractResult } from '../openDesign/pluginContract.ts'

export type ContractAdmissionResult =
  | { admitted: true; contract: Extract<PluginContractResult, { ok: true }> }
  | { admitted: false; reason: string; contract: PluginContractResult; field?: string }

export function admitPluginForTaskRun(contract: PluginContractResult): ContractAdmissionResult {
  if (!contract.ok) {
    return { admitted: false, reason: contract.reason, contract, field: contract.field }
  }
  // Legacy and v1-compatible both admitted; incompatible already rejected.
  return { admitted: true, contract }
}

/** Human-readable admission message for UI. */
export function admissionDisplay(result: ContractAdmissionResult): string {
  if (result.admitted) {
    return result.contract.kind === 'legacy' ? '已採用 legacy 契約（相容）' : `已採用 v${result.contract.manifest.specVersion} 契約`
  }
  return result.reason
}
