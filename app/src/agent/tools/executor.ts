/**
 * Tool I/O helpers re-export (compat).
 * Builtin tool dispatch is registry-only via registered/* handlers + dispatchRegistered.
 * Do not reintroduce executeTool(tool) switch here.
 */

export type { ToolResult, ToolExecutionContext } from './toolIoHelpers.ts'
export {
  memory,
  recordRewindSnapshot,
  formatSearch,
  browserWebSearch,
  browserHttpFetch,
  applyGitSettingsToBash,
} from './toolIoHelpers.ts'
