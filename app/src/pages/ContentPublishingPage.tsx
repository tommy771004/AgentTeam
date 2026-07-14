import { useEffect, useMemo, useState } from 'react'
import {
  CONTENT_PUBLISH_PROVIDERS,
  type ContentPublishConnectionStatus,
  type ContentPublishPlatform,
} from '../agent/contentPublishPlatforms'
import { Icon } from '../components/Icon'
import { settingsInputCls } from '../components/settings/SettingsChrome'
import { useContentItemStore } from '../store/contentItemStore'
import { useContentPublishStore } from '../store/contentPublishStore'

const PLATFORMS = CONTENT_PUBLISH_PROVIDERS

function defaultScheduleTime() {
  const date = new Date(Date.now() + 60 * 60 * 1_000)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function formatScheduleTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function ContentPublishingPage() {
  const items = useContentItemStore((state) => state.items)
  const createItem = useContentItemStore((state) => state.createItem)
  const schedules = useContentPublishStore((state) => state.schedules)
  const createSchedule = useContentPublishStore((state) => state.createSchedule)
  const publishSchedule = useContentPublishStore((state) => state.publishSchedule)
  const [contentItemId, setContentItemId] = useState('')
  const [newItemId, setNewItemId] = useState('')
  const [newItemTitle, setNewItemTitle] = useState('')
  const [newItemBody, setNewItemBody] = useState('')
  const [newItemMediaUrl, setNewItemMediaUrl] = useState('')
  const [newItemMediaPath, setNewItemMediaPath] = useState('')
  const [newItemTargetId, setNewItemTargetId] = useState('')
  const [newItemPrivacyStatus, setNewItemPrivacyStatus] = useState<'private' | 'public' | 'unlisted'>('private')
  const [platform, setPlatform] = useState<ContentPublishPlatform>('instagram')
  const [scheduledAt, setScheduledAt] = useState(defaultScheduleTime)
  const [publishingId, setPublishingId] = useState<string | null>(null)
  const [oauthStatuses, setOauthStatuses] = useState<ContentPublishConnectionStatus[]>([])
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [oauthBusy, setOauthBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const selectedStatus = oauthStatuses.find((item) => item.platform === platform)

  useEffect(() => {
    const api = window.subagents?.contentPublishing
    if (api) void api.status().then(setOauthStatuses)
  }, [])

  useEffect(() => {
    if (!contentItemId && items[0]) setContentItemId(items[0].id)
  }, [contentItemId, items])

  const sortedSchedules = useMemo(
    () => [...schedules].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)),
    [schedules],
  )

  const onSubmit = () => {
    if (!contentItemId) {
      setFeedback({ kind: 'error', text: '請先建立並選擇 ContentItem。' })
      return
    }
    const date = new Date(scheduledAt)
    if (Number.isNaN(date.getTime())) {
      setFeedback({ kind: 'error', text: '請輸入有效的排程時間。' })
      return
    }

    const result = createSchedule(
      {
        contentItemId,
        platform,
        scheduledAt: date.toISOString(),
      },
      { id: `publish_${Date.now().toString(36)}` },
    )
    if (!result.ok) {
      setFeedback({ kind: 'error', text: result.error.message })
      return
    }

    setFeedback({ kind: 'success', text: '已建立內容發布排程。' })
    setContentItemId('')
  }

  const onCreateItem = () => {
    const result = createItem({
      id: newItemId,
      title: newItemTitle,
      body: newItemBody,
      mediaUrl: newItemMediaUrl,
      mediaPath: newItemMediaPath,
      targetId: newItemTargetId,
      privacyStatus: newItemPrivacyStatus,
    })
    if (!result.ok) {
      setFeedback({ kind: 'error', text: result.error.message })
      return
    }
    setContentItemId(result.item.id)
    setNewItemId('')
    setNewItemTitle('')
    setNewItemBody('')
    setNewItemMediaUrl('')
    setNewItemMediaPath('')
    setNewItemTargetId('')
    setNewItemPrivacyStatus('private')
    setFeedback({ kind: 'success', text: `已建立 ContentItem：${result.item.title}` })
  }

  const onPublish = async (scheduleId: string) => {
    const schedule = schedules.find((item) => item.id === scheduleId)
    const content = schedule && items.find((item) => item.id === schedule.contentItemId)
    if (!schedule || !content) {
      setFeedback({ kind: 'error', text: '找不到排程對應的 ContentItem，未執行發布。' })
      return
    }
    setPublishingId(scheduleId)
    const result = await publishSchedule(scheduleId, {
      title: content.title,
      body: content.body,
      mediaUrl: content.mediaUrl,
      mediaPath: content.mediaPath,
      mediaMimeType: content.mediaMimeType,
      targetId: content.targetId,
      privacyStatus: content.privacyStatus,
    })
    setPublishingId(null)
    setFeedback({
      kind: result.ok ? 'success' : 'error',
      text: result.ok ? '平台發布成功。' : result.message,
    })
  }

  const onOAuth = async () => {
    if (!window.subagents?.contentPublishing?.oauth) {
      setFeedback({ kind: 'error', text: '目前不是 Electron 執行環境，無法啟動 OAuth。' })
      return
    }
    setOauthBusy(true)
    const result = await window.subagents.contentPublishing.oauth({ platform, clientId, clientSecret })
    setOauthBusy(false)
    setClientSecret('')
    if (!result.ok) {
      setFeedback({ kind: 'error', text: result.error })
      return
    }
    setOauthStatuses((current) => [...current.filter((item) => item.platform !== platform), result.status])
    setFeedback({ kind: 'success', text: `${result.status.label} OAuth 已完成，Token 已保存於主程序 vault。` })
  }

  const onDisconnect = async () => {
    if (!window.subagents?.contentPublishing?.disconnect) return
    await window.subagents.contentPublishing.disconnect(platform)
    setOauthStatuses((current) => current.map((item) => item.platform === platform ? { ...item, connected: false, accountId: undefined, accountLabel: undefined } : item))
    setFeedback({ kind: 'success', text: `${platform} 已解除授權。` })
  }

  return (
    <div className="h-full overflow-y-auto custom-scrollbar p-4 md:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-5">
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-primary">
            <Icon name="campaign" size={20} />
            <span className="text-[11px] font-semibold tracking-[0.18em] uppercase">Content publishing</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">內容發布排程</h1>
          <p className="text-sm text-on-surface-variant max-w-2xl">
            同一個 ContentItem 在同一平台的 24 小時內只能建立一筆排程。OAuth 與平台 API 都在 Electron 主程序執行，前端只收到狀態與發布結果。
          </p>
          <p className="text-xs text-secondary">發布狀態：排程不等於已發布 · Instagram/YouTube 需要媒體，Facebook 預設使用授權帳號第一個 Page。</p>
        </header>

        <section className="app-panel p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Icon name="lock" size={18} className="text-primary" />
            <h2 className="font-semibold text-sm">平台 OAuth 授權</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold tracking-widest text-on-surface-variant">平台</span>
              <select className={settingsInputCls} value={platform} onChange={(event) => setPlatform(event.target.value as ContentPublishPlatform)}>
                {PLATFORMS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold tracking-widest text-on-surface-variant">CLIENT ID（可用環境變數）</span>
              <input className={settingsInputCls} value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="Client ID" autoComplete="off" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold tracking-widest text-on-surface-variant">CLIENT SECRET（不會保存於前端）</span>
              <input className={settingsInputCls} type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} placeholder="Client Secret" autoComplete="new-password" />
            </label>
          </div>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="text-xs text-on-surface-variant">
              {selectedStatus?.connected ? `已連線${selectedStatus.accountLabel ? `：${selectedStatus.accountLabel}` : ''} · ${selectedStatus.encrypted ? '已加密保存' : '未使用 OS 加密'}` : '尚未連線。請先在平台開發者後台註冊回呼： http://127.0.0.1:19789/oauth/callback'}
            </div>
            <div className="flex gap-2">
              {selectedStatus?.connected && <button type="button" onClick={() => void onDisconnect()} className="px-3 py-2 rounded-lg border border-error/50 text-error text-xs font-semibold">解除授權</button>}
              <button type="button" onClick={() => void onOAuth()} disabled={oauthBusy} className="px-4 py-2 rounded-lg bg-primary-container text-on-primary-container text-xs font-semibold disabled:opacity-50">
                {oauthBusy ? '等待瀏覽器授權…' : selectedStatus?.connected ? '重新授權' : '開始 OAuth'}
              </button>
            </div>
          </div>
        </section>

        <section className="app-panel p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Icon name="article" size={18} className="text-secondary" />
            <h2 className="font-semibold text-sm">建立 ContentItem</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold tracking-widest text-on-surface-variant">CONTENTITEM ID</span>
              <input className={settingsInputCls} value={newItemId} onChange={(event) => setNewItemId(event.target.value)} placeholder="例如 content_item_001" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold tracking-widest text-on-surface-variant">標題</span>
              <input className={settingsInputCls} value={newItemTitle} onChange={(event) => setNewItemTitle(event.target.value)} placeholder="內容標題" />
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold tracking-widest text-on-surface-variant">內容（選填）</span>
            <textarea className={`${settingsInputCls} min-h-[76px] resize-y`} value={newItemBody} onChange={(event) => setNewItemBody(event.target.value)} placeholder="發布內容或之後交由 adapter 處理的正文" />
          </label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold tracking-widest text-on-surface-variant">圖片 URL（Instagram）</span>
              <input className={settingsInputCls} value={newItemMediaUrl} onChange={(event) => setNewItemMediaUrl(event.target.value)} placeholder="https://…/image.jpg" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold tracking-widest text-on-surface-variant">影片檔案路徑（YouTube）</span>
              <input className={settingsInputCls} value={newItemMediaPath} onChange={(event) => setNewItemMediaPath(event.target.value)} placeholder="C:\\videos\\launch.mp4" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold tracking-widest text-on-surface-variant">Page ID（Facebook，可選）</span>
              <input className={settingsInputCls} value={newItemTargetId} onChange={(event) => setNewItemTargetId(event.target.value)} placeholder="未填使用第一個 Page" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold tracking-widest text-on-surface-variant">YouTube 隱私狀態</span>
              <select className={settingsInputCls} value={newItemPrivacyStatus} onChange={(event) => setNewItemPrivacyStatus(event.target.value as typeof newItemPrivacyStatus)}>
                <option value="private">私人（預設）</option>
                <option value="unlisted">不公開列出</option>
                <option value="public">公開</option>
              </select>
            </label>
          </div>
          <button type="button" onClick={onCreateItem} className="self-end px-4 py-2 rounded-lg border border-secondary/50 text-secondary text-xs font-semibold hover:bg-secondary/10">
            建立 ContentItem
          </button>
        </section>

        <section className="app-panel p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Icon name="add_task" size={18} className="text-primary" />
            <h2 className="font-semibold text-sm">建立發布排程</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold tracking-widest text-on-surface-variant">CONTENTITEM ID</span>
              <select
                className={settingsInputCls}
                value={contentItemId}
                onChange={(event) => setContentItemId(event.target.value)}
                disabled={items.length === 0}
              >
                {items.length === 0 ? <option value="">請先建立 ContentItem</option> : items.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.id}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold tracking-widest text-on-surface-variant">平台</span>
              <select className={settingsInputCls} value={platform} onChange={(event) => setPlatform(event.target.value as typeof platform)}>
                {PLATFORMS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold tracking-widest text-on-surface-variant">排程時間</span>
              <input
                className={settingsInputCls}
                type="datetime-local"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
              />
            </label>
          </div>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div aria-live="polite" className={`text-xs ${feedback?.kind === 'error' ? 'text-error' : 'text-primary'}`}>
              {feedback?.text || '建立前會重新檢查最新排程狀態。'}
            </div>
            <button
              type="button"
              onClick={onSubmit}
              className="self-end px-4 py-2 rounded-lg bg-primary-container text-on-primary-container text-xs font-semibold flex items-center gap-1.5"
            >
              <Icon name="schedule_send" size={16} />
              建立排程
            </button>
          </div>
        </section>

        <section className="app-panel overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
            <Icon name="event_note" size={18} className="text-secondary" />
            <h2 className="font-semibold text-sm">已建立排程（{sortedSchedules.length}）</h2>
          </div>
          {sortedSchedules.length === 0 ? (
            <p className="p-8 text-center text-sm text-on-surface-variant">尚無內容發布排程。</p>
          ) : (
            <div className="divide-y divide-white/5">
              {sortedSchedules.map((schedule) => (
                <div key={schedule.id} className="px-4 py-3 flex flex-col md:flex-row md:items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-sm truncate">{schedule.contentItemId}</span>
                      <span className="text-[10px] rounded bg-secondary/15 text-secondary px-1.5 py-0.5 uppercase">{schedule.platform}</span>
                      <span className={`text-[10px] rounded px-1.5 py-0.5 ${schedule.status === 'published' ? 'bg-primary/15 text-primary' : schedule.status === 'failed' ? 'bg-error/15 text-error' : 'bg-white/10 text-outline'}`}>
                        {schedule.status === 'published' ? '已發布' : schedule.status === 'publishing' ? '發布中' : schedule.status === 'failed' ? '發布失敗' : '已排程'}
                      </span>
                    </div>
                    <p className="text-[11px] text-outline mt-1">排程：{formatScheduleTime(schedule.scheduledAt)}</p>
                    {schedule.lastError && <p className="text-[11px] text-error mt-1">{schedule.lastError}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={schedule.status === 'published' || publishingId === schedule.id}
                      onClick={() => void onPublish(schedule.id)}
                      className="px-3 py-1.5 rounded border border-primary/40 text-primary text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {publishingId === schedule.id ? '發布中…' : schedule.status === 'failed' ? '重試發布' : schedule.status === 'published' ? '已完成' : '執行發布'}
                    </button>
                    <code className="text-[10px] text-outline font-[family-name:var(--font-mono)]">{schedule.id}</code>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
