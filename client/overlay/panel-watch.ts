// The dock stays on "Panel is loading…" until the control iframe finishes its handshake.
// This decides when that wait has gone on long enough to treat the control port as down.

export const PANEL_GRACE_MS = 6_000
export const PANEL_RETRY_MS = 8_000

export interface PanelWatchState {
  down: boolean
  misses: number
}

export const panelWatchIdle = (): PanelWatchState => ({ down: false, misses: 0 })

/**
 * One check while the panel is still not ready.
 * `loaded` means the control document arrived. A miss then reloads the iframe so it can announce again.
 * No document means the control port is not answering.
 */
export function panelWatchAdvance(state: PanelWatchState, loaded: boolean): { state: PanelWatchState; reload: boolean; downNow: boolean } {
  if (!loaded) {
    return { state: { down: true, misses: state.misses }, reload: true, downNow: !state.down }
  }
  const misses = state.misses + 1
  const down = misses >= 2
  return { state: { down, misses }, reload: true, downNow: down && !state.down }
}

export function panelWatchDelay(state: PanelWatchState): number {
  return state.down ? PANEL_RETRY_MS : PANEL_GRACE_MS
}
