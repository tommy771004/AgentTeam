import { useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Icon } from './Icon'
import { useAgentStore } from '../store/agentStore'
import { FloatingConsole } from './FloatingConsole'
import { useWorkspaceUiStore } from '../store/workspaceUiStore'
import { useThreadStore } from '../store/threadStore'
import { useGlobalShortcuts } from '../hooks/useGlobalShortcuts'
import { requestFocusComposer } from '../store/commandHistoryStore'
import { getElectronBridgeStatus } from '../lib/electronBridge'

type NavItem = { to: string; label: string; icon: string; end?: boolean }
type NavGroup = { title: string; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  {
    title: '執行',
    items: [
      { to: '/', label: '新任務', icon: 'auto_awesome', end: true },
      { to: '/dashboard', label: '系統總覽', icon: 'dashboard' },
      { to: '/learning?tab=plugins', label: '擴充', icon: 'extension' },
    ],
  },
  {
    title: '自動化',
    items: [
      { to: '/automation', label: '定時與事件', icon: 'schedule' },
    ],
  },
  {
    title: '資料',
    items: [
      { to: '/knowledge', label: '知識圖譜', icon: 'hub' },
      { to: '/learning', label: '學習中心', icon: 'school' },
    ],
  },
  {
    title: '紀錄',
    items: [
      { to: '/records', label: '封存與日誌', icon: 'history' },
    ],
  },
  {
    title: '系統',
    items: [
      { to: '/docs', label: '文件說明', icon: 'menu_book' },
      { to: '/settings', label: '設定', icon: 'settings' },
    ],
  },
]

function navItemActive(to: string, pathname: string, search: string, end?: boolean): boolean {
  const [path, query = ''] = to.split('?')
  if (end) return pathname === path || pathname === ''
  if (path === '/learning' && query.includes('tab=plugins')) {
    return pathname === '/learning' && new URLSearchParams(search).get('tab') === 'plugins'
  }
  if (path === '/learning' && !query) {
    // 學習中心：plugins 分頁時改亮「擴充」
    if (pathname !== '/learning') return false
    return new URLSearchParams(search).get('tab') !== 'plugins'
  }
  return pathname === path || pathname.startsWith(`${path}/`)
}

/** macOS hiddenInset: leave room for traffic lights (close / min / max) */
function useIsMacDesktop() {
  return useMemo(() => {
    if (typeof navigator === 'undefined') return false
    return (
      /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ||
      /Mac OS X/i.test(navigator.userAgent)
    )
  }, [])
}

