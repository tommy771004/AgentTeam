import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { settingsPath } from '../../commands/settingsSections'
import { fieldAnchorId, searchSettingsFields } from '../../settings/fieldRegistry'
import { SettingsSearch } from './SettingsSearch'

function renderSearch() {
  const onJump = vi.fn()
  render(<SettingsSearch policyAdminBuild={false} onJump={onJump} />)
  return { onJump, input: screen.getByRole('combobox', { name: '搜尋設定' }) }
}

describe('設定搜尋', () => {
  it('沒輸入時不顯示結果清單（不一開啟就洗版）', () => {
    renderSearch()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('中文與英文關鍵字都找得到同一個欄位', async () => {
    const user = userEvent.setup()
    const { input } = renderSearch()
    await user.type(input, '字級')
    expect(screen.getByRole('listbox')).toHaveTextContent('介面字級')

    await user.clear(input)
    await user.type(input, 'font size')
    expect(screen.getByRole('listbox')).toHaveTextContent('介面字級')
  })

  it('結果標示所屬節，進階欄位帶「進階」標記', async () => {
    const user = userEvent.setup()
    const { input } = renderSearch()
    await user.type(input, '半透明')
    const list = screen.getByRole('listbox')
    expect(list).toHaveTextContent('側欄半透明')
    expect(list).toHaveTextContent('外觀')
    expect(list).toHaveTextContent('進階')
  })

  it('點擊命中項回報要跳去哪個欄位', async () => {
    const user = userEvent.setup()
    const { onJump, input } = renderSearch()
    await user.type(input, '主題')
    await user.click(screen.getByRole('option', { name: /外觀主題/ }))
    expect(onJump).toHaveBeenCalledTimes(1)
    expect(onJump.mock.calls[0][0].field.id).toBe('appearance.theme')
  })

  it('鍵盤：↑↓ 移動、Enter 跳轉，全程不碰滑鼠', async () => {
    const user = userEvent.setup()
    const { onJump, input } = renderSearch()
    await user.type(input, '字級')
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowDown}')
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowUp}')
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{Enter}')
    expect(onJump).toHaveBeenCalledTimes(1)
  })

  it('↓ 在最後一項會繞回第一項，不會選到不存在的條目', async () => {
    const user = userEvent.setup()
    const { input } = renderSearch()
    await user.type(input, '字級')
    const count = screen.getAllByRole('option').length
    for (let i = 0; i < count; i += 1) await user.keyboard('{ArrowDown}')
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('Esc 收起結果清單', async () => {
    const user = userEvent.setup()
    const { input } = renderSearch()
    await user.type(input, '字級')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('查無結果時明講，而不是留一個空白清單', async () => {
    const user = userEvent.setup()
    const { input } = renderSearch()
    await user.type(input, 'zzzzzzzzz')
    expect(screen.getByRole('listbox')).toHaveTextContent('沒有符合的設定')
  })
})

describe('欄位深連結', () => {
  it('settingsPath 可帶欄位，供橫幅 CTA／palette／文件連過來', () => {
    expect(settingsPath('llm')).toBe('/settings?section=llm')
    expect(settingsPath('appearance', 'appearance.theme')).toBe(
      '/settings?section=appearance&field=appearance.theme',
    )
  })

  it('錨點是合法 CSS 選擇器，querySelector 找得到', () => {
    const hit = searchSettingsFields('主題', { policyAdminBuild: false })[0]
    const anchor = fieldAnchorId(hit.field.id)
    expect(anchor).not.toContain('.')
    // 不會拋 SyntaxError 才算真的可用
    expect(() => document.querySelector(`#${anchor}`)).not.toThrow()
  })
})
