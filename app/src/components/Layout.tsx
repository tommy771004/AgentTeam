import { useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Icon } from './Icon'
import { PermissionAskPanel } from './PermissionAskModal'
import { FloatingConsole } from './FloatingConsole'
import { useWorkspaceUiStore } from '../store/workspaceUiStore'
import { useThreadStore } from '../store/threadStore'
import { useGlobalShortcuts } from '../hooks/useGlobalShortcuts'
import { requestFocusComposer } from '../store/commandHistoryStore'
import { getElectronBridgeStatus } from '../lib/electronBridge'
import { PiHostStatusPill } from './PiHostStatusPill'
import { RunCompletionToasts } from './primitives/RunCompletionToasts'
import { useRunCompletionNotices } from '../hooks/useRunCompletionNotices'

type NavItem = { to: string; label: string; icon: string; end?: boolean }
type NavGroup = { title: string; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  {
    title: '執行',
    items: [
      { to: '/', label: 'AgentChat', icon: 'auto_awesome', end: true },
      { to: '/subdesign', label: 'AgentDesign', icon: 'palette' },
      { to: '/dashboard', label: 'SystemOverview', icon: 'dashboard' },
      { to: '/learning?tab=plugins', label: '擴充', icon: 'extension' },
    ],
  },
  {
    title: '自動化',
    items: [
      // Redirected automation routes share this single Ops Console entry.
      { to: '/ops', label: 'Ops Console', icon: 'monitoring' },
      { to: '/content-publishing', label: '內容發布', icon: 'campaign' },
    ],
  },
  {
    title: '資料',
    items: [
      { to: '/knowledge', label: '知識圖譜', icon: 'hub' },

    ],
  },
  {
    title: '紀錄',
    items: [
      { to: '/usage', label: '用量統計', icon: 'monitoring' },
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
  if (path === '/subdesign') {
    return pathname === '/subdesign' || pathname.startsWith('/subdesign/')
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

function SidebarCollapseButton({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const label = collapsed ? '展開側邊欄' : '收合側邊欄'
  return (
    <div className={`no-drag flex h-10 shrink-0 items-center px-2 ${collapsed ? 'justify-center' : 'justify-between'}`}>
      {!collapsed && <span className="min-w-0 truncate px-1.5 text-[13px] font-semibold tracking-tight text-on-surface">AgentStudio</span>}
      <button
        type="button"
        onClick={onToggle}
        title={label}
        aria-label={label}
        aria-expanded={!collapsed}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-outline transition-colors hover:bg-hover-2 hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="2.75" y="3.25" width="18.5" height="17.5" rx="3.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M16.25 4.25V19.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}

export function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth < 760
  })
  const floatOpen = useWorkspaceUiStore((s) => s.floatOpen)
  const setFloatOpen = useWorkspaceUiStore((s) => s.setFloatOpen)
  const setLayoutMode = useWorkspaceUiStore((s) => s.setLayoutMode)
  const setShowRunPanel = useThreadStore((s) => s.setShowRunPanel)
  const selectThread = useThreadStore((s) => s.selectThread)
  useGlobalShortcuts()
  // Shell-level completion reachability: a run that ends while the user is
  // elsewhere still reaches them, on every route including the bare shell.
  const { notices, dismiss } = useRunCompletionNotices()
  const bridge = useMemo(() => getElectronBridgeStatus(), [])
  const isMac = useIsMacDesktop()
  const primaryKey = isMac ? '⌘' : 'Ctrl+'

  const openCompletedRun = (notice: { runId: string; threadId?: string }) => {
    navigate('/')
    if (notice.threadId) selectThread(notice.threadId)
    setShowRunPanel(true)
    // Acting on the card is the end of its job; leaving it over the thread it
    // just opened would only cover the answer the user came to read.
    dismiss(notice.runId)
  }

  const completionToasts = (
    <RunCompletionToasts notices={notices} onDismiss={dismiss} onOpen={openCompletedRun} />
  )

  const bareShell =
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
        {completionToasts}
      </div>
    )
  }

  return (
    <div className="h-full flex bg-background text-on-background overflow-hidden">
      {/* 左側主選單 — liquid glass sidebar */}
      <aside
        className={`sidebar-panel relative z-50 drag-region material-sidebar flex flex-col shrink-0 transition-[width] duration-200 ease-out ${
          collapsed ? 'w-[60px]' : 'w-[216px]'
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
        <SidebarCollapseButton collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />
        <nav className="flex-1 overflow-y-auto custom-scrollbar no-drag py-3 px-2 space-y-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="stagger-children">
              {!collapsed && (
                <p className="px-2.5 mb-1 text-[11px] font-medium text-outline/90">
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
                      aria-current={active ? 'page' : undefined}
                      className={`macos-nav-item sidebar-nav-row ${collapsed ? 'justify-center' : ''} ${
                        active ? 'is-active' : ''
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

      </aside>

      {/* 右側內容 */}
      <div className="relative z-10 flex-1 flex flex-col min-w-0 min-h-0">
        {/*
          首頁沒有功能頂欄，仍保留一條可靠的視窗拖曳帶；其餘頁面由
          下方 titlebar 的整個非互動區負責拖曳。
        */}
        {isHome && <div className="page-window-drag-strip drag-region h-5 shrink-0" aria-hidden />}
        {/* 首頁（新任務）隱藏頂欄，更接近 Codex 沉浸式 */}
        {!isHome && (
          <header className="app-window-titlebar h-11 shrink-0 border-b border-line bg-surface flex items-center justify-between px-4 drag-region">
            <div className="flex flex-1 self-stretch items-center truncate pl-2 text-xs text-on-surface-variant md:pl-0 max-[760px]:hidden">
              本機多代理 · {primaryKey}/ 指令 · {primaryKey}. 小視窗
            </div>
            <div className="no-drag flex items-center gap-1">
              <button
                type="button"
                title={`開啟指令選單（${primaryKey}/）`}
                onClick={() => requestFocusComposer({ openSlash: true })}
                className="shrink-0 min-h-8 whitespace-nowrap rounded-lg bg-transparent px-2.5 py-1.5 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-hover-2 hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 font-[family-name:var(--font-mono)]"
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
                aria-pressed={floatOpen}
                className={`shrink-0 min-h-8 whitespace-nowrap rounded-lg bg-transparent px-2.5 py-1.5 text-xs font-semibold transition-colors flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 ${
                  floatOpen
                    ? 'text-primary bg-primary/10'
                    : 'text-on-surface-variant hover:bg-hover-2 hover:text-on-surface'
                }`}
              >
                <Icon name="picture_in_picture_alt" size={14} />
                {floatOpen ? '小視窗 · 開' : '小視窗'}
              </button>
              <NavLink
                to="/settings"
                className={({ isActive }) => `shrink-0 min-h-8 whitespace-nowrap rounded-lg bg-transparent px-3 py-1.5 text-xs font-semibold tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 ${
                  isActive
                    ? 'bg-hover text-on-surface'
                    : 'text-on-surface-variant hover:bg-hover-2 hover:text-on-surface'
                }`}
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
        <div className="shrink-0 px-3">
          <PermissionAskPanel unscoped />
        </div>
        <footer
          className="app-status-bar no-drag flex h-7 shrink-0 items-center justify-end border-t border-line bg-surface/90"
          aria-label="應用程式狀態"
        >
          <PiHostStatusPill />
        </footer>
        <FloatingConsole />
        {completionToasts}
      </div>
    </div>
  )
}
