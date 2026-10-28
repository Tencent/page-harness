/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest'
import { applyCandidateContent, candidateCss, restoreCandidateElement } from './candidate'

describe('candidateCss', () => {
  it('scopes declarations to the element and does not double !important', () => {
    expect(candidateCss('font-size: 28px; color: red', 'h1.title')).toBe('h1.title{font-size: 28px !important;color: red !important}')
    expect(candidateCss('font-size:28px!important', 'h1')).toBe('h1{font-size:28px!important}')
    expect(candidateCss('  ', 'h1')).toBe('')
  })

  it('keeps a url() semicolon inside one declaration', () => {
    const css = candidateCss('background: url(data:image/svg+xml;base64,aaa)', '.hero')
    expect(css).toBe('.hero{background: url(data:image/svg+xml;base64,aaa) !important}')
  })

  it('passes a stylesheet through and refuses a selector or declaration that would close the rule', () => {
    expect(candidateCss('.hero { font-size: 40px }', 'h1')).toBe('.hero { font-size: 40px }')
    expect(candidateCss('color: red}', 'h1')).toBe('')
    expect(candidateCss('color: red', 'h1{x}')).toBe('')
  })
})

describe('applyCandidateContent', () => {
  it('replaces copy only when the element has no element children', () => {
    document.body.innerHTML = '<h1 id="a">Hello</h1><div id="b">Keep <em>this</em></div>'
    const leaf = document.getElementById('a')!
    const parent = document.getElementById('b')!
    applyCandidateContent(leaf, { text: '你好', style: 'font-size: 32px' }, '#a')
    applyCandidateContent(parent, { text: '不要覆盖' }, '#b')
    expect(leaf.textContent).toBe('你好')
    expect(parent.querySelector('em')?.textContent).toBe('this')
  })

  it('changes only an image, then restores the original markup', () => {
    document.body.innerHTML = '<img id="img" src="/old.png" srcset="/old.png 2x" alt="hero"><div id="box">text</div>'
    const img = document.getElementById('img') as HTMLImageElement
    const box = document.getElementById('box')!
    const saved = { html: img.innerHTML, src: img.getAttribute('src'), srcset: img.getAttribute('srcset') }
    applyCandidateContent(img, { image: '/next.png', text: 'ignored' }, 'img')
    expect(img.getAttribute('src')).toBe('/next.png')
    expect(img.hasAttribute('srcset')).toBe(false)
    applyCandidateContent(box, { image: '/nope.png' }, '#box')
    expect(box.getAttribute('src')).toBeNull()
    restoreCandidateElement(img, saved)
    expect(img.getAttribute('src')).toBe('/old.png')
    expect(img.getAttribute('srcset')).toBe('/old.png 2x')
  })
})
