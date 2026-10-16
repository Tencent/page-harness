import { tokensCss } from '../shared/tokens'

export const OVERLAY_CSS = `
:host { all: initial; }
${tokensCss('.ph', '.ph[data-theme="dark"]')}
.ph { font: var(--fs)/1.45 var(--font); color: var(--fg); -webkit-font-smoothing: antialiased; }
.ph * { box-sizing: border-box; }
.ph [hidden] { display: none !important; }
.ph button { font: inherit; color: inherit; cursor: pointer; }
.ph button:disabled { cursor: not-allowed; opacity: .45; }
.ph button:focus-visible, .ph input:focus-visible, .ph textarea:focus-visible { outline: none; box-shadow: var(--focus); }
.ph svg { display: block; }

/* dock */
.dock { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; max-width: min(480px, calc(100vw - 32px)); }
.bar { display: flex; gap: 2px; padding: 4px; background: var(--bg); border: 1px solid var(--line); border-radius: var(--r-lg); box-shadow: var(--shadow); }
.bar button { display: inline-flex; align-items: center; gap: 6px; height: var(--h-lg); padding: 0 12px; border: 0; border-radius: var(--r); background: transparent; white-space: nowrap; position: relative; font-weight: 500; transition: background .12s, color .12s; }
.dock > .who { display: inline-flex; align-items: center; max-width: min(280px, calc(100vw - 32px)); height: 22px; padding: 0 8px; border-radius: 999px; background: var(--bg); border: 1px solid var(--line); color: var(--fg2); font-size: var(--fs-sm); box-shadow: var(--shadow-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar button:hover:not(:disabled) { background: var(--bg3); }
.bar button.on, .bar button.on:hover:not(:disabled) { background: var(--accent); color: var(--accent-fg); }
.bar svg { width: 16px; height: 16px; flex: none; }
.bar button[data-tip]:disabled:hover::after, .bar button[data-tip].tip::after {
  content: attr(data-tip); position: absolute; top: 50%; right: calc(100% + 8px); transform: translateY(-50%); padding: 4px 8px; border-radius: var(--r-sm); background: var(--fg); color: var(--bg); font-size: var(--fs-sm); white-space: nowrap; pointer-events: none;
}
.toast { display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: var(--r); font-size: var(--fs-sm); border: 1px solid transparent; box-shadow: var(--shadow-sm); max-width: 100%; }
.toast.ok { background: var(--ok-bg); color: var(--ok); border-color: color-mix(in srgb, var(--ok) 25%, transparent); }
.toast.warn { background: var(--warn-bg); color: var(--warn); border-color: color-mix(in srgb, var(--warn) 25%, transparent); }

/* windows */
.win { position: fixed; z-index: 2147483645; display: flex; flex-direction: column; background: var(--bg); border: 1px solid var(--line); border-radius: var(--r-lg); box-shadow: var(--shadow); overflow: hidden; }
.win.dragging { user-select: none; }
.win.dragging iframe { pointer-events: none; }
.titlebar { display: flex; align-items: center; gap: 6px; height: 36px; padding: 0 4px 0 8px; border-bottom: 1px solid var(--line); background: var(--bg2); cursor: move; user-select: none; flex: none; }
.titlebar .grip { color: var(--fg3); letter-spacing: -2px; font-size: var(--fs-sm); }
.titlebar .brand { font-weight: 600; display: inline-flex; align-items: center; gap: 8px; }
.titlebar .brand i { width: 9px; height: 9px; border-radius: 2px; background: var(--accent); transform: rotate(45deg); display: inline-block; }
.titlebar .sp { flex: 1; }
.titlebar button { width: var(--h); height: var(--h); border: 0; border-radius: var(--r-sm); background: transparent; display: inline-grid; place-items: center; color: var(--fg2); }
.titlebar button:hover { background: var(--bg3); color: var(--fg); }
.titlebar svg { width: 15px; height: 15px; }
.win iframe { flex: 1; width: 100%; border: 0; background: var(--bg); color-scheme: normal; }
.rs { position: absolute; z-index: 2; }
.rs-n, .rs-s { left: 8px; right: 8px; height: 6px; cursor: ns-resize; }
.rs-n { top: -3px; } .rs-s { bottom: -3px; }
.rs-e, .rs-w { top: 8px; bottom: 8px; width: 6px; cursor: ew-resize; }
.rs-e { right: -3px; } .rs-w { left: -3px; }
.rs-ne, .rs-nw, .rs-se, .rs-sw { width: 12px; height: 12px; }
.rs-ne { top: -3px; right: -3px; cursor: nesw-resize; } .rs-sw { bottom: -3px; left: -3px; cursor: nesw-resize; }
.rs-nw { top: -3px; left: -3px; cursor: nwse-resize; } .rs-se { bottom: -3px; right: -3px; cursor: nwse-resize; }

/* Max stacking value. The drawer is the last sibling, so it paints above the banner and pick hint. */
.drawer { z-index: 2147483647; }
.art-mask { position: fixed; inset: 0; z-index: 2147483645; background: var(--mask); animation: ph-fade .12s ease-out; }
@keyframes ph-fade { from { opacity: 0; } }

/* page-control banner */
.banner { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483647; display: flex; align-items: center; gap: 10px; height: 36px; padding: 0 4px 0 14px; border-radius: 999px; background: var(--bg); border: 1px solid var(--accent); box-shadow: var(--shadow); white-space: nowrap; }
.banner .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
.banner.busy .dot { animation: ph-pulse 1s infinite; }
.banner button { height: var(--h); border: 0; border-radius: 999px; padding: 0 14px; background: var(--accent); color: var(--accent-fg); font-weight: 600; }
.banner button:hover { background: var(--accent-hover); }
@keyframes ph-pulse { 50% { opacity: .3; } }

/* pick */
.catcher { position: fixed; inset: 0; z-index: 2147483640; cursor: crosshair; background: transparent; }
.hl { position: fixed; z-index: 2147483641; pointer-events: none; border: 2px solid var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); border-radius: 4px; transition: all .05s; }
.hl span { position: absolute; left: -2px; top: -24px; height: 20px; padding: 0 6px; border-radius: var(--r-sm); background: var(--accent); color: var(--accent-fg); font: var(--fs-xs)/20px var(--mono); white-space: nowrap; max-width: 60vw; overflow: hidden; text-overflow: ellipsis; }
.layer { display: contents; pointer-events: none; }
.layer > * { pointer-events: auto; }

/* review */
.bar .count { font-style: normal; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: var(--accent); color: var(--accent-fg); font-size: var(--fs-xs); line-height: 18px; text-align: center; font-weight: 600; }
.bar button.on .count { background: var(--accent-fg); color: var(--accent); }
.rv-pins { position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483642; }
.rv-pin { position: fixed; display: inline-flex; align-items: center; justify-content: center; min-width: 22px; width: auto; height: 22px; padding: 0 6px; box-sizing: border-box; border-radius: 50% 50% 50% 4px; border: 2px solid var(--bg); background: var(--accent); color: var(--accent-fg); font: 600 var(--fs-xs)/1 var(--font); white-space: nowrap; box-shadow: var(--shadow-sm); transition: transform .1s; }
.rv-pin:hover, .rv-pin.on { transform: scale(1.15); }
.rv-pin.issue { background: var(--err); color: #fff; }
.rv-pin.info { background: var(--fg2); color: var(--bg); }
.rv-pin.patch { background: var(--ok); color: #fff; border-radius: 4px; }
.rv-hl { position: fixed; z-index: 2147483641; pointer-events: none !important; border: 2px dashed var(--accent); border-radius: 4px; background: color-mix(in srgb, var(--accent) 6%, transparent); }
.card { background: var(--bg); border: 1px solid var(--line); border-radius: var(--r-lg); box-shadow: var(--shadow); }
.rv-pop { position: fixed; z-index: 2147483646; width: min(360px, calc(100vw - 16px)); max-height: min(80vh, 640px); overflow: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.rv-say { margin: 0; font-size: var(--fs); line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
.rv-edit { display: flex; flex-direction: column; gap: 6px; }
.rv-edit .rv-input { width: 100%; resize: vertical; }
.rv-edit-acts { display: flex; align-items: center; gap: 6px; }
.rv-edit-acts .sp { flex: 1; }
.rv-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.rv-pane { background: var(--bg2); border: 1px solid var(--line); border-radius: var(--r); padding: 6px; min-height: 72px; overflow: hidden; }
.rv-pane .cap { font: 700 var(--fs-xs)/1.3 var(--font); color: var(--fg3); margin-bottom: 4px; }
.rv-shot { position: relative; height: 140px; overflow: hidden; background: var(--bg3); border-radius: 4px; }
.rv-shot.zoomable { cursor: zoom-in; }
.rv-shot-img { position: absolute; inset: 0; margin: auto; max-width: 100%; max-height: 100%; object-fit: contain; display: block; background: #fff; box-shadow: 0 0 0 1px var(--line); }
.rv-shot-html { position: absolute; left: 50%; top: 50%; width: max-content; max-width: none; transform: translate(-50%, -50%); transform-origin: center; pointer-events: none; }
.rv-zoom { position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; background: var(--mask); animation: ph-fade .12s ease-out; }
.rv-zoom-card { width: min(1100px, calc(100vw - 48px)); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.rv-zoom .rv-shot { height: min(70vh, 720px); }
.rv-mini, .rv-quote { font-family: Georgia, "Times New Roman", serif; font-size: 12px; line-height: 1.35; overflow: hidden; }
.rv-quote { background: var(--bg2); border-left: 3px solid var(--accent); padding: 4px 8px; font-size: 11.5px; color: var(--fg2); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
.rv-tech { border-top: 1px dashed var(--line); padding-top: 6px; }
.rv-tech summary { color: var(--fg2); font-size: var(--fs-xs); cursor: pointer; }
.rv-tech-body { margin: 6px 0 0; font: var(--fs-xs)/1.45 var(--mono); color: var(--fg2); white-space: pre-wrap; word-break: break-word; }
.rv-head { display: flex; align-items: center; gap: 8px; }
.rv-head .sp, .rv-tools .sp { flex: 1; }
.ph .rv-head .btn.x { width: 24px; height: 24px; padding: 0; border: 0; border-radius: var(--r-sm); background: transparent; color: var(--fg3); font-size: 18px; line-height: 1; }
.ph .rv-head .btn.x:hover:not(:disabled) { background: var(--bg3); color: var(--fg); }
.rv-sev { font-size: var(--fs-xs); padding: 1px 8px; border-radius: 999px; background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); font-weight: 600; }
.rv-sev.issue { background: color-mix(in srgb, var(--err) 14%, transparent); color: var(--err); }
.rv-sev.info { background: var(--bg3); color: var(--fg2); }
.rv-sev.patch { background: var(--ok-bg); color: var(--ok); }
.rv-note { white-space: pre-wrap; word-break: break-word; max-height: 40vh; overflow: auto; }
.rv-meta { color: var(--fg3); font: var(--fs-xs)/1.4 var(--mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rv-foot, .rv-tools { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ph .btn { height: var(--h); padding: 0 10px; border: 1px solid var(--line); border-radius: var(--r); background: var(--bg); font-size: var(--fs-sm); }
.ph .btn:hover:not(:disabled) { background: var(--bg3); }
.ph .btn.danger { color: var(--err); }
.rv-list { position: fixed; right: 16px; bottom: 68px; z-index: 2147483646; width: min(360px, calc(100vw - 32px)); max-height: min(60vh, 520px); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.rv-tog { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-sm); cursor: pointer; }
.rv-rows { overflow: auto; display: flex; flex-direction: column; gap: 2px; margin: 0 -6px; }
.rv-row { display: flex; gap: 8px; align-items: flex-start; text-align: left; width: 100%; padding: 6px; border: 0; border-radius: var(--r); background: transparent; }
.rv-row:hover { background: var(--bg3); }
.rv-n { flex: none; min-width: 20px; width: auto; height: 20px; padding: 0 5px; box-sizing: border-box; border-radius: 999px; background: var(--accent); color: var(--accent-fg); font-size: var(--fs-xs); line-height: 20px; text-align: center; font-weight: 600; }
.rv-n.issue { background: var(--err); color: #fff; }
.rv-n.info { background: var(--fg2); color: var(--bg); }
.rv-n.patch { background: var(--ok); color: #fff; border-radius: 4px; }
.rv-body { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.rv-text { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
.rv-empty { color: var(--fg2); font-size: var(--fs-sm); padding: 12px 6px; }

/* review: threads, forms, tabs */
.bar button.elsewhere::after { content: ''; position: absolute; top: 6px; right: 6px; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
.rv-pin.done { opacity: .45; }
.rv-pin.done::after { content: '✓'; position: absolute; right: -6px; bottom: -6px; width: 12px; height: 12px; border-radius: 50%; background: var(--ok); color: #fff; font-size: 9px; line-height: 12px; }
.pick-hint { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483647; padding: 6px 14px; border-radius: 999px; background: var(--fg); color: var(--bg); font-size: var(--fs-sm); pointer-events: none !important; max-width: calc(100vw - 32px); text-align: center; }
.pick-actions { position: fixed; z-index: 2147483646; display: flex; align-items: center; gap: 4px; padding: 4px; }
.rv-tip { padding: 6px 2px 0; color: var(--fg3); font-size: var(--fs-xs); }
.rv-form { position: fixed; z-index: 2147483646; width: min(340px, calc(100vw - 16px)); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; max-height: 80vh; overflow: auto; }
.rv-input { width: 100%; font: inherit; font-size: var(--fs-sm); color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: var(--r); padding: 5px 8px; resize: vertical; }
.rv-input[type="color"] { padding: 2px; height: 30px; }
select.rv-input { width: auto; }
.rv-field { display: flex; flex-direction: column; gap: 3px; font-size: var(--fs-xs); color: var(--fg2); min-width: 0; }
.rv-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.rv-target { display: inline-flex; align-items: center; gap: 6px; min-width: 0; font-family: var(--font); }
.rv-tag { flex: none; padding: 0 5px; border-radius: 4px; background: var(--bg3); color: var(--fg2); font: 10.5px/16px var(--mono); }
.rv-desc { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg2); }
.rv-meta.wrap { white-space: normal; font-family: var(--font); }
.rv-meta.warn { color: var(--warn); }
.rv-thread { display: flex; flex-direction: column; gap: 8px; max-height: 40vh; overflow: auto; }
.rv-msg { display: flex; flex-direction: column; gap: 2px; }
.rv-msg.reply { padding-left: 10px; border-left: 2px solid var(--line); }
.rv-by { display: flex; gap: 6px; align-items: baseline; font-size: var(--fs-xs); color: var(--fg2); }
.rv-by.agent b { color: var(--accent); }
.rv-ago { color: var(--fg3); }
.rv-reply { display: flex; gap: 6px; align-items: flex-end; }
.rv-reply .rv-input { flex: 1; min-height: 30px; }
.ph .btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); font-weight: 600; }
.ph .btn.primary-soft { background: color-mix(in srgb, var(--accent) 12%, transparent); border-color: transparent; color: var(--accent); font-weight: 600; }
.ph .btn.approve.on.approved { background: var(--ok); border-color: var(--ok); color: #fff; }
.ph .btn.approve.on.changes { background: var(--warn); border-color: var(--warn); color: #fff; }
.rv-sev.done { background: var(--ok-bg); color: var(--ok); }
.rv-approvals { display: flex; flex-wrap: wrap; gap: 4px; }
.rv-chip { font-size: var(--fs-xs); padding: 2px 8px; border-radius: 999px; background: var(--ok-bg); color: var(--ok); }
.rv-chip.changes { background: var(--warn-bg); color: var(--warn); }
.rv-tabs { display: flex; align-items: center; gap: 4px; border-bottom: 1px solid var(--line); padding-bottom: 6px; }
.ph .btn.tab { border-color: transparent; background: transparent; color: var(--fg2); }
.ph .btn.tab.on { background: var(--bg3); color: var(--fg); font-weight: 600; }
.ph .btn.primary:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); }
.ph .btn.copy-prompt { background: color-mix(in srgb, var(--accent) 12%, transparent); border-color: transparent; color: var(--accent); font-weight: 600; }
.ph .btn.copy-prompt:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 20%, transparent); }
.ph .btn.copy-prompt.on, .ph .btn.copy-prompt.on:hover:not(:disabled) { background: var(--ok); border-color: var(--ok); color: #fff; }
.ph .btn.primary-soft:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 20%, transparent); }
.ph .btn.danger:hover:not(:disabled) { background: var(--err-bg); border-color: color-mix(in srgb, var(--err) 35%, transparent); }
.ph .btn.approve.on.approved:hover:not(:disabled) { background: color-mix(in srgb, var(--ok) 88%, #000); }
.ph .btn.approve.on.changes:hover:not(:disabled) { background: color-mix(in srgb, var(--warn) 88%, #000); }
.ph .btn.tab:hover:not(:disabled) { background: var(--bg3); color: var(--fg); }
.rv-group { font: var(--fs-xs)/1.4 var(--mono); color: var(--fg3); padding: 8px 6px 2px; }
.rv-row.done { opacity: .55; }

@media (prefers-reduced-motion: reduce) { .ph * { animation: none !important; transition: none !important; } }
`