export function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const isRunning = useAgentStore((s) => s.isRunning)
  const agentStatus = useAgentStore((s) => s.agent.status)
  const [collapsed, setCollapsed] = useState(false)
  const floatOpen = useWorkspaceUiStore((s) => s.floatOpen)
  const setFloatOpen = useWorkspaceUiStore((s) => s.setFloatOpen)
  const setLayoutMode = useWorkspaceUiStore((s) => s.setLayoutMode)
  const setShowRunPanel = useThreadStore((s) => s.setShowRunPanel)
  const selectThread = useThreadStore((s) => s.selectThread)
  const runningThreadId = useThreadStore((s) => s.runningThreadId)
  useGlobalShortcuts()
  const bridge = useMemo(() => getElectronBridgeStatus(), [])
  const isMac = useIsMacDesktop()
  const primaryKey = isMac ? '⌘' : 'Ctrl+'
  const platformLabel = isMac ? 'macOS' : 'Windows'

  const openLiveRun = () => {
    navigate('/')
    if (runningThreadId) selectThread(runningThreadId)
    setShowRunPanel(true)
  }

  const bareShell =
    location.pathname.startsWith('/execution') ||
    location.pathname.startsWith('/success') ||
    location.pathname.startsWith('/failed')

  const isHome = location.pathname === '/' || location.pathname === ''

  if (bareShell) {
    return (
      <div className="h-full flex flex-col bg-background text-on-background">
        {!bridge.bridgeReady && bridge.detail && (
          <div className="shrink-0 px-3 py-2 text-[11px] bg-amber-500/15 text-amber-100 border-b border-amber-500/30">
            <strong className="font-semibold">{bridge.label}：</strong> {bridge.detail}
          </div>
        )}
        <Outlet />
        <FloatingConsole />
      </div>
    )
  }

  return (
    <div className="h-full flex bg-background text-on-background overflow-hidden">
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="ambient-orb absolute top-[-12%] left-[-12%] w-[42%] h-[42%] bg-secondary/12 blur-[130px] rounded-full" />
        <div
          className="ambient-orb absolute bottom-[-22%] right-[-12%] w-[52%] h-[52%] bg-primary/8 blur-[160px] rounded-full"
          style={{ animationDelay: '-6s' }}
        />
      </div>

      {/* 左側主選單 — macOS sidebar material */}
      <aside
        className={`sidebar-panel relative z-50 drag-region material-sidebar flex flex-col shrink-0 transition-[width] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
          collapsed ? 'w-[68px]' : 'w-[212px]'
        }`}
      >
        {/*
          macOS traffic lights (● ● ●) sit in the top-left of hiddenInset windows.
          Reserve a pure drag strip above the logo so they never stack on the icon.
        */}
        {isMac && (
          <div
            className="mac-traffic-spacer shrink-0 w-full drag-region"
            style={{ height: 38 }}
            aria-hidden
          />
        )}
        <div
          className={`flex items-center gap-2.5 px-3 border-b border-white/[0.06] no-drag ${
            isMac ? 'h-11' : 'h-12'
          }`}
        >
          <div className="w-8 h-8 rounded-[10px] bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0 shadow-[0_0_20px_rgba(43,184,217,0.15)]">
            <Icon name="hub" size={18} className="text-primary" filled />
          </div>
          {!collapsed && (
            <div className="min-w-0 animate-macos-fade">
              <div className="font-[family-name:var(--font-sora)] font-semibold text-primary text-[13px] tracking-tight truncate">
                SubAgents
              </div>
              <div className="text-[10px] text-outline truncate tracking-wide">
                Multi-agent · {platformLabel}
              </div>
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto custom-scrollbar no-drag py-3 px-2 space-y-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="stagger-children">
              {!collapsed && (
                <p className="px-2.5 mb-1.5 text-[10px] font-semibold tracking-[0.14em] text-outline/90 uppercase">
                  {group.title}
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = navItemActive(
                    item.to,
                    location.pathname,
                    location.search,
                    item.end,
                  )
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      title={item.label}
                      className={`macos-nav-item flex items-center gap-2.5 rounded-[11px] px-2.5 py-2 text-[13px] border ${
                        active
                          ? 'bg-primary/14 text-primary border-primary/25 shadow-[0_0_20px_rgba(43,184,217,0.12)]'
                          : 'text-on-surface-variant hover:bg-white/[0.06] hover:text-on-surface border-transparent'
                      }`}
                    >
                      <Icon name={item.icon} size={20} />
                      {!collapsed && (
                        <span className="font-medium truncate tracking-tight">{item.label}</span>
                      )}
                    </NavLink>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="no-drag border-t border-white/10 p-2 space-y-2">
          {(isRunning || agentStatus === 'running') && (
            <button
              type="button"
              onClick={openLiveRun}
              title="開啟新任務右側 Run 面板"
              className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold text-primary bg-primary/10 border border-primary/30 hover:bg-primary/15 text-left"
            >
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />
              {!collapsed && '執行中…'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="w-full flex items-center justify-center gap-1 rounded-lg py-2 text-outline hover:bg-white/5 hover:text-on-surface text-xs"
          >
            <Icon name={collapsed ? 'chevron_right' : 'chevron_left'} size={18} />
            {!collapsed && '收合選單'}
          </button>
        </div>
      </aside>

      {/* 右側內容 */}
      <div className="relative z-10 flex-1 flex flex-col min-w-0 min-h-0">
        {/* 首頁（新任務）隱藏頂欄，更接近 Codex 沉浸式 */}
        {!isHome && (
          <header className="h-11 shrink-0 border-b border-white/8 bg-surface/30 backdrop-blur-sm flex items-center justify-between px-4 drag-region">
            <div className="no-drag text-xs text-on-surface-variant pl-2 md:pl-0 truncate">
              本機多代理 · {primaryKey}/ 指令 · {primaryKey}. 小視窗
            </div>
            <div className="no-drag flex items-center gap-2">
              <button
                type="button"
                title={`開啟指令選單（${primaryKey}/）`}
                onClick={() => requestFocusComposer({ openSlash: true })}
                className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-white/10 text-on-surface-variant hover:text-primary hover:border-primary/30 font-[family-name:var(--font-mono)]"
              >
                /
              </button>
              <button
                type="button"
                title={floatOpen ? '關閉小視窗' : `小視窗（${primaryKey}.）`}
                onClick={() => {
                  if (floatOpen) {
                    setFloatOpen(false)
                    setLayoutMode('full')
                  } else {
                    setLayoutMode('float')
                    setFloatOpen(true)
                  }
                }}
                className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border flex items-center gap-1 ${
                  floatOpen
                    ? 'border-primary/40 text-primary bg-primary/10'
                    : 'border-white/10 text-on-surface-variant hover:text-primary hover:border-primary/30'
                }`}
              >
                <Icon name="picture_in_picture_alt" size={14} />
                {floatOpen ? '小視窗 · 開' : '小視窗'}
              </button>
              <NavLink
                to="/settings"
                className="text-xs font-semibold tracking-wide px-3 py-1.5 rounded-lg border border-white/10 text-on-surface-variant hover:text-primary hover:border-primary/30"
              >
                設定
              </NavLink>
            </div>
          </header>
        )}
        {!bridge.bridgeReady && bridge.detail && (
          <div className="shrink-0 no-drag px-3 py-2 text-[11px] leading-snug bg-amber-500/15 text-amber-100 border-b border-amber-500/30">
            <strong className="font-semibold">{bridge.label}：</strong> {bridge.detail}
          </div>
        )}
        <main className="flex-1 min-h-0 overflow-hidden">
          <Outlet />
        </main>
        <FloatingConsole />
      </div>
    </div>
  )
}
