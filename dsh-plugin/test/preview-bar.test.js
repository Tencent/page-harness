import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { shownAddress } from '../lib/preview-bar.js'

describe('shownAddress', () => {
  it('prefers the URL the iframe has navigated to', () => {
    assert.equal(
      shownAddress('http://localhost:17994/', 'http://localhost:17994/about', '5173'),
      'http://localhost:17994/about',
    )
  })

  it('shows the iframe URL before the page reports a navigation', () => {
    assert.equal(shownAddress('http://localhost:17994/', '', 'http://127.0.0.1:5173/'), 'http://localhost:17994/')
  })

  it('hides the embed token URL and falls back to the label', () => {
    const embed = 'http://localhost:17994/__ph/embed?t=secret&next=%2F'
    assert.equal(shownAddress(embed, '', 'index.html'), 'index.html')
    assert.equal(shownAddress('', '', ''), '')
  })
})

describe('preview chrome', () => {
  const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

  it('keeps the address helper in sync, and shows that address only in the bar', () => {
    assert.equal(functionBody(client, 'shownAddress'), functionBody(readFileSync(new URL('../lib/preview-bar.js', import.meta.url), 'utf8'), 'shownAddress'))
    assert.equal(functionBody(client, 'PreviewTabTitle').replace(/\s+/g, ' '), 'function PreviewTabTitle() { useDshLang(); return tr("preview"); }')
    assert.match(client, /title: \(\) => isZh\(\) \? "预览" : "Preview"/)
    assert.doesNotMatch(client, /liveAddress/)
    assert.doesNotMatch(client, /phd-switch/)
    assert.match(client, /className: "phd-url phd-grow phd-ellipsis"/)
  })

  it('leaves older candidate cards inert and hides the status line while the pane is open', () => {
    assert.match(client, /aria-disabled": "true"/)
    assert.match(client, /const alreadyShown = !!showing && previewOpen && !buttons\.length && !error/)
    assert.match(client, /hasWork && !alreadyShown \? h\("div", \{ className: "phd-tail" \}/)
    assert.match(client, /type: "ph:candidate"/)
    assert.match(client, /ProposeToolView\(\) \{\s*\/\/[\s\S]*?return null;\s*\}/)
  })
})

function functionBody(src, name) {
  const start = src.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, name)
  let depth = 0
  let seen = false
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') {
      depth++
      seen = true
    } else if (src[i] === '}') {
      depth--
      if (seen && depth === 0) return src.slice(start, i + 1).replace(/\s+/g, ' ')
    }
  }
  assert.fail(`unclosed ${name}`)
}
