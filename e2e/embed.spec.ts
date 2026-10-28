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

  test('the host can apply a candidate on the page, peek the original, and hear navigations', async ({ page }) => {
    await up(`${EMBED}/__ph/overlay.js`)
    await page.goto('/')
    await page.evaluate(() => {
      const nav: number[] = []
      const locations: string[] = []
      const bag = window as unknown as { __nav: number[]; __locs: string[] }
      bag.__nav = nav
      bag.__locs = locations
      window.addEventListener('message', (e) => {
        const d = e.data as { source?: string; type?: string; index?: number; url?: string } | null
        if (!d || d.source !== 'page-harness') return
        if (d.type === 'ph:candidate-nav' && typeof d.index === 'number') nav.push(d.index)
        if (d.type === 'ph:location' && d.url) locations.push(d.url)
      })
      const frame = document.createElement('iframe')
      frame.id = 'ph-embed'
      frame.src = 'http://localhost:17990/'
      frame.style.cssText = 'position:fixed;left:0;top:0;width:900px;height:640px;border:0;z-index:1;background:#fff'
      document.body.appendChild(frame)
    })
    const frame = page.frameLocator('#ph-embed')
    const title = frame.locator('.hero-title')
    await expect(title).toHaveText('Hello fixture')
    await expect(frame.locator('page-harness-root .bar button[data-act="pick"]')).toBeEnabled()

    const post = (message: unknown) => page.evaluate((msg) => {
      const child = document.querySelector<HTMLIFrameElement>('#ph-embed')
      child?.contentWindow?.postMessage(msg, 'http://localhost:17990')
    }, message)
    await post({
      source: 'page-harness-host',
      type: 'ph:candidate',
      selector: '.hero-title',
      index: 1,
      variants: [
        { index: 1, label: 'Bigger', text: 'Hello candidate', style: 'font-size: 40px' },
        { index: 2, label: 'Quiet', text: 'Hello quiet', style: 'font-size: 16px' },
      ],
    })

    const bar = frame.locator('[data-ph-candidate-bar]')
    await expect(title).toHaveText('Hello candidate')
    await expect(title).toHaveCSS('font-size', '40px')
    await expect(bar).toContainText('1/2')
    await expect(bar).toContainText('Bigger')

    await bar.getByRole('button', { name: '›' }).click()
    await expect(title).toHaveText('Hello quiet')
    await expect(title).toHaveCSS('font-size', '16px')
    await expect.poll(() => page.evaluate(() => (window as unknown as { __nav: number[] }).__nav)).toEqual([2])

    const original = bar.getByRole('button', { name: 'Original' })
    await original.dispatchEvent('pointerdown')
    await expect(title).toHaveText('Hello fixture')
    await original.dispatchEvent('pointerup')
    await expect(title).toHaveText('Hello quiet')

    await post({ source: 'page-harness-host', type: 'ph:candidate', clear: true })
    await expect(bar).toHaveCount(0)
    await expect(title).toHaveText('Hello fixture')
    await expect(title).toHaveCSS('font-size', '28px')

    await frame.locator('#about-link').click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __locs: string[] }).__locs.at(-1) ?? '')).toContain('/about')
  })
})
