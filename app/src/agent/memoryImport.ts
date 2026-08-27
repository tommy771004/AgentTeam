import type { MemoryImportApplyInput, MemoryImportMode, MemoryImportPreview, MemoryImportResult } from '../../electron/durableMemoryImport.ts'

export type MemoryImportBridge = {
  previewImport(input: { bundle: unknown; mode: MemoryImportMode }): Promise<MemoryImportPreview>
  applyImport(input: Omit<MemoryImportApplyInput, 'access'>): Promise<MemoryImportResult>
}
export type MemoryImportView = {
  phase: 'empty' | 'previewing' | 'ready' | 'applying' | 'failed' | 'applied'
  mode: MemoryImportMode
  preview?: MemoryImportPreview
  canApply: boolean
  message: string
}

/** Disposable preview state. The Host alone validates and commits memory. */
export class MemoryImportSession {
  private readonly bridge?: MemoryImportBridge
  private readonly onApplied: (revision: number) => Promise<void>
  private view: MemoryImportView = { phase: 'empty', mode: 'skip', canApply: false, message: '' }
  private bundle: unknown
  private input?: Omit<MemoryImportApplyInput, 'access'>
  private generation = 0

  constructor(bridge: MemoryImportBridge | undefined, onApplied: (revision: number) => Promise<void>) {
    this.bridge = bridge
    this.onApplied = onApplied
  }

  snapshot(): MemoryImportView { return structuredClone(this.view) }

  cancel(): void {
    if (this.view.phase === 'applying') return
    this.generation += 1
    this.bundle = undefined
    this.input = undefined
    this.view = { phase: 'empty', mode: 'skip', canApply: false, message: '已關閉匯入預覽，不會送出新的套用請求。' }
  }

  async select(json: string): Promise<void> {
    if (this.view.phase === 'applying') return
    this.cancel()
    try {
      if (new TextEncoder().encode(json).byteLength > 16 * 1024 * 1024) throw new Error('匯入檔超過 16 MiB 上限。')
      const parsed = JSON.parse(json)
      this.bundle = parsed?.canonicalMemory !== undefined ? parsed.canonicalMemory : parsed
      await this.changeMode('skip')
    } catch (error) {
      this.view = { phase: 'failed', mode: 'skip', canApply: false, message: this.errorMessage(error) }
    }
  }

  async selectFile(file: { size: number; text(): Promise<string> }): Promise<void> {
    if (this.view.phase === 'applying') return
    this.cancel()
    const generation = this.generation
    this.view = { phase: 'previewing', mode: 'skip', canApply: false, message: '正在讀取備份，尚未寫入。' }
    try {
      if (file.size > 16 * 1024 * 1024) throw new Error('匯入檔超過 16 MiB 上限。')
      const json = await file.text()
      if (generation !== this.generation) return
      await this.select(json)
    } catch (error) {
      if (generation === this.generation) this.view = { phase: 'failed', mode: 'skip', canApply: false, message: this.errorMessage(error) }
    }
  }

  async changeMode(mode: MemoryImportMode): Promise<void> {
    if (this.view.phase === 'applying' || this.bundle === undefined) return
    const generation = ++this.generation
    this.input = undefined
    this.view = { phase: 'previewing', mode, canApply: false, message: 'Host 正在預覽，尚未寫入。' }
    try {
      if (!this.bridge) throw new Error('目前執行環境不支援 Host 記憶匯入；不會回寫 legacy memory。')
      const preview = await this.bridge.previewImport({ bundle: this.bundle, mode })
      if (generation !== this.generation) return
      const canApply = preview.counts.invalid === 0 && preview.counts.quota === 0
      this.input = { bundle: this.bundle, mode, operationId: crypto.randomUUID(), previewId: preview.previewId, expectedRevision: preview.revision }
      this.view = { phase: 'ready', mode, preview, canApply, message: canApply ? '確認以下影響後才會寫入。' : '請修正 invalid／quota 錯誤後重新選檔。' }
    } catch (error) {
      if (generation === this.generation) this.view = { phase: 'failed', mode, canApply: false, message: this.errorMessage(error) }
    }
  }

  async apply(): Promise<void> {
    if (!this.input || !this.bridge || !this.view.canApply || this.view.phase === 'applying') return
    this.view = { ...this.view, phase: 'applying', canApply: false, message: 'Host 正在原子套用…' }
    try {
      const result = await this.bridge.applyImport(this.input)
      this.view = { ...this.view, phase: 'applied', canApply: false, message: result.alreadyApplied ? '此 operation 已完成，沒有重複寫入。' : `已匯入 ${result.changed} 筆；revision ${result.revision}。` }
      this.input = undefined
      try { await this.onApplied(result.revision) } catch { this.view.message += ' 投影更新失敗，請重新整理記憶列表。' }
    } catch (error) {
      this.view = { ...this.view, phase: 'failed', canApply: true, message: `${this.errorMessage(error)} 可用相同 operation 重試；若記憶已變動，請重新預覽。` }
    }
  }

  private errorMessage(error: unknown): string {
    return `記憶匯入失敗：${error instanceof Error ? error.message : String(error)}`
  }
}
