import { create } from 'zustand'

/** Command Palette 開合狀態（ticket 10）——由全域快捷鍵與元件共用 */
interface PaletteStore {
  open: boolean
  setOpen: (v: boolean) => void
}

export const usePaletteStore = create<PaletteStore>((set) => ({
  open: false,
  setOpen: (v) => set({ open: v }),
}))
