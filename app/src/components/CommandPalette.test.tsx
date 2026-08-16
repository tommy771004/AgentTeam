import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { usePaletteStore } from '../store/paletteStore'
import { CommandPalette } from './CommandPalette'

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

function renderPalette() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<><CommandPalette /><LocationProbe /></>} />
        <Route path="/settings" element={<LocationProbe />} />
        <Route path="/subdesign" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

function openPalette() {
  act(() => {
    usePaletteStore.getState().setOpen(true)
  })
}

afterEach(() => {
  act(() => {
    usePaletteStore.getState().setOpen(false)
  })
})

describe('CommandPalette', () => {
  it('open 時顯示並聚焦輸入；Esc 關閉', async () => {
    const user = userEvent.setup()
    renderPalette()
    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument()

    openPalette()
    const input = screen.getByLabelText('搜尋指令')
    await waitFor(() => expect(input).toHaveFocus())

    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument()
  })

  it('模糊過濾：查「llm」可找到設定語言模型節條目', async () => {
    const user = userEvent.setup()
    renderPalette()
    openPalette()
    await user.type(screen.getByLabelText('搜尋指令'), 'llm')
    expect(screen.getByTestId('palette-entry-settings:llm')).toBeInTheDocument()
    expect(screen.queryByTestId('palette-entry-subdesign')).not.toBeInTheDocument()
  })

  it('鍵盤導航：↓ 移動選擇、Enter 執行導航條目', async () => {
    const user = userEvent.setup()
    renderPalette()
    openPalette()
    const input = screen.getByLabelText('搜尋指令')

    await user.type(input, 'subdesign')
    const entry = screen.getByTestId('palette-entry-subdesign')
    expect(entry.className).toContain('bg-primary/10')

    await user.keyboard('{Enter}')
    expect(screen.getByTestId('location')).toHaveTextContent('/subdesign')
    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument()
  })

  it('設定節條目 Enter 跳轉深連結（?section=）', async () => {
    const user = userEvent.setup()
    renderPalette()
    openPalette()
    await user.type(screen.getByLabelText('搜尋指令'), 'settings:llm')
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('location')).toHaveTextContent('/settings?section=llm')
  })
})
