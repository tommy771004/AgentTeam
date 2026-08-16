import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// globals: false 時 RTL 不會自動 cleanup，須明確掛
afterEach(cleanup)

// jsdom 沒有 matchMedia；元件測試中還原 reduced-motion 查詢的最低需求
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}

// jsdom 沒有實作 scrollIntoView；元件用它把鍵盤選中的項目捲進視野，
// 測試環境補一個 no-op 就好——這是 jsdom 的缺口，不是產品行為。
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {}
}
