import { Component, createRef, useEffect, useRef, type ErrorInfo, type ReactNode } from 'react'

export function RouteChunkLoading() {
  const statusRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    statusRef.current?.focus()
  }, [])

  return (
    <div
      ref={statusRef}
      role="status"
      tabIndex={-1}
      className="mx-auto flex min-h-[40vh] w-full max-w-lg items-center justify-center px-4 text-sm text-neutral-500 outline-none"
    >
      正在載入頁面…
    </div>
  )
}

type RouteChunkBoundaryState = { error: Error | null }

export class RouteChunkBoundary extends Component<
  { children: ReactNode },
  RouteChunkBoundaryState
> {
  state: RouteChunkBoundaryState = { error: null }
  private readonly fallbackRef = createRef<HTMLDivElement>()

  static getDerivedStateFromError(error: Error): RouteChunkBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('route chunk failed to load', { error, componentStack: info.componentStack })
  }

  componentDidUpdate(_: { children: ReactNode }, previous: RouteChunkBoundaryState) {
    if (!previous.error && this.state.error) this.fallbackRef.current?.focus()
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div
        ref={this.fallbackRef}
        role="alert"
        tabIndex={-1}
        className="mx-auto flex min-h-[40vh] w-full max-w-lg flex-col items-start justify-center gap-3 px-4 outline-none"
      >
        <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">頁面載入失敗</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          主要對話仍可使用。你可以返回首頁，或重新載入此頁面。
        </p>
        <div className="flex flex-wrap gap-2">
          <a className="rounded-md border px-3 py-2 text-sm" href="#/">回到主要對話</a>
          <button
            className="rounded-md border px-3 py-2 text-sm"
            type="button"
            onClick={() => window.location.reload()}
          >
            重新載入
          </button>
        </div>
      </div>
    )
  }
}
