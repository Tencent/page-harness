import { describe, expect, it } from 'vitest'
import { PANEL_GRACE_MS, PANEL_RETRY_MS, panelWatchAdvance, panelWatchDelay, panelWatchIdle } from './panel-watch'

describe('panel watch', () => {
  it('reloads once while the control document is up, then reports it down', () => {
    const first = panelWatchAdvance(panelWatchIdle(), true)
    expect(first.reload).toBe(true)
    expect(first.downNow).toBe(false)
    expect(first.state).toEqual({ down: false, misses: 1 })
    expect(panelWatchDelay(first.state)).toBe(PANEL_GRACE_MS)

    const second = panelWatchAdvance(first.state, true)
    expect(second.reload).toBe(true)
    expect(second.downNow).toBe(true)
    expect(second.state.down).toBe(true)
    expect(panelWatchDelay(second.state)).toBe(PANEL_RETRY_MS)

    const again = panelWatchAdvance(second.state, true)
    expect(again.downNow).toBe(false)
  })

  it('reports the control port down immediately when its document never arrives', () => {
    const step = panelWatchAdvance(panelWatchIdle(), false)
    expect(step).toMatchObject({ reload: true, downNow: true, state: { down: true, misses: 0 } })
    expect(panelWatchAdvance(step.state, false).downNow).toBe(false)
  })
})