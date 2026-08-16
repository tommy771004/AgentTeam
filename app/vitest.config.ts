import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// 獨立於 vite.config.ts（後者掛 electron 插件，測試環境不需要）
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
})
