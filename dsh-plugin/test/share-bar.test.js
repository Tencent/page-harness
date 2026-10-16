import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { shareLinkOf, shareSwitchChecked, shareSwitchOn } from '../lib/share-bar.js'

const running = { running: true, shareUrl: 'http://10.0.0.8:17991/__ph/join?t=abc' }

describe('share switch', () => {
  it('stays off and has no link until a preview is running', () => {
    assert.equal(shareSwitchOn(null), false)
    assert.equal(shareLinkOf(null), '')
    assert.equal(shareSwitchChecked(null, false), false)
    assert.equal(shareSwitchOn({ starting: true }), true)
    assert.equal(shareLinkOf({ starting: true, shareUrl: running.shareUrl }), '')
    assert.equal(shareLinkOf({ running: true }), '')
  })

  it('opens the invite link only while sharing is up', () => {
    assert.equal(shareSwitchOn(running), true)
    assert.equal(shareLinkOf(running), running.shareUrl)
    assert.equal(shareSwitchChecked(running, false), true)
  })

  it('moves the thumb to the side the user just chose while the request is in flight', () => {
    assert.equal(shareSwitchChecked(running, true), false)
    assert.equal(shareSwitchChecked(null, true), true)
    assert.equal(shareLinkOf(running), running.shareUrl)
  })

  it('keeps the dock copy of the switch identical, and the new tab opens that link', () => {
    const lib = readFileSync(new URL('../lib/share-bar.js', import.meta.url), 'utf8')
    const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
    for (const name of ['shareSwitchOn', 'shareLinkOf', 'shareSwitchChecked']) {
      assert.equal(functionBody(client, name), functionBody(lib, name))
    }
    assert.match(client, /role: "switch"/)
    assert.match(client, /const shareLink = shareLinkOf\(share\)/)
    assert.match(client, /disabled: !shareLink/)
    assert.match(client, /window\.open\(shareLink, "_blank", "noopener"\)/)
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
