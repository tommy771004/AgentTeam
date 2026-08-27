import type { CapabilityUnlockProvenance } from '../agent/capabilities/runtime'
import { useThreadStore } from '../store/threadStore'
import { Icon } from './Icon'

const PROVENANCE_ZH: Record<CapabilityUnlockProvenance, string> = {
  'always-on': '預設常駐',
  preloaded: '預先載入',
  load_capability: 'load_capability',
  tool_search: 'tool_search',
  'progressive-off': '未啟用漸進揭露',
  restored: '跨輪還原',
}

function provenanceZh(value?: CapabilityUnlockProvenance): string {
  return value ? PROVENANCE_ZH[value] : '跨輪還原'
}

export function ThreadCapabilityDiagnostics() {
  const activeId = useThreadStore((state) => state.activeId)
  const thread = useThreadStore((state) => state.threads.find((item) => item.id === state.activeId))
  const resetLastCapabilities = useThreadStore((state) => state.resetLastCapabilities)

  if (!thread || !activeId) return null

  const capabilities = thread.lastCapabilityIds || []
  const tools = thread.lastUnlockedTools || []
  const hasDiagnostics = capabilities.length > 0 || tools.length > 0

  return (
    <details className="relative shrink-0">
      <summary
        className="sidebar-icon-button cursor-pointer list-none [&::-webkit-details-marker]:hidden"
        aria-label="查看目前對話的 run diagnostics"
        title="Run diagnostics"
      >
        <Icon name="info" size={17} />
      </summary>
      <div className="absolute right-0 top-9 z-40 w-[min(82vw,360px)] rounded-[10px] bg-surface-container-high p-3 text-left shadow-[0_6px_14px_rgba(0,0,0,0.2)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[12px] font-semibold text-ink">Run diagnostics</div>
            <div className="mt-0.5 text-[10px] text-ink-3">上一輪 Pi Host run · cross-run restore</div>
          </div>
          {hasDiagnostics && (
            <button
              type="button"
              className="rounded-[6px] px-2 py-1 text-[11px] text-error hover:bg-red-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary/55"
              onClick={() => resetLastCapabilities(activeId)}
            >
              重置
            </button>
          )}
        </div>
        <dl className="mt-3 space-y-2 text-[11px] leading-relaxed">
          <div>
            <dt className="font-semibold text-ink-2">Capabilities</dt>
            <dd className="mt-0.5 break-words text-ink-3">
              {capabilities.length
                ? capabilities
                    .map((id) => `${id}（${provenanceZh(thread.lastCapabilityProvenance?.[id])}）`)
                    .join('、')
                : '無'}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-ink-2">Unlocked tools</dt>
            <dd className="mt-0.5 break-words text-ink-3">
              {tools.length
                ? tools
                    .map((name) => `${name}（${provenanceZh(thread.lastUnlockedToolProvenance?.[name])}）`)
                    .join('、')
                : '無'}
            </dd>
          </div>
        </dl>
      </div>
    </details>
  )
}
