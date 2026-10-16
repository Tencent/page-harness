/// <reference lib="dom" />
import { expect, test } from '@playwright/test'

const EMBED = 'http://localhost:17990'

async function up(url: string) {
  await expect.poll(async () => (await fetch(url).catch(() => null))?.status ?? 0, { timeout: 25_000 }).toBe(200)
}

test.describe('embedded preview', () => {
  test('an allowed parent can frame the page, and a quote comes back to that parent', async ({ page }) => {
    await up(`${EMBED}/__ph/overlay.js`)
    await page.goto('/')
    await page.evaluate(() => {
      const quotes: unknown[] = []
      ;(window as unknown as { __quotes: unknown[] }).__quotes = quotes
      window.addEventListener('message', (e) => {
        const d = e.data as { source?: string; type?: string; pick?: unknown } | null
        if (d && d.source === 'page-harness' && d.type === 'ph:quote') quotes.push(d.pick)
      })
      const frame = document.createElement('iframe')
      frame.id = 'ph-embed'
      frame.src = 'http://localhost:17990/'
      frame.style.cssText = 'position:fixed;left:0;top:0;width:900px;height:640px;border:0;z-index:1;background:#fff'
      document.body.appendChild(frame)
    })
    const frame = page.frameLocator('#ph-embed')
    const quote = frame.locator('page-harness-root .bar button[data-act="pick"]')
    await expect(frame.locator('.hero-title')).toHaveText('Hello fixture')
    await expect(quote).toBeEnabled()
    await expect(frame.locator('page-harness-root .bar button[data-act="chat"]')).toBeHidden()

    await quote.click()
    const box = (await frame.locator('.hero-title').boundingBox())!
    await page.mouse.click(box.x + 20, box.y + box.height / 2)
    await frame.locator('page-harness-root [data-testid="pick-quote"]').click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __quotes: { text?: string; selector?: string }[] }).__quotes.map((q) => `${q.selector} ${q.text}`))).toEqual([expect.stringContaining('hero-title Hello fixture')])
  })
})
