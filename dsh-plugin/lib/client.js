window.__ModuleLoader__.load({
  id: "page-harness-dsh",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;
    const { useCallback, useEffect, useState } = React;

    const CSS = `
.phd-card{box-sizing:border-box;max-width:560px;background:var(--dsw-alias-bg-layer-3,#fff);border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:12px;padding:12px;color:var(--dsw-alias-label-primary,inherit);font-size:13px;line-height:20px}
.phd-row{display:flex;align-items:center;gap:8px;min-width:0}
.phd-title{flex:1;min-width:0;font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.phd-badge{flex:none;font-size:11px;line-height:16px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-state-success-tertiary,#ecfdf5);color:var(--dsw-alias-state-success-primary,#047857)}
.phd-badge.off{background:var(--dsw-alias-markdown-tag,#f3f4f6);color:var(--dsw-alias-label-secondary,#4b5563)}
.phd-sub{color:var(--dsw-alias-label-tertiary,#6b7280);font-size:12px;line-height:18px;margin-top:2px;overflow-wrap:anywhere}
.phd-link{display:flex;align-items:center;gap:6px;margin-top:10px;padding:6px 8px;border-radius:8px;background:var(--dsw-alias-bg-module-platform,#f7f8fa);border:1px solid var(--dsw-alias-border-l2,#e5e7eb)}
.phd-link code{flex:1;min-width:0;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.phd-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.phd-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2,#d1d5db);background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-primary,inherit);border-radius:8px;padding:4px 10px;font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.phd-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6)}
.phd-btn:disabled{opacity:.5;cursor:default}
.phd-btn.primary{background:var(--dsw-alias-label-primary,#17191c);border-color:var(--dsw-alias-label-primary,#17191c);color:var(--dsw-alias-bg-layer-3,#fff)}
.phd-field{display:flex;flex-direction:column;gap:4px;margin-top:10px;font-size:12px;color:var(--dsw-alias-label-secondary,#4b5563)}
.phd-field input{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l2,#d1d5db);border-radius:8px;padding:6px 8px;font:inherit;font-size:13px;background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-primary,inherit)}
.phd-err{margin-top:8px;color:var(--dsw-alias-state-danger-primary,#b91c1c);font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:120px;overflow:auto}
.phd-wrap{width:100%;position:relative}
.phd-wrap.rail{display:flex;justify-content:center}
.phd-trigger{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:calc(100% + 4px);height:42px;margin:4px -2px;padding:0 10px 0 8px;border:0;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:14px;line-height:22px;cursor:pointer;overflow:hidden}
.phd-wrap.rail .phd-trigger{width:36px;height:36px;margin:8px 0 10px;padding:0;justify-content:center;border-radius:50%;gap:0}
.phd-trigger:hover,.phd-trigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6)}
.phd-trigger svg{flex:none;width:16px;height:16px}
.phd-trigger span{white-space:nowrap;overflow:hidden}
.phd-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#16a34a);margin-left:auto}
.phd-pop{position:fixed;left:12px;bottom:64px;z-index:2147483000;width:360px;box-shadow:0 18px 50px rgba(15,23,42,.22)}
.phd-gap{gap:8px;margin-top:8px}
.phd-grow{flex:1;min-width:0}
.phd-ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.phd-section{margin-top:12px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#4b5563)}
.phd-share{padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l2,#e5e7eb);max-height:50%;overflow:auto}
.phd-empty .phd-card{width:100%;max-width:420px;align-self:center;box-sizing:border-box}
.phd-icon.on{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6);color:var(--dsw-alias-label-primary,inherit)}
.phd-dock{position:fixed;top:0;right:0;bottom:0;z-index:30;display:flex;border-left:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-2,#fff);box-sizing:border-box}
.phd-dock>.phd-pane{flex:1;min-width:0}
.phd-dock-handle{position:absolute;left:-5px;top:0;bottom:0;width:10px;cursor:col-resize;z-index:2;touch-action:none}
.phd-dock-handle:after{content:"";position:absolute;left:3px;top:50%;width:4px;height:36px;margin-top:-18px;border-radius:4px;background:var(--dsw-alias-border-l3,#cbd5e1);opacity:0;transition:opacity .15s}
.phd-dock-handle:hover:after,.phd-dock.dragging .phd-dock-handle:after{opacity:1}
.phd-edge{position:fixed;right:0;top:50%;z-index:30;width:18px;height:64px;margin-top:-32px;display:grid;place-items:center;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-right:0;border-radius:10px 0 0 10px;background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-secondary,#4b5563);cursor:col-resize;touch-action:none;box-shadow:0 4px 14px rgba(15,23,42,.08)}
.phd-edge:hover{width:22px;color:var(--dsw-alias-label-primary,inherit)}
.phd-edge svg{width:12px;height:12px}
.phd-drag-shield{position:fixed;inset:0;z-index:31;cursor:col-resize}
.phd-tail{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:6px 0 2px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:10px;background:var(--dsw-alias-bg-module-platform,#f7f8fa);font-size:13px;color:var(--dsw-alias-label-secondary,#4b5563)}
.phd-tail>svg{width:15px;height:15px;flex:none}
.phd-tail .phd-btn{padding:3px 10px}
.phd-tail .phd-err{flex-basis:100%;margin-top:0}
.phd-produced{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:6px 0 2px;font-size:12px;color:var(--dsw-alias-label-tertiary,#6b7280)}
.phd-chip{appearance:none;border:0;border-radius:6px;padding:1px 6px;background:var(--dsw-alias-markdown-tag,#f3f4f6);color:var(--dsw-alias-label-secondary,#4b5563);font:inherit;font-size:12px;cursor:pointer}
.phd-chip:hover{color:var(--dsw-alias-label-primary,inherit)}
.phd-pane{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,inherit);font-size:13px}
.phd-bar{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l2,#e5e7eb);min-width:0}
.phd-bar .phd-title{font-size:13px}
.phd-bar .phd-btn{padding:3px 8px}
.phd-icon{appearance:none;flex:none;width:28px;height:28px;display:grid;place-items:center;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);cursor:pointer;font:inherit;font-size:15px;line-height:1}
.phd-icon:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6)}
.phd-icon svg{width:15px;height:15px}
.phd-icon:disabled{opacity:.5;cursor:default}
.phd-sharebox{flex:none;display:flex;align-items:center;gap:2px}
.phd-switch{appearance:none;display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 8px 0 4px;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);font:inherit;font-size:12px;line-height:1;cursor:pointer}
.phd-switch:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6)}
.phd-switch i{position:relative;flex:none;width:28px;height:16px;border-radius:999px;background:#a1a1aa;transition:background .15s ease}
.phd-switch i::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s ease}
.phd-switch[aria-checked=true]{color:var(--dsw-alias-label-primary,inherit)}
.phd-switch[aria-checked=true] i{background:#059669}
.phd-switch[aria-checked=true] i::after{transform:translateX(12px)}
.phd-switch:disabled{cursor:default}
.phd-switch.busy{opacity:.7}
.phd-frame{flex:1;min-height:0;border:0;width:100%;background:#fff}
.phd-empty{flex:1;display:flex;flex-direction:column;justify-content:center;gap:4px;padding:24px;color:var(--dsw-alias-label-tertiary,#6b7280)}
.phd-open{display:flex;gap:6px;margin-top:10px}
.phd-open input{flex:1;min-width:0;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,#d1d5db);border-radius:8px;padding:5px 8px;font:inherit;font-size:13px;background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-primary,inherit)}
.phd-head-btn{appearance:none;display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);font:inherit;font-size:12px;cursor:pointer}
.phd-head-btn:hover,.phd-head-btn.on{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6);color:var(--dsw-alias-label-primary,inherit)}
.phd-head-btn svg{width:14px;height:14px}
@keyframes phd-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.phd-qdock{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance,0px) - var(--dsh-composer-side-clearance,0px) - var(--dsh-composer-dock-inset,12px) - var(--dsh-composer-dock-inset,12px));max-width:calc(var(--dsh-composer-card-max-width,768px) - var(--dsh-composer-dock-inset,12px) - var(--dsh-composer-dock-inset,12px));margin:0 auto calc(0px - var(--dsh-composer-stack-gap,8px) - 3px);padding:0 var(--dsh-composer-dock-inset,12px);flex:none}
.phd-qpanel{position:relative;padding:10px 10px 14px;border-radius:16px 16px 0 0;background:var(--dsw-specific-tip,#f5f6f8)}
.phd-qpanel:after{content:"";position:absolute;inset:0;border:1px solid var(--dsw-alias-border-l1,#eceef1);border-bottom:none;border-radius:inherit;pointer-events:none}
.phd-qrow{display:flex;align-items:center;gap:4px;min-width:0}
.phd-qclear{flex:none;appearance:none;border:0;background:transparent;border-radius:8px;padding:4px 8px;font:inherit;font-size:12px;color:var(--dsw-alias-label-tertiary,#6b7280);cursor:pointer}
.phd-qclear:hover{background:var(--dsw-alias-interactive-bg-hover,#eef0f3);color:var(--dsw-alias-label-primary,inherit)}
.phd-qrail{flex:1;min-width:0;display:flex;gap:8px;overflow-x:auto;padding:2px 2px 4px;scrollbar-width:thin}
.phd-qcard{position:relative;flex:none;box-sizing:border-box;display:flex;align-items:center;gap:10px;width:220px;height:52px;padding:8px 26px 8px 8px;border-radius:14px;background:var(--dsw-alias-bg-layer-3,#fff);border:1px solid var(--dsw-alias-border-l2,#e4e7ec);box-shadow:0 1px 2px rgba(16,24,40,.05),0 8px 20px rgba(16,24,40,.04);color:var(--dsw-alias-label-primary,inherit);cursor:pointer;outline:none;text-align:left;animation:phd-in .18s ease-out;transition:border-color .15s,box-shadow .15s,transform .15s}
.phd-qcard:hover{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4d6bfe) 40%,var(--dsw-alias-border-l2,#e4e7ec));box-shadow:0 4px 16px rgba(16,24,40,.08);transform:translateY(-1px)}
.phd-qcard.open{border-color:var(--dsw-alias-state-business-primary,#4d6bfe);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4d6bfe) 14%,transparent)}
.phd-qcard:focus-visible{border-color:var(--dsw-alias-state-business-primary,#4d6bfe);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4d6bfe) 24%,transparent)}
.phd-qicon{flex:none;width:34px;height:34px;display:grid;place-items:center;border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4d6bfe) 10%,transparent);color:var(--dsw-alias-state-business-primary,#4d6bfe)}
.phd-qicon svg{width:16px;height:16px}
.phd-qbody{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.phd-qname{font-size:13px;line-height:18px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.phd-qname.mono,.phd-qmeta code,.phd-qdetail code,.phd-qcode{font-family:var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace)}
.phd-qname.mono{font-size:12px}
.phd-qmeta{display:flex;align-items:center;gap:4px;min-width:0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#6b7280);white-space:nowrap;overflow:hidden}
.phd-qtag{flex:none;color:var(--dsw-alias-label-secondary,#4b5563)}
.phd-qmeta code{min-width:0;font-size:11px;overflow:hidden;text-overflow:ellipsis}
.phd-qx{position:absolute;top:5px;right:5px;width:18px;height:18px;padding:0;display:grid;place-items:center;border:0;border-radius:50%;background:transparent;color:var(--dsw-alias-label-tertiary,#6b7280);cursor:pointer;opacity:0;transition:opacity .15s,background-color .15s}
.phd-qx svg{width:10px;height:10px}
.phd-qcard:hover .phd-qx,.phd-qcard:focus-within .phd-qx{opacity:1}
.phd-qx:hover{background:var(--dsw-alias-interactive-bg-hover,#eef0f3);color:var(--dsw-alias-label-primary,inherit)}
@media (hover:none){.phd-qx{opacity:1}}
.phd-qdetail{margin-top:8px;border:1px solid var(--dsw-alias-border-l2,#e4e7ec);border-radius:12px;background:var(--dsw-alias-bg-layer-3,#fff);overflow:hidden;animation:phd-in .16s ease-out;text-align:left}
.phd-qdetail-bar{display:flex;align-items:center;gap:8px;min-width:0;padding:5px 6px 5px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,#eceef1);font-size:12px;color:var(--dsw-alias-label-secondary,#4b5563)}
.phd-qdetail-bar code{flex:1;min-width:0;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.phd-qpage{flex:none;max-width:40%;color:var(--dsw-alias-label-tertiary,#6b7280);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.phd-qdetail .phd-icon{width:26px;height:26px}
.phd-qdetail .phd-icon svg{width:13px;height:13px}
.phd-qlocate{flex:none;appearance:none;display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;border:0;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4d6bfe) 10%,transparent);color:var(--dsw-alias-state-business-primary,#4d6bfe);font:inherit;font-size:12px;font-weight:500;cursor:pointer}
.phd-qlocate:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4d6bfe) 16%,transparent)}
.phd-qlocate svg{width:13px;height:13px}
.phd-qcode{margin:0;padding:8px 12px 10px;max-height:140px;overflow:auto;font-size:11.5px;line-height:18px;white-space:pre-wrap;word-break:break-all;color:var(--dsw-alias-label-secondary,#4b5563)}
.phd-qcode .t{color:var(--dsw-alias-state-business-primary,#4d6bfe)}
.phd-qcode .a{color:var(--dsw-alias-state-warn-label,#b45309)}
.phd-qcode .v{color:var(--dsw-alias-state-success-primary,#047857)}
.phd-qcode .c{color:var(--dsw-alias-label-caption,#9ca3af)}
.phd-msg{display:flex;flex-direction:column}
.phd-msgq{display:flex;flex-direction:column;align-items:flex-end;margin:2px 0 8px auto;max-width:min(100%,520px)}
.phd-msgq .phd-qrow{width:100%;justify-content:flex-end}
.phd-msgq .phd-qrail{flex:none;max-width:100%;flex-wrap:wrap;justify-content:flex-end;overflow:visible}
.phd-msgq .phd-qcard{padding-right:10px}
.phd-msgq .phd-qdetail{width:100%;box-sizing:border-box}
`;

    function ensureCss() {
      if (typeof document === "undefined" || document.getElementById("phd-style")) return;
      const el = document.createElement("style");
      el.id = "phd-style";
      el.textContent = CSS;
      document.head.appendChild(el);
    }

    const ZH = {
      title: "分享预览", running: "运行中", stopped: "未启动", starting: "启动中…",
      url: "页面地址（端口或 URL）", project: "项目目录（留空用上次的）", start: "启动分享", stop: "停止",
      copy: "复制链接", copied: "已复制", open: "打开", ports: "同事需要能访问端口 {a} 和 {b}",
      reviewOnly: "只评审：取点和意见", withAgent: "带 Agent", hint: "同事打开分享链接即可在页面上取点、留意见。",
      preview: "预览", reload: "刷新", newTab: "在新标签打开分享链接", newTabWait: "先打开分享", close: "关闭预览",
      share: "分享", shareStop: "关闭分享",
      devTitle: "开发预览", devHint: "在对话右侧打开开发中的页面，可以取点引用到对话、留意见让 Agent 改。",
      devInput: "端口、URL 或工作区里的 HTML 文件", scanning: "正在查找本机的 dev server…", noServers: "没有发现运行中的 dev server。",
      needSession: "先打开一个会话，预览显示在对话右侧。", previewing: "正在预览", localServers: "本机运行中的页面",
      dragResize: "拖动调整宽度", dragOpen: "点击或向左拖动打开预览", tailAsk: "写了网页 {name}，要在右侧预览吗？", openPreview: "在右侧预览", produced: "产物", tailShowing: "{name} 正在右侧预览",
      scriptAsk: "改了 {name}，要开启预览吗？", startAndPreview: "启动服务并预览",
      askStart: "用 page_harness_preview 预览刚改的 {name}。如果它说页面还没起来，只执行它给的那一条命令、在它给的目录里，等端口通了再用同一个地址调用一次。",
      serverChecking: "检测到启动了服务，正在查找端口…", serverUp: "服务已启动 {port}，要在右侧预览吗？",
      serverDown: "启动了服务，但 {port} 还没有响应。", serverUnknown: "启动了服务，但没找到它的端口。", serverPick: "启动了服务，要预览哪一个？",
      previewIn: "已在右侧预览", showPreview: "打开预览",
      mixedPreview: "当前页面是 HTTPS，预览是 HTTP，浏览器会拦截。把 publicScheme 设为 https，并在预览端口前加 TLS。",
      quoteClear: "全部移除", quoteRemove: "移除引用", quoteLocate: "在预览中定位", quoteCopySelector: "复制选择器",
    };
    const EN = {
      title: "Share preview", running: "Running", stopped: "Stopped", starting: "Starting…",
      url: "Page (port or URL)", project: "Project directory (blank: last used)", start: "Start sharing", stop: "Stop",
      copy: "Copy link", copied: "Copied", open: "Open", ports: "Teammates need to reach ports {a} and {b}",
      reviewOnly: "Review only: Pick and Notes", withAgent: "With agent", hint: "Teammates open the link to pick elements and leave notes on the page.",
      preview: "Preview", reload: "Reload", newTab: "Open the share link in a new tab", newTabWait: "Turn on sharing first", close: "Close preview",
      share: "Share", shareStop: "Turn sharing off",
      devTitle: "Dev preview", devHint: "Open the page you are building next to the chat: pick elements to quote, or leave notes for the agent.",
      devInput: "Port, URL, or an HTML file in the workspace", scanning: "Looking for dev servers on this machine…", noServers: "No running dev server found.",
      needSession: "Open a session first: the preview shows next to the chat.", previewing: "Previewing", localServers: "Running on this machine",
      dragResize: "Drag to resize", dragOpen: "Click or drag left to open the preview", tailAsk: "Wrote {name}. Preview it on the right?", openPreview: "Preview on the right", produced: "Produced", tailShowing: "{name} is in the preview pane",
      scriptAsk: "Changed {name}. Start a preview?", startAndPreview: "Start the server and preview",
      askStart: "Preview the file I just changed ({name}) with page_harness_preview. If it says the page is not up, run only the command it gives, in the directory it gives, then call page_harness_preview again with the same URL.",
      serverChecking: "A server was started; looking for its port…", serverUp: "Server is up on {port}. Preview it on the right?",
      serverDown: "A server was started, but {port} is not answering yet.", serverUnknown: "A server was started, but its port was not found.", serverPick: "A server was started. Which one to preview?",
      previewIn: "Shown in the preview pane", showPreview: "Show preview",
      mixedPreview: "This page is HTTPS and the preview is HTTP, so the browser blocks it. Set publicScheme to https and put TLS in front of the preview ports.",
      quoteClear: "Remove all", quoteRemove: "Remove quote", quoteLocate: "Find in preview", quoteCopySelector: "Copy selector",
    };
    function isZh() {
      const lang = (typeof document !== "undefined" && document.documentElement.lang) || (typeof navigator !== "undefined" && navigator.language) || "";
      return /^zh/i.test(lang);
    }
    function tr(key, vars) {
      const dict = isZh() ? ZH : EN;
      let s = dict[key] || EN[key] || key;
      if (vars) for (const k of Object.keys(vars)) s = s.replace("{" + k + "}", String(vars[k]));
      return s;
    }

    function pluginUrl() {
      const base = typeof document !== "undefined" ? document.baseURI : "/";
      return new URL("./page-harness", base).toString();
    }

    async function api(method, payload) {
      const res = await fetch(pluginUrl(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method, ...payload }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) throw new Error(body.error || "HTTP " + res.status);
      return body;
    }

    function ShareLink({ url }) {
      const [copied, setCopied] = useState(false);
      const copy = () => {
        const done = () => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        };
        if (navigator.clipboard) return navigator.clipboard.writeText(url).then(done).catch(() => {});
        // Plain-http IP origins are not secure contexts and have no clipboard API.
        const area = document.createElement("textarea");
        area.value = url;
        area.style.cssText = "position:fixed;opacity:0";
        document.body.appendChild(area);
        area.select();
        try { if (document.execCommand("copy")) done(); } catch {}
        area.remove();
      };
      return h("div", null,
        h("div", { className: "phd-link" },
          h("code", { title: url }, url),
        ),
        h("div", { className: "phd-actions" },
          h("button", { type: "button", className: "phd-btn primary", onClick: copy }, copied ? tr("copied") : tr("copy")),
          h("button", { type: "button", className: "phd-btn", onClick: () => window.open(url, "_blank", "noopener") }, tr("open")),
        ),
      );
    }

    function StatusCard({ status, busy, error, onStop, children }) {
      const s = status || {};
      const badge = s.starting ? tr("starting") : s.running ? tr("running") : tr("stopped");
      return h("div", { className: "phd-card" },
        h("div", { className: "phd-row" },
          h("div", { className: "phd-title" }, tr("title") + (s.running && s.target ? " · " + s.target : "")),
          h("span", { className: "phd-badge" + (s.running ? "" : " off") }, badge),
        ),
        s.running ? h("div", null,
          h("div", { className: "phd-sub" }, (s.noAgent ? tr("reviewOnly") : tr("withAgent")) + " · " + tr("ports", { a: s.port, b: s.controlPort })),
          s.project ? h("div", { className: "phd-sub" }, s.project) : null,
          s.shareUrl ? h(ShareLink, { url: s.shareUrl }) : null,
          onStop ? h("div", { className: "phd-actions" },
            h("button", { type: "button", className: "phd-btn", disabled: busy, onClick: onStop }, tr("stop")),
          ) : null,
        ) : null,
        children,
        error || (!s.running && s.error) ? h("div", { className: "phd-err" }, error || s.error) : null,
      );
    }

    function SidebarAction(props) {
      const wide = props.wide;
      useEffect(() => ensureCss(), []);
      const [open, setOpen] = useState(false);
      const preview = usePreview();
      const current = typeof props.useSessions === "function" ? props.useSessions((st) => st.current) : null;
      useEffect(() => {
        if (!open) return;
        const onPointer = (e) => {
          const node = e.target;
          if (node && typeof node.closest === "function" && node.closest(".phd-wrap, .phd-pop")) return;
          setOpen(false);
        };
        const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
        document.addEventListener("pointerdown", onPointer, true);
        window.addEventListener("keydown", onKey);
        return () => {
          document.removeEventListener("pointerdown", onPointer, true);
          window.removeEventListener("keydown", onKey);
        };
      }, [open]);
      return h("div", { className: "phd-wrap" + (wide ? "" : " rail") },
        h("button", { type: "button", className: "phd-trigger", "aria-label": tr("devTitle"), "aria-expanded": open, onClick: () => setOpen(!open) },
          h(Icon, { d: ICON_PREVIEW }),
          wide ? h("span", null, tr("devTitle")) : null,
          wide && preview && preview.running ? h("i", { className: "phd-dot" }) : null,
        ),
        open ? h("div", { className: "phd-pop", role: "dialog", "aria-label": tr("devTitle") },
          h(DevLauncher, { sessionId: current || currentSession(), onDone: () => setOpen(false) })) : null,
      );
    }

    function DevLauncher({ sessionId, onDone }) {
      const s = usePreview();
      const [servers, setServers] = useState(null);
      const [input, setInput] = useState("");
      const [busy, setBusy] = useState("");
      const [error, setError] = useState("");
      useEffect(() => {
        refreshPreview().catch(() => {});
        api("detect", {}).then((r) => setServers(r.servers || [])).catch(() => setServers([]));
      }, []);
      const go = (value) => {
        const v = String(value || "").trim();
        if (!v || !sessionId) return;
        setBusy(v);
        setError("");
        refreshPreview("preview", looksLikeUrl(v) ? { url: v } : { path: v, cwd: sessionCwd(sessionId) })
          .then(() => { openPane(); onDone(); })
          .catch((e) => setError(e.message || String(e)))
          .finally(() => setBusy(""));
      };
      return h("div", { className: "phd-card" },
        h("div", { className: "phd-title" }, tr("devTitle")),
        h("div", { className: "phd-sub" }, tr("devHint")),
        !sessionId ? h("div", { className: "phd-err" }, tr("needSession")) : null,
        s && s.running ? h("div", { className: "phd-row phd-gap" },
          h("div", { className: "phd-sub phd-grow" }, tr("previewing") + " · " + s.label),
          h("button", { type: "button", className: "phd-btn", disabled: !sessionId, onClick: () => { openPane(); onDone(); } }, tr("showPreview")),
        ) : null,
        h("div", { className: "phd-section" }, tr("localServers")),
        servers === null ? h("div", { className: "phd-sub" }, tr("scanning")) : null,
        servers && !servers.length ? h("div", { className: "phd-sub" }, tr("noServers")) : null,
        (servers || []).map((sv) => h("div", { key: sv.port, className: "phd-row phd-gap" },
          h("div", { className: "phd-grow phd-ellipsis" }, h("b", null, ":" + sv.port), sv.title ? " · " + sv.title : ""),
          h("button", { type: "button", className: "phd-btn primary", disabled: !sessionId || !!busy, onClick: () => go(sv.url) }, busy === sv.url ? tr("starting") : tr("preview")),
        )),
        h("div", { className: "phd-open" },
          h("input", { value: input, placeholder: tr("devInput"), onChange: (e) => setInput(e.target.value), onKeyDown: (e) => { if (e.key === "Enter") go(input); } }),
          h("button", { type: "button", className: "phd-btn", disabled: !sessionId || !input.trim() || !!busy, onClick: () => go(input) }, busy && busy === input.trim() ? tr("starting") : tr("preview")),
        ),
        error ? h("div", { className: "phd-err" }, error) : null,
      );
    }

    function findStatus(node, depth) {
      if (!node || depth > 6) return null;
      if (typeof node === "string") {
        const t = node.trim();
        if (!t.startsWith("{")) return null;
        try { return findStatus(JSON.parse(t), depth + 1); } catch { return null; }
      }
      if (typeof node !== "object") return null;
      if (typeof node.running === "boolean" && "starting" in node) return node;
      for (const v of Array.isArray(node) ? node : Object.values(node)) {
        const found = findStatus(v, depth + 1);
        if (found) return found;
      }
      return null;
    }

    function ToolView(props) {
      useEffect(() => ensureCss(), []);
      const running = !!(props && props.block && !("kind" in props.block));
      const fromTool = running ? null : findStatus(props, 0);
      const [status, setStatus] = useState(fromTool);
      const [busy, setBusy] = useState(false);
      useEffect(() => {
        if (running || fromTool) return;
        api("status", {}).then(setStatus).catch(() => {});
      }, [running]);
      if (running || !status) return null;
      const stop = () => {
        setBusy(true);
        api("stop", {}).then(setStatus).catch(() => {}).finally(() => setBusy(false));
      };
      return h(StatusCard, { status, busy, onStop: stop });
    }

    // ---------- docked preview ----------
    // A right-edge panel outside DSH's details column, whose width DSH caps at 520px.
    let sessions = null;
    const bus = new EventTarget();
    let previewState = null;
    const DOCK_KEY = "phd-dock-width";
    const DOCK_MIN = 320;
    let dock = { open: false, width: Number(safeStorage("get", DOCK_KEY)) || 0 };
    // The current session's composer, published by its header button.
    const bridge = { sessionId: "", draft: "", inputActions: null };

    function safeStorage(op, key, value) {
      try {
        if (op === "get") return window.localStorage.getItem(key);
        window.localStorage.setItem(key, value);
      } catch { /* ignore */ }
      return null;
    }
    function emit() {
      bus.dispatchEvent(new Event("change"));
    }
    function setPreview(s) {
      previewState = s;
      emit();
    }
    function setDock(next) {
      dock = { ...dock, ...next };
      if (next.width) safeStorage("set", DOCK_KEY, String(Math.round(next.width)));
      emit();
    }
    function refreshPreview(method, payload) {
      return api(method || "previewStatus", payload || {}).then((s) => {
        setPreview(s);
        return s;
      });
    }
    function openPane() {
      setDock({ open: true });
    }
    function closePane() {
      setDock({ open: false });
    }
    function useBus(read) {
      const [v, set] = useState(read);
      useEffect(() => {
        const on = () => set(read());
        bus.addEventListener("change", on);
        on();
        return () => bus.removeEventListener("change", on);
      }, []);
      return v;
    }
    function usePreview() {
      return useBus(() => previewState);
    }
    function useDock() {
      return useBus(() => dock);
    }
    function dockMax() {
      return Math.max(DOCK_MIN, window.innerWidth - 360);
    }
    function dockWidth(w) {
      const want = w || Math.round(window.innerWidth * 0.45);
      return Math.min(dockMax(), Math.max(DOCK_MIN, want));
    }
    function previewOrigin(s) {
      try {
        return s && s.appUrl ? new URL(s.appUrl).origin : "";
      } catch {
        return "";
      }
    }
    /** Iframe URL for the preview. A token, when present, is exchanged for a cookie and kept out of the page URL. */
    function previewFrame(s) {
      if (!s || !s.running || !s.page || !s.appUrl) return { src: "", mixed: false };
      let app;
      try { app = new URL(s.appUrl); } catch { return { src: "", mixed: false }; }
      const mixed = location.protocol === "https:" && app.protocol === "http:";
      if (mixed) return { src: "", mixed: true };
      const next = s.page.startsWith("/") ? s.page : "/" + s.page;
      if (!s.embedToken) return { src: app.origin + next, mixed: false };
      const u = new URL("/__ph/embed", app.origin);
      u.searchParams.set("t", s.embedToken);
      u.searchParams.set("next", next);
      return { src: u.href, mixed: false };
    }
    function sessionSnapshot() {
      try {
        return (sessions && sessions.list && sessions.list.getSnapshot()) || null;
      } catch {
        return null;
      }
    }
    function currentSession() {
      const snap = sessionSnapshot();
      return bridge.sessionId || (snap && snap.current) || "";
    }
    function looksLikeUrl(v) {
      return /^\d+(?:[/?#]|$)/.test(v) || /^https?:\/\//i.test(v) || /^[\w.-]+:\d+/.test(v);
    }
    function sessionCwd(sessionId) {
      const snap = sessionSnapshot();
      const row = snap && snap.byId && snap.byId[sessionId || currentSession()];
      return (row && row.cwd) || "";
    }
    function openTarget(value, sessionId) {
      const v = String(value || "").trim();
      return refreshPreview("preview", looksLikeUrl(v) ? { url: v } : { path: v, cwd: sessionCwd(sessionId) }).then((s) => {
        openPane();
        return s;
      });
    }
    function appendToComposer(text) {
      const actions = bridge.inputActions;
      if (!actions || typeof actions.setDraft !== "function") return false;
      const cur = bridge.draft || "";
      actions.setDraft((cur.trim() ? cur.replace(/\s*$/, "") + "\n\n" : "") + text + "\n");
      return true;
    }

    // ---------- quoted elements ----------
    // A quote travels as one <page-element> block: the composer shows it as a chip
    // plus a card, the model receives the block, and sent bubbles turn it back into a card.
    const QUOTE_SOURCE = "page-harness-quote";
    const QUOTE_RE = /<page-element\b([^>]*)>\n?([\s\S]*?)\n?<\/page-element>/g;
    const escAttr = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, " ");
    const unescAttr = (v) => String(v).replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

    function serializeQuote(pick) {
      const html = String(pick.outerHTML || "");
      const text = String(pick.text || "").replace(/\s+/g, " ").trim();
      const attrs = [
        ["url", pick.url || ""],
        ["selector", pick.selector || ""],
        ["tag", String(pick.tagName || "").toLowerCase()],
        ["text", text.length > 160 ? text.slice(0, 160) + "…" : text],
      ].filter(([, v]) => v).map(([k, v]) => k + '="' + escAttr(v) + '"').join(" ");
      return "<page-element " + attrs + ">\n" + (html.length > 1500 ? html.slice(0, 1500) + "<!-- … -->" : html) + "\n</page-element>";
    }
    function parseQuote(attrText, html) {
      const q = { url: "", selector: "", tag: "", text: "", html: html || "" };
      const re = /(\w+)="([^"]*)"/g;
      let m;
      while ((m = re.exec(attrText))) if (m[1] in q) q[m[1]] = unescAttr(m[2]);
      if (!q.tag) q.tag = (/^<([a-z][\w-]*)/i.exec(q.html) || [])[1] || "";
      q.tag = q.tag.toLowerCase();
      return q;
    }
    function parseQuoteBlock(block) {
      QUOTE_RE.lastIndex = 0;
      const m = QUOTE_RE.exec(block);
      return m ? parseQuote(m[1], m[2]) : null;
    }
    /** Split text into its prose and the quote blocks it carries. */
    function splitQuotes(text) {
      const quotes = [];
      QUOTE_RE.lastIndex = 0;
      const rest = String(text).replace(QUOTE_RE, (_, attrs, html) => {
        quotes.push(parseQuote(attrs, html));
        return "";
      });
      return { quotes, text: quotes.length ? rest.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() : text };
    }

    const KIND_ZH = { button: "按钮", link: "链接", image: "图片", field: "输入框", heading: "标题", text: "文本", list: "列表", media: "媒体", icon: "图标", form: "表单", nav: "导航", table: "表格", box: "区块" };
    const KIND_EN = { button: "Button", link: "Link", image: "Image", field: "Field", heading: "Heading", text: "Text", list: "List", media: "Media", icon: "Icon", form: "Form", nav: "Navigation", table: "Table", box: "Block" };
    function quoteKind(tag) {
      if (tag === "button" || tag === "summary") return "button";
      if (tag === "a") return "link";
      if (tag === "img" || tag === "picture" || tag === "canvas") return "image";
      if (tag === "input" || tag === "textarea" || tag === "select") return "field";
      if (/^h[1-6]$/.test(tag)) return "heading";
      if (tag === "video" || tag === "audio" || tag === "iframe") return "media";
      if (tag === "svg" || tag === "i") return "icon";
      if (tag === "form") return "form";
      if (tag === "nav") return "nav";
      if (tag === "ul" || tag === "ol" || tag === "li" || tag === "dl") return "list";
      if (tag === "table" || tag === "tr" || tag === "td" || tag === "th") return "table";
      if (["p", "span", "label", "strong", "em", "b", "small", "blockquote", "code", "pre"].includes(tag)) return "text";
      return "box";
    }
    function kindLabel(kind) {
      return (isZh() ? KIND_ZH : KIND_EN)[kind] || kind;
    }
    function quoteName(q) {
      const attr = (name) => {
        const m = new RegExp("\\s" + name + "=\"([^\"]*)\"", "i").exec(q.html.slice(0, 600));
        return m ? unescAttr(m[1]).trim() : "";
      };
      return q.text || attr("aria-label") || attr("alt") || attr("placeholder") || attr("title") || attr("value") || "";
    }
    function quotePage(q) {
      try {
        const u = new URL(q.url);
        return u.pathname + u.search;
      } catch {
        return "";
      }
    }
    function chipLabel(q) {
      const name = quoteName(q).replace(/\s+/g, " ").trim();
      const raw = name || kindLabel(quoteKind(q.tag));
      return raw.length > 18 ? raw.slice(0, 17) + "…" : raw;
    }

    /** The session composer's input shell (DSH conversation input facade). */
    function composerOf(sessionId) {
      try {
        const actx = sessionId && sessions && typeof sessions.scope === "function" ? sessions.scope(sessionId) : undefined;
        const conversation = actx && actx.get("conversation");
        const shell = conversation && conversation.input && conversation.input.for(actx);
        return shell ? { actx, shell } : null;
      } catch {
        return null;
      }
    }
    function inputSnapshot(shell) {
      return shell.snapshot || (shell.state && shell.state.getSnapshot && shell.state.getSnapshot()) || null;
    }
    /** Insert the block as a reference chip; false when the composer cannot take one right now. */
    function insertQuoteChip(sessionId, block, span) {
      const c = composerOf(sessionId);
      if (!c) return false;
      let st = inputSnapshot(c.shell);
      if (!st || (st.phase !== "plain" && st.phase !== "claimed")) return false;
      let at = span;
      if (!at) {
        const draft = st.draft || "";
        if (draft && !/\s$/.test(draft)) {
          c.shell.setDraft(draft + " ");
          st = inputSnapshot(c.shell);
        }
        at = { start: st.draft.length, end: st.draft.length };
      }
      const q = parseQuoteBlock(block);
      const reference = { source: QUOTE_SOURCE, ref: block, label: q ? chipLabel(q) : "element", clipboardText: block };
      return c.actx.bail(c.actx, "slash/input-insert-reference", { reference, span: { ...at, draftRev: st.draftRev } }) === true;
    }
    function quoteIntoComposer(pick) {
      const block = serializeQuote(pick);
      if (insertQuoteChip(bridge.sessionId, block)) return true;
      return appendToComposer(block);
    }
    function removeQuoteChip(sessionId, occurrenceId) {
      const c = composerOf(sessionId);
      const st = c && inputSnapshot(c.shell);
      const o = st && (st.occurrences || []).find((x) => x.occurrenceId === occurrenceId);
      if (!o) return;
      const draft = st.draft;
      const end = o.offset + o.length + (draft[o.offset + o.length] === " " ? 1 : 0);
      c.shell.setDraft(draft.slice(0, o.offset) + draft.slice(end));
    }

    /** Point the preview at an element; null clears the highlight. */
    function highlightInPreview(q, scroll) {
      const frame = document.querySelector("iframe.phd-frame");
      const origin = previewOrigin(previewState);
      if (!frame || !frame.contentWindow || !origin) return;
      frame.contentWindow.postMessage({ source: "page-harness-host", type: "ph:highlight", selector: q ? q.selector : null, scroll: !!scroll }, origin);
    }

    function Icon({ d }) {
      return h("svg", { viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
        h("path", { d, stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round" }));
    }
    const ICON_RELOAD = "M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.8h-2.8";
    const ICON_EXTERNAL = "M9 2.5h4.5V7M13.5 2.5 7.5 8.5M11.5 9.5v3.5h-9v-9H6";
    const ICON_PREVIEW = "M2 3.5h12v9H2zM6.5 3.5v9";
    const ICON_X = "M4 4l8 8M12 4l-8 8";
    const ICON_LOCATE = "M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z";
    const ICON_COPY = "M5.5 5.5h7v8h-7zM3.5 10.5v-8h7";
    const KIND_ICON = {
      button: "M2.5 5h11v6h-11zM6 8h4",
      link: "M6.8 9.2l2.4-2.4M5.6 7.4 4.4 8.6a2.3 2.3 0 0 0 3.2 3.2l1.2-1.2M10.4 8.6l1.2-1.2a2.3 2.3 0 0 0-3.2-3.2L7.2 5.4",
      image: "M2.5 3.5h11v9h-11zM2.5 10.5l3-3 3 3 2-2 3 3M10.5 6.2h.01",
      field: "M2.5 5h11v6h-11zM5 6.8v2.4",
      heading: "M4 3.5v9M10 3.5v9M4 8h6M12.5 7l1-0.5v6",
      text: "M3 4.5h10M3 8h10M3 11.5h6",
      list: "M6 4.5h7M6 8h7M6 11.5h7M3 4.5h.01M3 8h.01M3 11.5h.01",
      media: "M2.5 3.5h11v9h-11zM7 6.2v3.6l3-1.8z",
      icon: "M8 2.5l1.6 3.4 3.6.4-2.7 2.5.8 3.6L8 10.6l-3.3 1.8.8-3.6-2.7-2.5 3.6-.4z",
      form: "M3 2.5h10v11H3zM5.5 5.5h5M5.5 8h5M5.5 10.5h3",
      nav: "M2.5 4.5h11M2.5 8h11M2.5 11.5h11",
      table: "M2.5 3.5h11v9h-11zM2.5 7h11M7 3.5v9",
      box: "M2.5 2.5h11v11h-11zM2.5 6h11",
    };

    function shortSelector(sel) {
      const parts = String(sel || "").split(/\s*>\s*/).filter(Boolean);
      return parts.length > 2 ? "… " + parts.slice(-2).join(" > ") : parts.join(" > ");
    }
    /** Lightly tinted HTML: tags, attribute names and values. */
    function htmlTokens(src) {
      const out = [];
      const re = /(<\/?[\w:-]+)|(\s[\w:@.-]+)(=)("[^"]*"|'[^']*')|(\/?>)|(<!--[\s\S]*?-->)/g;
      let last = 0;
      let m;
      let i = 0;
      while ((m = re.exec(src))) {
        if (m.index > last) out.push(src.slice(last, m.index));
        if (m[1]) out.push(h("span", { key: i++, className: "t" }, m[1]));
        else if (m[2]) out.push(h("span", { key: i++, className: "a" }, m[2]), m[3], h("span", { key: i++, className: "v" }, m[4]));
        else if (m[5]) out.push(h("span", { key: i++, className: "t" }, m[5]));
        else out.push(h("span", { key: i++, className: "c" }, m[6]));
        last = re.lastIndex;
      }
      if (last < src.length) out.push(src.slice(last));
      return out;
    }

    function QuoteCard({ q, open, onToggle, onRemove }) {
      const kind = quoteKind(q.tag);
      const name = quoteName(q);
      const page = quotePage(q);
      const onKey = (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); }
        if ((e.key === "Backspace" || e.key === "Delete") && onRemove) { e.preventDefault(); onRemove(); }
      };
      return h("div", {
        className: "phd-qcard" + (open ? " open" : ""), role: "button", tabIndex: 0, "aria-expanded": open,
        title: q.selector + (page ? "\n" + page : ""),
        onClick: onToggle, onKeyDown: onKey,
        onMouseEnter: () => highlightInPreview(q), onMouseLeave: () => highlightInPreview(null),
      },
        h("span", { className: "phd-qicon" }, h(Icon, { d: KIND_ICON[kind] || KIND_ICON.box })),
        h("span", { className: "phd-qbody" },
          h("span", { className: "phd-qname" + (name ? "" : " mono") }, name || "<" + (q.tag || "element") + ">"),
          h("span", { className: "phd-qmeta" },
            h("span", { className: "phd-qtag" }, kindLabel(kind)),
            h("span", { "aria-hidden": true }, "·"),
            h("code", null, shortSelector(q.selector) || q.tag)),
        ),
        onRemove ? h("button", { type: "button", className: "phd-qx", title: tr("quoteRemove"), "aria-label": tr("quoteRemove"),
          onClick: (e) => { e.stopPropagation(); highlightInPreview(null); onRemove(); } }, h(Icon, { d: ICON_X })) : null,
      );
    }

    function QuoteDetail({ q }) {
      const [copied, setCopied] = useState(false);
      const page = quotePage(q);
      const locate = () => {
        if (!dock.open) openPane();
        setTimeout(() => highlightInPreview(q, true), dock.open ? 0 : 400);
      };
      const copy = () => {
        const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1200); };
        if (navigator.clipboard) navigator.clipboard.writeText(q.selector).then(done).catch(() => {});
      };
      return h("div", { className: "phd-qdetail" },
        h("div", { className: "phd-qdetail-bar" },
          h("code", { title: q.selector }, q.selector),
          page ? h("span", { className: "phd-qpage", title: q.url }, page) : null,
          navigator.clipboard ? h("button", { type: "button", className: "phd-icon", title: copied ? tr("copied") : tr("quoteCopySelector"), onClick: copy }, h(Icon, { d: ICON_COPY })) : null,
          h("button", { type: "button", className: "phd-qlocate", onClick: locate }, h(Icon, { d: ICON_LOCATE }), h("span", null, tr("quoteLocate"))),
        ),
        q.html ? h("pre", { className: "phd-qcode" }, htmlTokens(q.html)) : null,
      );
    }

    function QuoteRail({ items, onRemove, extra }) {
      const [openKey, setOpenKey] = useState(null);
      const opened = items.find((it) => it.key === openKey);
      return h(React.Fragment, null,
        h("div", { className: "phd-qrow" },
          h("div", { className: "phd-qrail" }, items.map((it) => h(QuoteCard, {
            key: it.key, q: it.q, open: it.key === openKey,
            onToggle: () => setOpenKey(it.key === openKey ? null : it.key),
            onRemove: onRemove ? () => onRemove(it) : undefined,
          }))),
          extra || null,
        ),
        opened ? h(QuoteDetail, { q: opened.q }) : null,
      );
    }

    /** Cards for the quote chips in the draft, docked on top of the composer. */
    function ComposerQuotes(props) {
      useEffect(() => ensureCss(), []);
      const input = props.input || null;
      const sessionId = props.sessionId || bridge.sessionId;
      const occurrences = (input && input.occurrences) || [];
      // Plain blocks (a restored draft, a paste) become chips again.
      useEffect(() => {
        if (!input || input.phase !== "plain" || (input.draft || "").indexOf("<page-element") < 0) return;
        QUOTE_RE.lastIndex = 0;
        let m;
        while ((m = QUOTE_RE.exec(input.draft))) {
          const start = m.index;
          const end = start + m[0].length;
          if (!occurrences.some((o) => o.offset < end && o.offset + o.length > start)) {
            insertQuoteChip(sessionId, m[0], { start, end });
            return;
          }
        }
      }, [input && input.draftRev]);
      const items = occurrences.filter((o) => o.source === QUOTE_SOURCE)
        .map((o) => ({ key: o.occurrenceId, id: o.occurrenceId, q: parseQuoteBlock(o.ref) }))
        .filter((it) => it.q);
      if (!items.length) return null;
      const clear = () => {
        for (const it of [...items].reverse()) removeQuoteChip(sessionId, it.id);
      };
      const clearBtn = items.length > 1
        ? h("button", { type: "button", className: "phd-qclear", onClick: clear }, tr("quoteClear"))
        : null;
      return h("div", { className: "phd-qdock" },
        h("div", { className: "phd-qpanel" },
          h(QuoteRail, { items, extra: clearBtn, onRemove: (it) => removeQuoteChip(sessionId, it.id) }),
        ));
    }

    // ---------- sent messages ----------
    let slotsRef = null;
    function splitContent(content) {
      if (typeof content === "string") {
        const s = splitQuotes(content);
        return s.quotes.length ? { quotes: s.quotes, content: s.text } : null;
      }
      if (!Array.isArray(content)) return null;
      const quotes = [];
      const next = content.map((block) => {
        if (!block || block.type !== "text" || typeof block.text !== "string") return block;
        const s = splitQuotes(block.text);
        if (!s.quotes.length) return block;
        quotes.push(...s.quotes);
        return { ...block, text: s.text };
      });
      return quotes.length ? { quotes, content: next.filter((b) => !(b && b.type === "text" && b.text === "")) } : null;
    }
    /** Wrap DSH's own renderer for a user-style node: quote blocks leave the bubble and render as cards. */
    function quotedNodeRenderer(key) {
      function QuotedUserNode(props) {
        const node = props.node;
        const content = node && node.data ? node.data.content : undefined;
        const split = React.useMemo(() => splitContent(content), [content]);
        const entries = slotsRef ? slotsRef.entries("conversation.chat.node") : [];
        const base = entries.filter((e) => e.options && e.options.key === key && e.component !== QuotedUserNode)
          .sort((a, b) => (a.options.priority || 0) - (b.options.priority || 0))[0];
        if (!base) return null;
        if (!split) return h(base.component, props);
        return h("div", { className: "phd-msg" },
          h("div", { className: "phd-msgq" }, h(QuoteRail, { items: split.quotes.map((q, i) => ({ key: i, q })) })),
          h(base.component, { ...props, node: { ...node, data: { ...node.data, content: split.content } } }));
      }
      return QuotedUserNode;
    }

    function shareSwitchOn(status) {
      return !!(status && (status.running || status.starting));
    }

    function shareLinkOf(status) {
      return status && status.running && status.shareUrl ? status.shareUrl : "";
    }

    function shareSwitchChecked(status, busy) {
      return busy ? !(status && status.running) : shareSwitchOn(status);
    }

    function PreviewPanel() {
      const s = usePreview();
      const [frameKey, setFrameKey] = useState(0);
      const [share, setShare] = useState(null);
      const [shareBusy, setShareBusy] = useState(false);
      const [shareError, setShareError] = useState("");
      const origin = previewOrigin(s);
      const frame = previewFrame(s);
      const refreshShare = useCallback(() => api("status", {}).then(setShare).catch(() => {}), []);
      useEffect(() => {
        refreshPreview().catch(() => {});
        refreshShare();
      }, [refreshShare]);
      useEffect(() => {
        if (!s || !s.starting) return;
        const t = setTimeout(() => refreshPreview().catch(() => {}), 1000);
        return () => clearTimeout(t);
      }, [s]);
      useEffect(() => {
        if (!share || !share.starting) return;
        const t = setTimeout(refreshShare, 1000);
        return () => clearTimeout(t);
      }, [share, refreshShare]);
      useEffect(() => {
        if (!origin) return;
        const onMessage = (e) => {
          if (e.origin !== origin) return;
          const pane = document.querySelector("iframe.phd-frame");
          if (!pane || e.source !== pane.contentWindow) return;
          const d = e.data;
          if (!d || d.source !== "page-harness" || d.type !== "ph:quote" || !d.pick) return;
          quoteIntoComposer(d.pick);
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
      }, [origin]);
      const src = frame.src;
      let pageUrl = "";
      try { if (src && s) pageUrl = new URL(s.page, s.target).href; } catch { /* ignore */ }
      const shareOn = shareSwitchOn(share);
      const pending = shareBusy || !!(share && share.starting);
      const shareLink = shareLinkOf(share);
      const toggleShare = () => {
        if (pending) return;
        setShareBusy(true);
        setShareError("");
        const stopping = shareOn;
        api(stopping ? "stop" : "start", stopping ? {} : { url: pageUrl, project: (s && s.project) || "" })
          .then(setShare)
          .catch((e) => {
            setShareError(e.message || String(e));
            refreshShare();
          })
          .finally(() => setShareBusy(false));
      };
      // The thumb follows the click immediately. `shareOn` is the server; while the request is in flight, show the side the user just chose.
      const switched = shareSwitchChecked(share, shareBusy);
      const newTabTitle = shareLink ? tr("newTab") + "\n" + shareLink : pending ? tr("starting") : tr("newTabWait");
      return h("div", { className: "phd-pane" },
        h("div", { className: "phd-bar" },
          h("div", { className: "phd-title phd-grow phd-ellipsis", title: s && s.label }, tr("preview") + (s && s.label ? " · " + s.label : "")),
          s && s.starting ? h("span", { className: "phd-badge off" }, tr("starting")) : null,
          src ? h("button", { type: "button", className: "phd-icon", title: tr("reload"), "aria-label": tr("reload"), onClick: () => setFrameKey((k) => k + 1) }, h(Icon, { d: ICON_RELOAD })) : null,
          src ? h("div", { className: "phd-sharebox" },
            h("button", {
              type: "button", role: "switch", className: "phd-switch" + (pending ? " busy" : ""),
              "aria-checked": switched, "aria-label": tr("share"), title: switched ? tr("shareStop") : tr("share"),
              disabled: pending || (!switched && !pageUrl),
              onClick: toggleShare,
            }, h("i", { "aria-hidden": "true" }), h("span", null, tr("share"))),
            h("button", {
              type: "button", className: "phd-icon", title: newTabTitle, "aria-label": tr("newTab"),
              disabled: !shareLink, onClick: () => window.open(shareLink, "_blank", "noopener"),
            }, h(Icon, { d: ICON_EXTERNAL })),
          ) : null,
          h("button", { type: "button", className: "phd-icon", title: tr("close"), "aria-label": tr("close"), onClick: closePane }, "×"),
        ),
        shareError ? h("div", { className: "phd-err" }, shareError) : null,
        src
          ? h("iframe", {
            key: (s.rev || 0) + ":" + frameKey, className: "phd-frame", src, title: tr("preview"), allow: "clipboard-read; clipboard-write",
            onLoad: (e) => {
              const pane = e.currentTarget;
              if (pane.contentWindow && origin) pane.contentWindow.postMessage({ source: "page-harness-host", type: "ph:hello" }, origin);
            },
          })
          : h("div", { className: "phd-empty" },
            frame.mixed ? h("div", { className: "phd-err" }, tr("mixedPreview")) : h(DevLauncher, { sessionId: currentSession(), onDone: () => {} }),
            s && s.error ? h("div", { className: "phd-err" }, s.error) : null,
          ),
      );
    }

    /** Pointer drag reporting the panel width implied by the pointer's x; `onTap` fires when it never moved. */
    // Listens on window, not with pointer capture: dragging the edge tab open unmounts the tab mid-gesture.
    function useWidthDrag(onWidth, onTap) {
      const [dragging, setDragging] = useState(false);
      const cb = React.useRef({ onWidth, onTap });
      cb.current = { onWidth, onTap };
      const stop = React.useRef(null);
      useEffect(() => () => { if (stop.current) stop.current(); }, []);
      const onPointerDown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const id = e.pointerId;
        const x0 = e.clientX;
        let moved = false;
        const move = (ev) => {
          if (ev.pointerId !== id) return;
          if (!moved && Math.abs(ev.clientX - x0) < 4) return;
          if (!moved) { moved = true; setDragging(true); }
          cb.current.onWidth(dockWidth(window.innerWidth - ev.clientX));
        };
        const end = (ev) => {
          if (ev.pointerId !== id) return;
          cancel();
          if (ev.type === "pointerup" && !moved && cb.current.onTap) cb.current.onTap();
        };
        const cancel = () => {
          cleanup();
          setDragging(false);
        };
        const cleanup = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", end);
          window.removeEventListener("pointercancel", end);
          window.removeEventListener("blur", cancel);
          stop.current = null;
        };
        if (stop.current) stop.current();
        stop.current = cleanup;
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
        window.addEventListener("blur", cancel);
      };
      return { dragging, handlers: { onPointerDown } };
    }

    /** Session the user is looking at. DSH 0.2's list has no `current`; the open one is retained by mainView. */
    function viewedSessionId(st) {
      if (!st || !st.byId) return "";
      if (st.current && st.byId[st.current] && st.byId[st.current].blank === false) return st.current;
      for (const session of Object.values(st.byId)) {
        if (session && session.blank === false && session.retainedBy && session.retainedBy.mainView > 0) return session.id || "";
      }
      return "";
    }

    function DockHost(props) {
      useEffect(() => ensureCss(), []);
      const d = useDock();
      const [, setTick] = useState(0);
      const anchor = React.useRef(null);
      const viewed = typeof props.useSessions === "function" ? props.useSessions(viewedSessionId) : "";
      const hasSession = !!(viewed || currentSession());
      const open = d.open && hasSession;
      const width = dockWidth(d.width);
      useEffect(() => {
        const onResize = () => setTick((n) => n + 1);
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
      }, []);
      useEffect(() => {
        const layer = anchor.current && anchor.current.closest("[data-shell-overlay]");
        const frame = layer && layer.parentElement;
        if (!frame) return;
        frame.style.marginRight = open ? width + "px" : "";
        return () => { frame.style.marginRight = ""; };
      }, [open, width]);
      const resize = useWidthDrag((w) => setDock({ width: w }));
      const tab = useWidthDrag((w) => setDock({ open: true, width: w }), () => {
        refreshPreview().catch(() => {});
        openPane();
      });
      const dragging = resize.dragging || tab.dragging;
      const body = open
        ? h("aside", { className: "phd-dock" + (dragging ? " dragging" : ""), style: { width: width + "px" }, "aria-label": tr("preview") },
          h("div", { className: "phd-dock-handle", title: tr("dragResize"), ...resize.handlers }),
          h(PreviewPanel),
        )
        : hasSession
          ? h("div", { className: "phd-edge" + (dragging ? " dragging" : ""), role: "button", tabIndex: 0, title: tr("dragOpen"), "aria-label": tr("preview"), ...tab.handlers,
            onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") openPane(); } }, h(Icon, { d: ICON_PREVIEW }))
          : null;
      const place = (node) => node && ReactDOM ? ReactDOM.createPortal(node, document.body) : node;
      return h(React.Fragment, null,
        h("span", { ref: anchor, hidden: true }),
        place(body),
        place(dragging ? h("div", { className: "phd-drag-shield" }) : null),
      );
    }

    function PreviewHeaderButton(props) {
      useEffect(() => ensureCss(), []);
      const d = useDock();
      const draft = typeof props.useInput === "function" ? props.useInput((st) => st.draft) : "";
      bridge.sessionId = props.sessionId || "";
      bridge.draft = draft || "";
      bridge.inputActions = props.inputActions || null;
      useEffect(() => () => {
        if (bridge.sessionId === props.sessionId) {
          bridge.sessionId = "";
          bridge.inputActions = null;
          bridge.draft = "";
        }
      }, [props.sessionId]);
      const toggle = () => {
        if (d.open) return closePane();
        refreshPreview().catch(() => {});
        openPane();
      };
      return h("button", { type: "button", className: "phd-head-btn" + (d.open ? " on" : ""), title: tr("preview"), "aria-pressed": d.open, onClick: toggle },
        h(Icon, { d: ICON_PREVIEW }), h("span", null, tr("preview")));
    }

    function findPreview(node, depth) {
      if (!node || depth > 6) return null;
      if (typeof node === "string") {
        const t = node.trim();
        if (!t.startsWith("{")) return null;
        try { return findPreview(JSON.parse(t), depth + 1); } catch { return null; }
      }
      if (typeof node !== "object") return null;
      if (typeof node.rev === "number" && "page" in node && "running" in node) return node;
      for (const v of Array.isArray(node) ? node : Object.values(node)) {
        const found = findPreview(v, depth + 1);
        if (found) return found;
      }
      return null;
    }

    function PreviewToolView(props) {
      useEffect(() => ensureCss(), []);
      const running = !!(props && props.block && !("kind" in props.block));
      const sawRunning = React.useRef(running);
      if (running) sawRunning.current = true;
      const result = running ? null : findPreview(props, 0);
      useEffect(() => {
        if (running || !result) return;
        const live = sawRunning.current;
        sawRunning.current = false;
        setPreview(result);
        // waitingForPage still needs this page's origin before page-harness can start.
        if (result.waitingForPage || (live && result.running)) {
          refreshPreview().catch(() => {});
          openPane();
        }
      }, [running, !!result]);
      if (running || !result) return null;
      return h("div", { className: "phd-card" },
        h("div", { className: "phd-row" },
          h("div", { className: "phd-title" }, tr("previewIn") + (result.label ? " · " + result.label : "")),
          h("button", { type: "button", className: "phd-btn", onClick: () => { refreshPreview().catch(() => {}); openPane(); } }, tr("showPreview")),
        ),
        result.error ? h("div", { className: "phd-err" }, result.error) : null,
      );
    }

    // ---------- turn triggers: pages written, scripts changed, servers started ----------
    const HTML_FILE = /\.html?$/i;
    const SCRIPT_FILE = /(\.(m?[jt]sx?|cjs|vue|svelte|astro|css|scss|less|py|rb|php|go)|(^|[\\/])package\.json)$/i;
    const SERVER_CMD = new RegExp([
      "\\b(npm|pnpm|yarn|bun)\\s+(run\\s+)?(dev|start|serve|preview)\\b",
      "\\bnpx\\s+(vite|next|nuxt|astro|serve|http-server|live-server|webpack)\\b",
      "(^|[\\s;&|(])(vite|next\\s+dev|nuxt\\s+dev|astro\\s+dev|webpack\\s+serve|webpack-dev-server|http-server|live-server|serve)(\\s|$)",
      "python3?\\s+-m\\s+http\\.server",
      "manage\\.py\\s+runserver",
      "\\b(flask\\s+run|uvicorn|gunicorn|hugo\\s+server|jekyll\\s+serve|rails\\s+s(erver)?)\\b",
      "\\bphp\\s+-S\\b",
      "\\b(node|bun|deno|tsx|ts-node|nodemon)\\s+(run\\s+)?\\S*(server|app|index|main|dev)\\.(m?[jt]s|cjs)\\b",
    ].join("|"), "i");

    /** Port named in a server command, when it says one. */
    function commandPort(cmd) {
      const m = /(?:--port[ =]|(?:^|\s)-[pl]\s+|\bPORT=|http\.server\s+|runserver\s+(?:[\w.]+:)?|-S\s+[\w.]+:|localhost:|127\.0\.0\.1:|0\.0\.0\.0:)(\d{2,5})\b/i.exec(cmd);
      return m ? Number(m[1]) : 0;
    }

    /** Collects each turn's shell commands and preview calls into turn data `pageHarness`. */
    const turnDefinition = {
      kind: "pageHarness",
      match: (event) => {
        if (event.type === "turn/start") return { id: String(event.data.turn), role: "start" };
        if (event.type === "tool/call") return { id: String(event.data.turn), role: "update" };
        if (event.type === "tool/result" && event.data && event.data.turn !== undefined) return { id: String(event.data.turn), role: "update" };
        return null;
      },
      start: (_context, match) => ({ turn: match.event.data.turn, servers: [], previewCalls: [], previewed: false }),
      update: (context, match) => {
        const st = context.state;
        if (match.event.type === "tool/result") {
          const msg = match.event.data.message;
          const callId = msg && msg.source && String(msg.source.callId);
          if (!callId || !st.previewCalls.includes(callId)) return st;
          const failed = !!(msg.content && msg.content[0] && msg.content[0].isError === true);
          return failed ? st : { ...st, previewed: true };
        }
        if (match.event.type !== "tool/call") return st;
        const data = match.event.data;
        if (data.name === "page_harness_preview") return { ...st, previewCalls: [...st.previewCalls, String(data.callId)] };
        if (data.name !== "bash") return context.state;
        let args = data.arguments;
        try { if (typeof args === "string") args = JSON.parse(args); } catch { return context.state; }
        const cmd = String((args && args.command) || "");
        if (!cmd || !(SERVER_CMD.test(cmd) || (args.run_in_background && commandPort(cmd)))) return context.state;
        return { ...context.state, servers: [...context.state.servers, { seq: match.event.seq, cmd: cmd.slice(0, 300), port: commandPort(cmd) }] };
      },
      buildLocationData: (context, scope) => scope !== "turn" || context.state === undefined ? null : {
        kind: "turn",
        turn: context.state.turn,
        key: "pageHarness",
        value: { servers: context.state.servers, previewed: context.state.previewed },
      },
    };

    /** What the closing turn did that could use a preview; null declines the tail. */
    function selectTurn(owner) {
      const turn = owner && owner.turn;
      if (!turn || !turn.data || typeof turn.data.get !== "function") return null;
      const produced = turn.data.get("deliverables");
      const ours = turn.data.get("pageHarness");
      const all = [];
      for (const p of (produced && produced.produced) || []) {
        if (p.seq <= owner.seq && !all.includes(p.path)) all.push(p.path);
      }
      const servers = ((ours && ours.servers) || []).filter((s) => s.seq <= owner.seq);
      const html = all.filter((p) => HTML_FILE.test(p));
      const scripts = all.filter((p) => SCRIPT_FILE.test(p));
      if (!servers.length && !html.length && !scripts.length) return null;
      const end = turn.end && turn.end.time;
      return {
        all, html, scripts, servers,
        previewed: !!(ours && ours.previewed),
        key: String(turn.turn) + ":" + owner.seq,
        live: typeof end !== "number" || Date.now() - end < 60000,
      };
    }

    const autoOpened = new Set();
    function useDevServers(enabled, ports) {
      const [servers, setServers] = useState(null);
      useEffect(() => {
        if (!enabled) return;
        let alive = true;
        api("detect", { ports: ports || [] }).then((r) => { if (alive) setServers(r.servers || []); }).catch(() => { if (alive) setServers([]); });
        return () => { alive = false; };
      }, [enabled]);
      return servers;
    }

    // Winning the chain hides ui-deliverables' produced-files row, so this tail repeats it.
    function TurnTail(props) {
      useEffect(() => ensureCss(), []);
      const m = props.matched || { all: [], html: [], scripts: [], servers: [] };
      const s = usePreview();
      const d = useDock();
      const [busy, setBusy] = useState("");
      const [error, setError] = useState("");
      const mode = m.servers.length ? "server" : m.html.length ? "html" : "script";
      const named = m.servers.map((x) => x.port).filter(Boolean);
      const detected = useDevServers(mode === "server", named);
      const name = (p) => p.split(/[\\/]/).pop();
      const go = (target) => {
        setBusy(target);
        setError("");
        openTarget(target, props.sessionId).catch((e) => setError(e.message || String(e))).finally(() => setBusy(""));
      };
      const candidates = detected === null ? [] : named.length
        ? detected.filter((x) => named.includes(x.port))
        : detected;
      useEffect(() => {
        if (mode !== "server" || !m.live || m.previewed || autoOpened.has(m.key) || detected === null) return;
        const pick = candidates.length === 1 ? candidates[0] : null;
        if (!pick) return;
        autoOpened.add(m.key);
        go(pick.url);
      }, [mode, detected === null, m.live, m.previewed, candidates.length]);

      let page = "";
      try { page = s && s.running && s.page ? decodeURIComponent(s.page.split(/[?#]/)[0]) : ""; } catch { /* ignore */ }
      const showingFile = page ? m.html.find((p) => p.replace(/\\/g, "/").endsWith(page)) : undefined;
      let previewPort = 0;
      try { if (s && s.running && s.target) previewPort = Number(new URL(s.target).port) || 0; } catch { /* ignore */ }
      const showingServer = previewPort ? candidates.find((x) => x.port === previewPort) : undefined;
      const previewedHere = mode === "server" && m.previewed && s && s.running ? s.label : "";
      const showing = showingFile ? name(showingFile) : showingServer ? ":" + showingServer.port : previewedHere;

      let text;
      let buttons = [];
      const serverButton = (x) => h("button", { key: x.port, type: "button", className: "phd-btn primary", disabled: !!busy, title: x.title || x.url, onClick: () => go(x.url) },
        busy === x.url ? tr("starting") : tr("preview") + " :" + x.port);
      const startButton = h("button", { key: "start", type: "button", className: "phd-btn primary", disabled: !bridge.inputActions, onClick: () => askAgentToStart(m.scripts) }, tr("startAndPreview"));
      if (showing) {
        text = tr("tailShowing", { name: showing });
        if (!d.open) buttons = [h("button", { key: "show", type: "button", className: "phd-btn", onClick: openPane }, tr("showPreview"))];
      } else if (mode === "html") {
        text = tr("tailAsk", { name: m.html.map(name).join("、") });
        buttons = m.html.slice(0, 3).map((p) => h("button", { key: p, type: "button", className: "phd-btn primary", disabled: !!busy, title: p, onClick: () => go(p) },
          busy === p ? tr("starting") : m.html.length > 1 ? tr("preview") + " " + name(p) : tr("openPreview")));
      } else if (mode === "server") {
        const port = named[0];
        text = detected === null ? tr("serverChecking")
          : candidates.length && !named.length ? tr("serverPick")
          : candidates.length ? tr("serverUp", { port: candidates.map((x) => ":" + x.port).join("、") })
          : port ? tr("serverDown", { port: ":" + port }) : tr("serverUnknown");
        buttons = candidates.slice(0, 3).map(serverButton);
      } else {
        text = tr("scriptAsk", { name: m.scripts.slice(0, 3).map(name).join("、") + (m.scripts.length > 3 ? "…" : "") });
        buttons = [startButton];
      }
      return h("div", null,
        h("div", { className: "phd-tail" },
          h(Icon, { d: ICON_PREVIEW }),
          h("span", { className: "phd-grow phd-ellipsis", title: text }, text),
          buttons,
          error ? h("div", { className: "phd-err" }, error) : null,
        ),
        m.all.length && typeof props.openFile === "function" ? h("div", { className: "phd-produced" },
          h("span", null, tr("produced")),
          m.all.slice(0, 8).map((p) => h("button", { key: p, type: "button", className: "phd-chip", title: p, onClick: () => props.openFile(p) }, name(p))),
          m.all.length > 8 ? h("span", null, "+" + (m.all.length - 8)) : null,
        ) : null,
      );
    }

    function askAgentToStart(scripts) {
      const actions = bridge.inputActions;
      if (!actions) return;
      const names = scripts.slice(0, 3).map((p) => p.split(/[\\/]/).pop()).join(", ");
      actions.setDraft(tr("askStart", { name: names }));
      if (typeof actions.submit === "function") setTimeout(() => actions.submit(), 0);
    }

    const inject = ["slots"];
    let ReactDOM = null;
    function registerSlot(slots, options, component) {
      const next = { ...options };
      if (next.id == null && next.key != null) next.id = String(next.key);
      if (next.key == null && next.id != null) next.key = next.id;
      return slots.register(next, component);
    }
    function apply(ctx) {
      const slots = ctx.slots;
      if (!slots) return;
      try { ReactDOM = require("react-dom"); } catch { ReactDOM = null; }
      ctx.effect(() => {
        ensureCss();
        return () => {};
      }, "page-harness-style");
      for (const key of ["page_harness_share", "page_harness_status"]) {
        slots.inject("tool.call.toolview", () => registerSlot(slots, { name: "tool.call.toolview", key }, ToolView));
      }
      slots.inject("sidebar.footer.action", () => registerSlot(
        slots,
        { name: "sidebar.footer.action", id: "page-harness-dev", order: 9, label: () => tr("devTitle") },
        SidebarAction,
      ));
      ctx.inject(["sessions"], (c) => {
        sessions = c.sessions;
        c.effect(() => () => { sessions = null; }, "page-harness-sessions");
      });
      slots.inject("shell.overlay", () => registerSlot(slots, { name: "shell.overlay", id: "page-harness-dock" }, DockHost));
      slots.inject("conversation.session.header.actions", () => registerSlot(
        slots,
        { name: "conversation.session.header.actions", id: "page-harness-preview", order: 50 },
        PreviewHeaderButton,
      ));
      ctx.inject(["conversationEvents"], (c) => {
        c.conversationEvents.register(turnDefinition);
      });
      slots.inject("conversation.chat.turnTail", () => slots.register({ name: "conversation.chat.turnTail", id: "page-harness-turn", priority: -10, select: selectTurn }, TurnTail));
      slots.inject("tool.call.toolview", () => registerSlot(slots, { name: "tool.call.toolview", key: "page_harness_preview" }, PreviewToolView));
      slotsRef = slots;
      ctx.inject(["inputTriggers"], (c) => {
        c.effect(() => c.inputTriggers.registerSource({
          trigger: "@",
          name: QUOTE_SOURCE,
          order: 99,
          showGroupTitle: false,
          candidates: async () => [],
          onPick: () => undefined,
          codec: { clipboardText: (ref) => ref, serialize: (ref) => Promise.resolve(ref) },
        }), "page-harness-quote-source");
      });
      slots.inject("conversation.input.dock", () => slots.register({ name: "conversation.input.dock", id: "page-harness-quotes", order: 30 }, ComposerQuotes));
      for (const key of ["user", "steering"]) {
        const renderer = quotedNodeRenderer(key);
        slots.inject("conversation.chat.node", () => slots.register({ name: "conversation.chat.node", key, priority: -10, locale: "conversation" }, renderer));
      }
    }

    return { inject, apply };
  },
});
