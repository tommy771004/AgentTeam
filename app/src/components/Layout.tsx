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
import { PiHostStatusPill } from './PiHostStatusPill'
// Vite-bundled brand mark (always in the JS asset graph — no public/ relative-path 404)
import brandIconUrl from '../assets/subagents-icon-64.png'

type NavItem = { to: string; label: string; icon: string; end?: boolean }
type NavGroup = { title: string; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  {
    title: '執行',
    items: [
      { to: '/', label: '新任務', icon: 'auto_awesome', end: true },
      { to: '/subdesign', label: 'SubDesign', icon: 'palette' },
      { to: '/dashboard', label: '系統總覽', icon: 'dashboard' },
      { to: '/learning?tab=plugins', label: '擴充', icon: 'extension' },
    ],
  },
  {
    title: '自動化',
    items: [
      { to: '/automation', label: '定時與事件', icon: 'schedule' },
      { to: '/content-publishing', label: '內容發布', icon: 'campaign' },
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
  if (path === '/subdesign') {
    return pathname === '/subdesign' || pathname.startsWith('/subdesign/') || pathname === '/design-systems' || pathname.startsWith('/design-systems/')
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
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth < 760
  })
  const floatOpen = useWorkspaceUiStore((s) => s.floatOpen)
  const setFloatOpen = useWorkspaceUiStore((s) => s.setFloatOpen)
  const setLayoutMode = useWorkspaceUiStore((s) => s.setLayoutMode)
  const setShowRunPanel = useThreadStore((s) => s.setShowRunPanel)
  const selectThread = useThreadStore((s) => s.selectThread)
  const runningThreadIds = useThreadStore((s) => s.runningThreadIds)
  useGlobalShortcuts()
  const bridge = useMemo(() => getElectronBridgeStatus(), [])
  const isMac = useIsMacDesktop()
  const primaryKey = isMac ? '⌘' : 'Ctrl+'
  const platformLabel = isMac ? 'macOS' : 'Windows'

  const openLiveRun = () => {
    navigate('/')
    if (runningThreadIds[0]) selectThread(runningThreadIds[0])
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
      {/* 左側主選單 — quiet material sidebar */}
      <aside
        className={`sidebar-panel relative z-50 drag-region material-sidebar flex flex-col shrink-0 transition-[width] duration-300 ease-out ${
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
          className={`flex items-center gap-2.5 px-3 border-b border-line no-drag ${
            isMac ? 'h-11' : 'h-12'
          }`}
        >
          <img
            src={brandIconUrl}
            alt="SubAgents AI"
            width={32}
            height={32}
            className="w-8 h-8 shrink-0 object-contain"
            draggable={false}
            onError={(e) => {
              // Fallback to public/ brand pack (dev + packaged dist/brand)
              const img = e.currentTarget
              if (img.dataset.fallback === '1') return
              img.dataset.fallback = '1'
              img.src = `${import.meta.env.BASE_URL}brand/subagents-icon-64.png`
            }}
          />
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
                          ? 'bg-hover text-on-surface border-transparent'
                          : 'text-on-surface-variant hover:bg-hover-2 hover:text-on-surface border-transparent'
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

        <div className="no-drag border-t border-line p-2 space-y-2">
          <PiHostStatusPill collapsed={collapsed} />
          {(isRunning || agentStatus === 'running') && (
            <button
              type="button"
              onClick={openLiveRun}
              title="開啟新任務右側 Run 面板"
              className="w-full flex items-center gap-2 rounded-control px-2.5 py-2 text-xs font-semibold text-primary bg-primary/10 border border-primary/25 hover:bg-primary/15 text-left"
            >
              <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
              {!collapsed && '執行中…'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="w-full flex items-center justify-center gap-1 rounded-lg py-2 text-outline hover:bg-hover-2 hover:text-on-surface text-xs"
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
          <header className="h-11 shrink-0 border-b border-line bg-surface flex items-center justify-between px-4 drag-region">
            <div className="no-drag text-xs text-on-surface-variant pl-2 md:pl-0 truncate max-[760px]:hidden">
              本機多代理 · {primaryKey}/ 指令 · {primaryKey}. 小視窗
            </div>
            <div className="no-drag flex items-center gap-2">
              <button
                type="button"
                title={`開啟指令選單（${primaryKey}/）`}
                onClick={() => requestFocusComposer({ openSlash: true })}
                className="shrink-0 whitespace-nowrap text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-line text-on-surface-variant hover:text-on-surface hover:border-line-strong font-[family-name:var(--font-mono)]"
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
                className={`shrink-0 whitespace-nowrap text-xs font-semibold px-2.5 py-1.5 rounded-lg border flex items-center gap-1 ${
                  floatOpen
                    ? 'border-primary/40 text-primary bg-primary/10'
                    : 'border-line text-on-surface-variant hover:text-on-surface hover:border-line-strong'
                }`}
              >
                <Icon name="picture_in_picture_alt" size={14} />
                {floatOpen ? '小視窗 · 開' : '小視窗'}
              </button>
              <NavLink
                to="/settings"
                className="shrink-0 whitespace-nowrap text-xs font-semibold tracking-wide px-3 py-1.5 rounded-lg border border-line text-on-surface-variant hover:text-on-surface hover:border-line-strong"
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
