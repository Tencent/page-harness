import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { adoptDraft, proposeVariants, renderPropose } from '../lib/propose.js'

const html = '<button class="go">提交</button>'
const two = [
  { label: '更大的标题', style: 'font-size: 28px' },
  { label: '换成行动句', text: '立即提交' },
]

describe('proposeVariants', () => {
  it('keeps 2 to 4 copy, style, or image variants and does not touch a project', () => {
    const p = proposeVariants({ selector: 'form button.go', url: 'http://127.0.0.1:5173/', html, variants: two })
    assert.equal(p.ok, true)
    assert.equal(p.kind, 'page-harness-propose')
    assert.equal(p.selector, 'form button.go')
    assert.deepEqual(p.variants, [
      { index: 1, label: '更大的标题', style: 'font-size: 28px' },
      { index: 2, label: '换成行动句', text: '立即提交' },
    ])
    assert.match(renderPropose(p), /不要改文件/)
    assert.match(renderPropose(p), /采用/)
  })

  it('accepts a style object and an image src', () => {
    const p = proposeVariants({
      selector: 'img.hero',
      variants: [
        { label: '放大', style: { 'font-size': '20px', color: ' #333 ' } },
        { label: '换图', image: '/hero.png' },
        { label: '留白', style: 'padding: 24px' },
      ],
    })
    assert.equal(p.variants[0].style, 'font-size: 20px; color: #333')
    assert.equal(p.variants[1].image, '/hero.png')
  })

  it('rejects a missing selector, a lone variant, and an empty variant', () => {
    assert.throws(() => proposeVariants({ variants: two }), /selector/)
    assert.throws(() => proposeVariants({ selector: 'a', variants: [two[0]] }), /2 to 4/)
    assert.throws(() => proposeVariants({ selector: 'a', variants: [{ label: '空' }, two[1]] }), /text, style, or image/)
    assert.throws(() => proposeVariants({ selector: 'a', variants: [two[0], two[1], two[0], two[1], two[0]] }), /2 to 4/)
    assert.throws(() => proposeVariants({ selector: 's'.repeat(501), variants: two }), /too long/)
  })

  it('keeps a long stylesheet and drops style keys that are not CSS properties', () => {
    const p = proposeVariants({
      selector: 'h1',
      variants: [
        { label: '长', style: 'a'.repeat(9000) },
        { label: '坏键', style: { 'font size': '20px', color: 'red', '<x>': 'y' } },
      ],
    })
    assert.equal(p.variants[0].style.length, 8000)
    assert.equal(p.variants[1].style, 'color: red')
  })
})

describe('adoptDraft', () => {
  it('quotes the element and asks for that one variant in source', () => {
    const p = proposeVariants({ selector: 'form button.go', url: 'http://127.0.0.1:5173/', html, variants: two })
    const draft = adoptDraft(p, 2)
    assert.match(draft, /<page-element url="http:\/\/127\.0\.0\.1:5173\/" selector="form button\.go" tag="button" text="提交"><\/page-element>/)
    assert.doesNotMatch(draft, /<button/)
    assert.match(draft, /<page-variant index="2" label="换成行动句">\n文案：立即提交\n<\/page-variant>/)
    assert.match(draft, /采用第 2 版「换成行动句」/)
    assert.match(draft, /page_harness_preview/)
    const visible = draft.replace(/<page-variant\b[\s\S]*?<\/page-variant>/g, '').replace(/<page-element\b[\s\S]*?<\/page-element>/g, '')
    assert.doesNotMatch(visible, /文案：/)
    assert.doesNotMatch(visible, /样式：/)
    assert.match(draft, /不要再提交新的候选/)
    assert.equal(adoptDraft(p, 9), '')
  })

  it('escapes the attributes and does not put the element html in the composer', () => {
    const p = proposeVariants({
      selector: 'a[href="x"]',
      url: 'http://127.0.0.1:5173/?a=1&b=2',
      html: '<a href="x">A & B</a>',
      variants: two,
    })
    const draft = adoptDraft(p, 1)
    assert.match(draft, /selector="a\[href=&quot;x&quot;\]"/)
    assert.match(draft, /url="http:\/\/127\.0\.0\.1:5173\/\?a=1&amp;b=2"/)
    assert.match(draft, /tag="a"/)
    assert.match(draft, /text="A &amp; B"/)
    assert.match(draft, /<page-element [^>]*><\/page-element>/)
    assert.doesNotMatch(draft, /<a href/)
  })

  it('hides a stylesheet inside the variant card', () => {
    const css = 'body {\n  background: radial-gradient(ellipse 75% 60% at 50% 38%, #1d1810 0%, #0b0906 58%, #050504 100%);\n}\n.page { color: #f4eee1 }'
    const p = proposeVariants({
      selector: 'section.intro',
      url: 'http://127.0.0.1:5173/',
      html: '<section class="intro">封面</section>',
      variants: [
        { label: '黑金封面', style: css },
        { label: '另一版', text: '你好' },
      ],
    })
    const draft = adoptDraft(p, 1)
    assert.match(draft, /<page-variant index="1" label="黑金封面">/)
    assert.match(draft, /样式：body \{\n {2}background: radial-gradient/)
    const visible = draft.replace(/<page-variant\b[\s\S]*?<\/page-variant>/g, '').replace(/<page-element\b[\s\S]*?<\/page-element>/g, '')
    assert.doesNotMatch(visible, /background/)
    assert.doesNotMatch(visible, /样式：/)
    assert.match(visible, /采用第 1 版「黑金封面」/)
  })

  it('matches the copy the chat card uses', () => {
    const lib = readFileSync(new URL('../lib/propose.js', import.meta.url), 'utf8')
    const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
    assert.equal(functionBody(client, 'adoptDraft'), functionBody(lib, 'adoptDraft'))
    assert.match(client, /key: "page_harness_propose"/)
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
