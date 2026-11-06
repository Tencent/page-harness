// Temporary on-page candidate from the embedding host. Standalone never calls this.

export interface CandidateSnapshot {
  html: string
  src: string | null
  srcset: string | null
}

/** Inline declarations are scoped to the element. A stylesheet (any `{`) is kept as written. */
export function candidateCss(style: string, selector: string): string {
  const s = style.trim()
  if (!s) return ''
  if (s.includes('{')) return s
  if (/[{}]/.test(selector)) return ''
  const body = declarations(s)
    .filter((d) => !/[{}]/.test(d))
    .map((d) => (/\s*!important\s*$/i.test(d) ? d : `${d} !important`))
    .join(';')
  if (!body) return ''
  return `${selector}{${body}}`
}

/** Copy is applied only to elements with no element children. Images change only `<img>`. */
export function applyCandidateContent(el: HTMLElement, variant: { text?: string; style?: string; image?: string }, selector: string): string {
  if (variant.text && !el.querySelector('*')) el.textContent = variant.text
  if (variant.image && el instanceof HTMLImageElement) {
    el.removeAttribute('srcset')
    el.src = variant.image
  }
  return candidateCss(variant.style || '', selector)
}

export function restoreCandidateElement(el: HTMLElement, saved: CandidateSnapshot): void {
  el.innerHTML = saved.html
  if (saved.src === null) el.removeAttribute('src')
  else el.setAttribute('src', saved.src)
  if (saved.srcset === null) el.removeAttribute('srcset')
  else el.setAttribute('srcset', saved.srcset)
}

/** Splits on `;` that are not inside parentheses, so `url(data:...;base64,...)` stays one declaration. */
function declarations(style: string): string[] {
  const out: string[] = []
  let cur = ''
  let depth = 0
  for (const ch of style) {
    if (ch === '(') depth++
    else if (ch === ')' && depth) depth--
    if (ch === ';' && depth === 0) {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}
