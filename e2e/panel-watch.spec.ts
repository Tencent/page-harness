/// <reference lib="dom" />
import { expect, test } from '@playwright/test'

const NOAGENT = 'http://127.0.0.1:17986'

test.describe('panel liveness', () => {
  test('a control port that never answers leaves the review chip, then recovers when it comes back', async ({ page }) => {
    let block = true
    await page.route(/:17987\/__ph\/ui/, (route) => (block ? route.abort() : route.continue()))
    await page.goto(`${NOAGENT}/`)
    const pick = page.locator('page-harness-root .bar button[data-act="pick"]')
    const who = page.locator('page-harness-root [data-testid="review-host"]')
    await expect(pick).toBeDisabled()
    await expect(who).toContainText('Lost connection to Page Harness', { timeout: 20_000 })
    await expect(pick).toBeDisabled()
    await expect(pick).not.toHaveAttribute('data-tip', /./)

    block = false
    await expect(pick).toBeEnabled({ timeout: 25_000 })
    await expect(who).toContainText('127.0.0.1:5179')
    await expect(who).not.toContainText('Lost connection')
  })
})