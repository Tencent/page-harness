export function renderStatus(s) {
  if (s?.starting) return '分享预览正在启动。'
  if (!s?.running) return s?.error ? `分享预览没有在运行。上次错误：${s.error}` : '分享预览没有在运行。'
  return [
    `分享预览已启动：${s.target}`,
    `分享链接（发给同事）：${s.shareUrl}`,
    `需要对外开放端口 ${s.port} 和 ${s.controlPort}。`,
    s.noAgent ? '模式：只评审（取点和意见）。' : '模式：带 Agent。',
    '把分享链接原样告诉用户，一两句话即可。',
  ].join('\n')
}

export function renderPreview(s) {
  if (s?.needsAgent) {
    return [
      `页面还没有起来，预览没有启动。${s.reason || ''}`.trim(),
      `在这个目录执行（不要换目录）：${s.project}`,
      s.command,
      `等它监听后，用同一个地址再调用 page_harness_preview：${s.url}`,
      '不要自己运行 page-harness，也不要换端口。',
    ].join('\n')
  }
  if (s?.waitingForPage) return '预览已准备好，用户打开 DSH 页面后会显示在右侧。对用户只说一句即可。'
  if (!s?.running) return `预览没有打开${s?.error ? `：${s.error}` : '。'}`
  return [
    `已在右侧预览：${s.label}`,
    '用户可以在预览里取点并引用到对话，或留意见；需要按意见修改时调用 page_harness_notes。',
    '对用户只说一句即可，不要贴链接或命令。',
  ].join('\n')
}

export function renderNotes(r) {
  const items = r?.items ?? []
  if (!items.length) return '预览上没有未解决的意见。'
  const lines = items.map((i) => {
    const change = i.patch ? ` 建议修改：${JSON.stringify(i.patch)}` : ''
    const replies = i.replies?.length ? ` 回复：${i.replies.join(' / ')}` : ''
    return `#${i.n} [${i.path}] ${i.label || i.selector}（${i.selector}）：${i.note || '(无文字)'}${change}${replies}`
  })
  return [`未解决的意见 ${items.length} 条（项目 ${r.project}）：`, ...lines, '逐条修改对应的源文件，改完再调用 page_harness_preview 刷新。'].join('\n')
}

/** Origin must name the host the browser reached, directly or through a reverse proxy. */
export function sameOrigin(req) {
  const origin = req.headers.origin
  if (typeof origin !== 'string') return false
  let from
  try {
    from = new URL(origin).host.toLowerCase()
  } catch {
    return false
  }
  return [req.headers.host, req.headers['x-forwarded-host']].some((h) => typeof h === 'string' && h.split(',')[0].trim().toLowerCase() === from)
}

export async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > 64 * 1024) throw new Error('request body too large')
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c))
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

export function sendJson(res, code, body) {
  res.statusCode = code
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}
