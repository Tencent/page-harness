// Candidates for one picked element. The DSH model submits them; nothing here starts a process or writes files.
// lib/client.js keeps a copy of adoptDraft; test/propose.test.js fails if the two drift.

const MIN = 2
const MAX = 4

export function proposeVariants(input) {
  const selector = String((input && input.selector) || "").trim()
  if (!selector) throw new Error("selector is required")
  if (selector.length > 500) throw new Error("selector is too long")
  const raw = input && input.variants
  if (!Array.isArray(raw) || raw.length < MIN || raw.length > MAX) throw new Error("variants must be 2 to 4 items")
  return {
    ok: true,
    kind: "page-harness-propose",
    selector,
    url: clip(input.url, 2000),
    html: clip(input.html, 1500),
    variants: raw.map(normalizeVariant),
  }
}

export function renderPropose(p) {
  const lines = (p.variants || []).map((v) => {
    const bits = []
    if (v.text) bits.push("文案：" + v.text)
    if (v.style) bits.push("样式：" + v.style)
    if (v.image) bits.push("图片：" + v.image)
    return v.index + ". " + v.label + (bits.length ? " — " + bits.join("；") : "")
  })
  return [
    "已记录 " + lines.length + " 个候选（selector: " + p.selector + "）。",
    ...lines,
    "不要改文件，不要调用 page_harness_preview。等用户在卡片上选择「采用」。",
  ].join("\n")
}

export function adoptDraft(proposal, index) {
  const variants = proposal && proposal.variants
  const v = variants && variants.find((x) => x.index === index)
  if (!v) return ""
  const lines = []
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, " ")
  const selector = String((proposal && proposal.selector) || "")
  const url = String((proposal && proposal.url) || "")
  const html = String((proposal && proposal.html) || "")
  if (selector) {
    const tag = ((/^<([a-z][\w-]*)/i.exec(html) || [])[1] || "").toLowerCase()
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    const attrs = [
      ["url", url],
      ["selector", selector],
      ["tag", tag],
      ["text", text.length > 160 ? text.slice(0, 160) + "…" : text],
    ].filter(([, val]) => val).map(([k, val]) => k + '="' + esc(val) + '"').join(" ")
    lines.push("<page-element " + attrs + "></page-element>", "")
  }
  const body = []
  if (v.text) body.push("文案：" + v.text)
  if (v.style) body.push("样式：" + v.style)
  if (v.image) body.push("图片：" + v.image)
  if (body.length) {
    lines.push("<page-variant index=\"" + esc(v.index) + "\" label=\"" + esc(v.label) + "\">")
    lines.push(body.join("\n").replace(/<\/page-variant/gi, "< /page-variant"))
    lines.push("</page-variant>", "")
  }
  lines.push("采用第 " + v.index + " 版「" + v.label + "」。")
  lines.push("请只改产生该元素的源码来实现这一版，然后调用 page_harness_preview 刷新。不要再提交新的候选，也不要把几版同时写进源码。")
  return lines.join("\n")
}

function normalizeVariant(v, i) {
  const n = i + 1
  if (!v || typeof v !== "object") throw new Error("variant " + n + " is empty")
  const label = clip(v.label, 40)
  if (!label) throw new Error("variant " + n + " needs a label")
  const text = clip(v.text, 500)
  const image = clip(v.image, 2000)
  const style = clip(styleOf(v.style), 8000)
  if (!text && !style && !image) throw new Error("variant " + n + " needs text, style, or image")
  return { index: n, label, ...(text ? { text } : {}), ...(style ? { style } : {}), ...(image ? { image } : {}) }
}

function styleOf(style) {
  if (style == null || style === "") return ""
  if (typeof style === "string") return style
  if (typeof style !== "object") return ""
  return Object.entries(style)
    .filter(([k, val]) => /^[a-z-]+$/i.test(k) && val != null && String(val).trim())
    .map(([k, val]) => k + ": " + String(val).trim())
    .join("; ")
}

function clip(value, max) {
  return String(value ?? "").trim().slice(0, max)
}
