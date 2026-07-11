/// <reference types="vite/client" />

import type { SubAgentsAPI } from '../electron/preload'

declare global {
  interface Window {
    subagents?: SubAgentsAPI
  }
}

export {}
