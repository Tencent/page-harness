// Contract between overlay.js and the lazily loaded page-control.js / live-overlay.js.
import type { Lang, LiveDisplay, LiveSession, PageCmd, PageResult, Theme, ToPanel } from '@shared/protocol'

export interface PageHost {
  /** Overlay shadow root; lazily loaded modules render into `layer`. */
  root: ShadowRoot
  layer: HTMLElement
  hostEl: HTMLElement
  send(msg: ToPanel): void
  toast(level: 'ok' | 'warn', text: string): void
  lang(): Lang
  theme(): Theme
  /** Hides all Page Harness UI (while the page is being read or captured). */
  setUiHidden(hidden: boolean): void
  setEye(visible: boolean): void
  setPicking(on: boolean): void
  isOwn(el: Element | null): boolean
  /** True without source (review mode): Live candidates are page changes. */
  patchMode(): boolean
}

export interface PageControlModule {
  version: number
  run(cmd: PageCmd, signal: AbortSignal): Promise<PageResult>
  dispose(): void
}

export interface LiveModule {
  version: number
  setSessions(sessions: LiveSession[]): void
  nav(sid: string, current?: number, display?: LiveDisplay): void
  /** Insert mode takes over the click; otherwise the dock shows its action bar. */
  onPick(el: Element): boolean
  /** Opens the Live request card for an element. */
  design(el: Element): void
  setPicking(on: boolean): void
  setLang(lang: Lang): void
  eye(kind: 'down' | 'up' | 'click'): void
  dispose(): void
}

declare global {
  interface Window {
    __PH_CONFIG?: {
      controlOrigin: string
      appPort?: number
      /** Proxied site host (`example.com` or `localhost:5173`). Absent for the bookmarklet. */
      target?: string
      relay?: string | null
      /** Pick and Notes only: no chat, artifacts, Live or page control. */
      noAgent?: boolean
      /** Injected into an arbitrary page. Talks to the control server directly. */
      bookmarklet?: boolean
      /** Sent as X-PH-Token. Present only in the bookmarklet. */
      token?: string
      /** Startup `--lang`. When set, the dock stays in this language. */
      lang?: Lang
      /** `--embed-origin`: parent windows allowed to frame the page and receive quoted elements. */
      embed?: string[]
    }
    __phRelay?: boolean
    __phHost?: PageHost
    __phPageControl?: PageControlModule
    __phLive?: LiveModule
    __phOverlay?: boolean
  }
}
