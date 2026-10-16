<p align="center">
  <img src="https://cdn.jsdelivr.net/npm/page-harness@0.1.10/docs/logo.svg" width="72" alt="page-harness logo">
</p>

<h1 align="center">page-harness</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/page-harness"><img alt="npm page-harness" src="https://img.shields.io/npm/v/page-harness?label=npm&labelColor=16161A&color=7C5CFF&style=flat-square"></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-7C5CFF?labelColor=16161A&color=7C5CFF&style=flat-square"></a>
  <img alt="Node" src="https://img.shields.io/badge/node-%E2%89%A520.11-7C5CFF?labelColor=16161A&color=7C5CFF&style=flat-square">
</p>

<p align="center">
  <a href="./README.md">English</a> · <b>简体中文</b>
</p>

<p align="center">
  <a href="#概览">概览</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#上手看看">上手看看</a> ·
  <a href="#功能">功能</a> ·
  <a href="#用法">用法</a> ·
  <a href="#文档">文档</a> ·
  <a href="#开发">开发</a>
</p>

https://github.com/user-attachments/assets/7fe5d123-58e2-4aa2-a5e3-f7fe9eae51b7

## 概览

**把正在跑的网页，直接变成编码 Agent 的工作台。**

在页面上点一下要改的地方，就能跟 Agent 说怎么改：取点、聊天、看产物，背后用的就是你电脑上已经装好的 Agent CLI（Claude Code、Codex、Cursor Agent、CodeBuddy Code、OpenCode）。只想收集意见的话，`--no-agent` 只留取点和意见；不给地址直接跑，会打开一个书签主页，把 **✦ Page-Harness** 拖到书签栏，任何网页都能标。

在终端里描述界面挺折磨人的：“左边卡片里第二个按钮，颜色再柔和一点”。我就想直接在页面上点一下，跟 Agent 说改成什么样。它改代码，dev server 刷新，结果就在同一个页面上看。page-harness 干的就是这件事。

## 快速开始

对着你的 dev server 敲一行：

```bash
npx page-harness http://localhost:5173 --project ./my-app
npx page-harness --no-agent http://localhost:5173   # 只评审：取点 + 意见，不启动 Agent CLI
npx page-harness                                    # 不给地址：打开书签主页
```

然后打开 <b>http://127.0.0.1:17990</b>。页面还是你的应用，只是右下角多了个底栏。

- 需要 **Node.js 20.11+**，`PATH` 里至少有一个登录好的 Agent CLI（见下文）。
- 地址可以只写端口（`3000`）、`host:port` 或完整 URL。Vite、webpack、Next.js 这些的热更新照常能用，WebSocket 也代理过去了。
- 不要沙箱，不要注册账号，也不碰你的项目代码。数据都放在 `<project>/.page-harness/` 里。

| 服务 | 地址 |
|---|---|
| 你的应用 + 底栏 | `http://127.0.0.1:17990` |
| 面板 / API（控制端口） | `http://127.0.0.1:17991` |
| 对话历史 | `http://127.0.0.1:17991/__ph/history` |
| 书签主页（不给地址时） | `http://127.0.0.1:17991` |

### 其他跑法

| 方式 | 什么时候用 |
|---|---|
| `npx page-harness <地址>` | 上面这种标准用法：应用走代理，取点、对话、产物都由 Agent CLI 驱动 |
| `--no-agent <地址>` | 只收意见：取点 + 意见，不需要 Agent CLI（[详细](#仅评审--no-agent)） |
| 不给地址 | 打开带 **✦ Page-Harness** 书签的主页，不走代理也能在任意网站上留意见（[详细](#书签不给地址)） |
| `--share` | 同一网络的同事拿链接进来当评审（[详细](#团队评审--share)） |

## 上手看看

### 仅评审

**只有取点和意见。** 加 `--no-agent` 就不启动 Agent CLI。点元素留评论或者直接改，回复、解决、按页面审批都行。[详细 →](#仅评审--no-agent)

<p align="center"><img src="https://cdn.jsdelivr.net/npm/page-harness@0.1.10/docs/review-only-zh.png" width="720" alt="仅评审模式下的页面意见面板"></p>

### 书签主页

**就一个按钮，拖走就行。** 不给地址直接跑 `npx page-harness`，主页上只有一个 **✦ Page-Harness** 按钮，拖到书签栏。[详细 →](#书签不给地址)

<p align="center"><img src="https://cdn.jsdelivr.net/npm/page-harness@0.1.10/docs/home-zh.png" width="520" alt="主页上的 ✦ Page-Harness 按钮"></p>

### 任意网站留意见

**打开哪个网页都能点。** 底栏直接注入到当前页面（放在 Shadow DOM 里，不走代理），意见存到本机服务，按网站分好。

<p align="center"><img src="https://cdn.jsdelivr.net/npm/page-harness@0.1.10/docs/bookmarklet-zh.png" width="720" alt="书签注入到普通页面上的底栏"></p>

### 我的标记

**所有网站的意见都在这。** 左边网站，右边这个网站的意见，可以导出 Markdown、导出 JSON，或者复制 Prompt 丢给 Agent。

<p align="center"><img src="https://cdn.jsdelivr.net/npm/page-harness@0.1.10/docs/home-notes-zh.png" width="720" alt="我的标记页"></p>

## 原理

```text
浏览器 ──► :17990  应用端口  反向代理到你的开发服务器，在 HTML 里注入 /__ph/overlay.js
       └─► :17991  控制端口  面板 UI、聊天记录页、JSON API、WebSocket、MCP
                      │
                      └─ 每一轮对话启动一次 Agent CLI（claude -p / codex app-server / cursor-agent -p /
                        codebuddy -p / opencode run --format json），
                         并接入本地 MCP：page_*、产物、提问、Live
```

- 底栏在 Shadow DOM 里，和你的样式互不影响。对话窗、产物窗是来自控制端口的 iframe，通过 `MessagePort` 握手和页面通信。
- 每个会话记住 Agent 的 session id，后续消息续接同一个 Agent 会话；一轮还在跑时发的消息进入该会话的队列。
- Agent 会收到一段简短的系统提示，说明页面上下文、MCP 工具和 Live 协议。除了 `.page-harness/`（自带 `.gitignore`）和 Live 期间的临时候选标记外，不会往你的项目里写东西。

### MCP 工具

| 工具 | 用途 |
| --- | --- |
| `page_state`、`page_click`、`page_input`、`page_select`、`page_scroll` | 读取与操作页面（仅在用户允许页面控制时可用） |
| `write_artifact`、`read_artifact`、`list_artifacts`、`set_artifact_preview` | 带版本的产物，存放在 `.page-harness/artifacts` |
| `ask_question`、`ask_form` | 向用户提问并等待回答（最长 30 分钟） |
| `live_update` | 上报 Live 候选的 ready / done / failed |
| `live_patch_variants` | 仅评审模式：以一组页面修改的形式给出 Live 候选 |
| `page_note`、`list_review`、`reply_review`、`resolve_review`、`remove_review` | 在页面上钉意见，读取大家的反馈，回复并标记解决 |
| `page_patch` | 仅评审模式：对元素做临时的文字、CSS 或图片修改 |

### Live 候选

收到 Live 请求时，Agent 在源码里把目标元素包成这样：

```html
<div data-ph-live="L1a2b3c4" style="display:contents">
  <h1 data-ph-variant="0" hidden>原版</h1>
  <h1 data-ph-variant="1" data-ph-variant-label="Bold">…</h1>
  <h1 data-ph-variant="2" data-ph-variant-label="Soft" hidden
      data-ph-params='[{"name":"gap","type":"range","min":0,"max":40,"unit":"px"}]'>…</h1>
</div>
```

开发服务器热更新后，底栏找到这个包裹层并接管各候选的显示与隐藏（参数以 `--ph-<name>` CSS 变量写在包裹层上）。采用时让 Agent 只保留选中的候选并去掉包裹层；放弃则还原原版。每次 Live 或改了文件的回合结束后，会用 `git grep` 扫描工作区，发现遗留标记就提醒；`--live-guard-hook` 还会拦住含标记的提交。

### 评审模式（没有源码）

目标是公网站点（不是 localhost、内网 IP 或局域网主机名）时，手里没有源码可改，page-harness 会以评审模式启动；也可以用 `--review` / `--source` 强制指定。

- Agent 会被告知不要改文件、不要做原型。`write_artifact` 只接受报告类文件（`.md`、`.txt`、`.json`、`.csv`、图片），HTML/SVG 原型会被拒绝。
- 结论直接落在页面上：`page_note` 在元素上钉一条带编号的意见（问题 / 建议 / 说明）；`page_patch` 修改元素的文字、CSS 或图片（`src` / `alt`），原地看到效果。不支持改 HTML 结构。
- 两个工具都会先拿选择器到你打开的页面上核对（不需要页面控制权限），选择器写错会直接反馈给 Agent，而不是钉了个空。
- 人也可以直接动手：用「取点」选中元素，点「评论」留言，或点「编辑」实时预览地修改文字、颜色、背景、字号、字重、内边距、圆角或图片，保存为一条修改。
- **Live** 在这里也能用，候选是页面修改：Agent 用 `live_patch_variants` 给出 2–4 个候选，每个候选是最多 12 个元素上的文字 / CSS / 图片修改。在页面上切换、看原版、细化；采用后选中的候选存为「意见」里的修改条目，放弃则还原页面。没有并排对比、参数调节和插入，这些需要源码。

### 意见、讨论与审批

意见在两种模式下都能用；手动编辑和 `page_patch` 只在没有源码时可用。

- 意见属于创建它的页面（路径，忽略 hash、末尾斜杠和统计参数），也属于**网站**（`host`：主机名，非默认端口一并算上）。代理模式存的是目标网站的 host；书签模式存的是 `location.host`。覆盖层只钉当前网站的意见。「本页」只看当前页面；「全部」按该网站的页面分组，点其他页面的条目会跳过去并打开它。底栏角标只计当前页面未解决的意见，其他页面有意见时显示小圆点。
- 每个图钉打开一个讨论串：作者、回复、解决 / 重新打开、修改与原版对比、引用到对话（所有者）、删除（作者或所有者）。
- 「通过」/「需修改」按页面、按人记录审批结论。
- 页面重新渲染或改版导致选择器失效时，用指纹（标签、id、稳定的 class、关键属性、文字及上下文）重新定位。没有足够匹配的元素时显示「页面上找不到了」，而不是钉到错误的元素上。刷新和重新渲染后修改会自动重新套上，不会向站点发送任何东西。
- Agent 用 `list_review` 看到大家的意见，用 `reply_review` 回复，用 `resolve_review` 附上说明后关闭；它只能删除自己的条目。
- 「导出」把 `page-review.md`（意见、文字前后对比、CSS、回复、审批）写入产物。

### 团队评审（`--share`）

```bash
npx page-harness https://example.com --share
#   Share  http://192.168.1.20:17991/__ph/join?t=…
```

把 Share 链接（设置 → 团队里也有）发给同一网络的同事。打开后这个浏览器获得评审者身份，填一次显示名，就能实时看到页面上所有人的意见和修改。评审者可以评论、编辑（评审模式）、回复、解决、审批；不能使用或看到 Agent、对话、聊天记录、上传和页面控制。没有链接的其他机器一律 `403`。

同事需要能访问两个端口：应用端口和控制端口。在云主机上，放行这两个端口，并加 `--public-host <公网 IP 或域名>`，邀请链接就会指向它。想在 DeepSeek Harness 里一键启动分享预览，见 [`dsh-plugin/`](./dsh-plugin/README.md)。

## 功能

| 模块 | 亮点 |
|---|---|
| **取点（Pick）** | 点页面上任意元素，可以**引用到对话**（选择器、文字、HTML 一起带过去，Shift+点击直接引用）、**留意见**、**直接改**（没源码的站），或者开 **Live 候选**。 |
| **Live 候选** | 说一句想怎么改，Agent 直接在源码里写 2–4 个方案。页面上来回切、并排对比、调参数、挑一个继续打磨，满意就采纳，不满意就丢掉。 |
| **对话** | 窗口能拖能缩放。流式 Markdown、可折叠的思考过程、工具卡片、改动文件列表、图片/文件附件、每个对话自己的消息队列（能排序、改、撤回）、停止/重试，多个对话各自选 Agent 和模型。 |
| **产物（Artifacts）** | Agent 通过 MCP 写报告、原型、JSON、图片，分标签预览，带版本历史，能导出 PNG/PDF。 |
| **页面控制**（默认关） | 允许 Agent 读页面、点击、输入、选择、滚动。开着的时候有横幅提示，随时能收回。 |
| **意见与评审** | 在元素上钉评论、楼中楼回复、解决、按页面审批。没有源码的站也能用（评审模式）。 |
| **团队评审** | 加 `--share`，同一网络的同事拿链接就能进来当评审。 |
| **提问** | Agent 可以给你出选择题或者小表单，等你回答再继续。 |
| **历史** | 每个对话都是磁盘上只追加的事件日志，能浏览、搜索、导出。 |

### 支持哪些 Agent

用你本来就在用的 CLI，装了哪些会自动检测：

| Agent | 命令 | 安装 |
|---|---|---|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `claude` | 见官方文档 |
| [Codex](https://github.com/openai/codex) | `codex` | 见官方文档 |
| [Cursor Agent](https://docs.cursor.com/en/cli/overview) | `cursor-agent` | 见官方文档 |
| [CodeBuddy Code](https://www.codebuddy.ai/cli) | `codebuddy` | `npm i -g @tencent-ai/codebuddy-code` |
| [OpenCode](https://opencode.ai) | `opencode` | `npm i -g opencode-ai` |

用 `--agent claude|codex|cursor|codebuddy|opencode` 指定（默认用第一个装了的）。装在别的位置就用 `--claude-path`、`--codex-path`、`--cursor-path`、`--codebuddy-path`、`--opencode-path`。

| | Claude Code | Codex | Cursor Agent | CodeBuddy Code | OpenCode |
|---|---|---|---|---|---|
| 流式文字 / 思考过程 | ✓ | ✓ | ✓ | ✓ | 按段¹ |
| 工具卡片、改动文件 | ✓ | ✓ | ✓ | ✓ | ✓¹ |
| 续接对话 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 模型列表 | ✓ | ✓ | ✓ | ✓（取自 `--help`） | ✓（`opencode models`） |
| 推理强度 | – | ✓ | – | ✓（`--effort`） | ✓（`--variant`） |
| 图片附件 | ✓ | ✓ | 只传文件路径 | ✓ | ✓（`--file`） |

¹ `opencode run --format json` 只在每段文字、思考和工具调用结束后才输出，所以回复是一段一段出来的，工具卡片也是一次性出现并完成。

## 用法

```text
page-harness [前端地址] [选项]

  --project <dir>        Agent 工作的项目目录（默认当前目录）
  --agent <id>           claude | codex | cursor | codebuddy | opencode（默认第一个已安装的）
  --model <name>         新会话的默认模型
  --port <n>             应用端口：代理后的前端（默认 17990）
  --control-port <n>     面板 / API 端口（默认应用端口 + 1；不给地址时默认 17991）
  --host <addr>          监听地址（默认 127.0.0.1）
  --allow-host <name>    额外允许的 Host 头（可重复），比如局域网域名
  --keep-host            把浏览器的 Host 头原样转发给目标
  --public-scheme <s>    http | https：浏览器访问两个端口用的协议（默认 http）；
                         放在同端口卸载 TLS 的负载均衡后面时用 https
  --open                 自动打开浏览器
  --live-guard-hook      安装 git pre-commit 钩子，拒绝提交 Live 候选标记
  --review / --source    强制评审模式（无源码）或源码模式；默认按域名判断
  --no-agent             仅评审。不检测、不启动 Agent CLI。底栏只有取点和意见。
                         不给前端地址时默认就是这个模式。
  --lang <zh|en>         主页和底栏的语言。不写时，每个浏览器沿用自己的选择。
  --share                允许同一网络的同事以评审者身份加入（监听 0.0.0.0）
  --public-host <name>   同事访问用的主机名或 IP，写进邀请链接并加入 Host 白名单
  --json                 监听成功后往 stdout 打一行包含各地址的 JSON
  --embed-origin <origin>  允许这个源用 iframe 嵌入页面和面板，取点引用会 postMessage 给它（可重复）
  --verbose / --quiet
```

`<前端地址>` 可以是端口（`3000`）、`host:port` 或完整 URL。不写地址就只打开书签主页。开发服务器的热更新（Vite、webpack、Next.js 等）通过代理照常工作，包括 WebSocket。

### 仅评审（`--no-agent`）

```bash
npx page-harness --no-agent http://localhost:5173
```

不会检测或启动任何 Agent CLI，MCP 也会被拒绝。底栏只有**取点**和**意见**：评论、编辑、回复、解决、审批。没有对话、产物、Live、页面控制和提问。意见仍写在项目的 `review.json` 里，按**目标网站**的 host 存放（不是代理自己的 `127.0.0.1:17990`）。

### 书签（不给地址）

```bash
npx page-harness
# 主页  http://127.0.0.1:17991
```

这时只启动控制端口，并且一定是仅评审。主页就一个按钮 **✦ Page-Harness**：拖到书签栏，打开任意网站点一下就行。点了没反应的话，主页上的「遇到问题？」列了几种常见原因。书签只在这次启动期间有效，重启后得再拖一次。覆盖层直接注入到那个页面（不经过反向代理），放在 Shadow DOM 里，宿主页面的 CSS 改不到底栏。脚本始终从本机加载：`http://127.0.0.1:<控制端口>/__ph/overlay.js`。

`--lang zh` 或 `--lang en` 同时决定主页和底栏的语言（导出的 Markdown 和复制的 Prompt 也跟着走）。不写时，每个浏览器沿用已保存的选择，否则用浏览器语言。

意见写回这台本机服务，按网站分组（`location.host`，非默认端口也算进去）。点右上角「我的标记 (n)」进到标记页：左边是网站列表，右边是该网站的意见，可以导出 Markdown、导出 JSON，以及复制 Prompt。复制出来的说明指向这个控制端口，并带上 `host=`，Agent 只会拉取这个网站：

```text
GET http://127.0.0.1:17991/__ph/api/review?scope=all&path=%2F&page=1&pageSize=20&host=shop.example.com
```

分页接口同样接受 `host`。不传时仍返回所有网站，和以前一样。

**限制。** https 页面通常会拦截从 `http://127.0.0.1` 加载的脚本（混合内容），保存意见时仍然要请求这个 http 控制端口。Chrome 一般允许访问 `127.0.0.1`，并可能弹出本地网络权限；书签相关的响应会带 `Access-Control-Allow-Private-Network`。Firefox 和 Safari 多半会把这次请求当成混合内容拦掉。宿主页面的 CSP 如果禁止连接 `127.0.0.1`，保存也会失败。书签连不上控制端口时，改用 `page-harness <网址> --no-agent`，通过代理做评审。书签里带有本次运行的令牌（请求头 `X-PH-Token`），收藏夹和你点过书签的页面能看到它；没有令牌的其他网站不能读写意见。不带鉴权的分页接口（`GET /__ph/api/review`）不返回 CORS 头，随便一个网页不能靠它把意见读走。

## 安全模型

用户使用上不需要登录：这是本地开发工具，默认只监听 `127.0.0.1`。内部各个入口都有鉴权：

- **两个源。** 你的应用（以及其中任何脚本）在应用端口；面板、API、Agent 接口在控制端口，页面脚本读不到。
- **所有者与评审者。** 不加 `--share` 时只有本机能连，一切按单用户处理。加了 `--share` 后，所有者会话只发给本机回环请求；其他机器必须通过邀请链接拿到带 HMAC 签名的评审者 Cookie（面板和应用端口各一个），没有就两个端口都返回 `403`。评审者在 WebSocket 上只能做评审操作，API 只能读产物，其余一律 `403`。所有者名字在设置 → 团队里修改。
- **会话 Cookie。** 面板拿到 `HttpOnly`、`SameSite=Strict`、作用于 `/__ph` 的 Cookie；转发到你的开发服务器前会去掉它。
- **API。** 读请求要求同源的 `Sec-Fetch-Site`；写请求要求匹配的 `Origin` 加自定义 `X-PH` 头。WebSocket 校验 Cookie 和 `Origin`。书签是例外：跨源读写意见必须带本次运行的 `X-PH-Token`，响应会反射该页面的 `Origin`（不会是 `*`）。`GET /__ph/api/review` 仍给 curl 用，不带 CORS 头。
- **MCP。** 每一轮 Agent 调用都发一个独立的 Bearer token（通过环境变量或私有临时文件传递，不出现在命令行），回合结束即作废。来自浏览器的 MCP 请求一律拒绝。
- **Host 白名单。** `Host` 头不符的请求返回 `421`（防 DNS rebinding）。在局域网使用时用 `--allow-host` 添加。
- **嵌入限制。** 面板只允许被应用源嵌入；聊天记录页不允许被任何页面嵌入。
- **产物。** HTML / SVG 产物带 `sandbox` CSP 返回，并放在不含 `allow-same-origin` 的 iframe 里展示。
- **页面控制**需要在浏览器里手动开启，开启时有横幅提示，密码框的值不会发给 Agent。

Agent 以各自 CLI 的非交互权限在 `--project` 里运行（例如 Claude Code `--permission-mode bypassPermissions`、Codex 关闭审批、Cursor Agent `--force`、CodeBuddy Code `--permission-mode bypassPermissions`、OpenCode `run --auto`）。只对你愿意让 Agent 修改的项目使用。

## 数据

全部保存在 `<project>/.page-harness/`：

```text
chats/<id>/meta.json        标题、Agent、模型、session id
chats/<id>/events.jsonl     只追加的事件日志（提问、增量、工具、结果）
artifacts/<name>/v<n>       产物各版本 + index.json
uploads/                    附件
live.json                   Live 会话
review.json                 意见、页面修改、回复与审批
team.json                   邀请 token、签名密钥和评审者名字（权限 600）
```

删除该目录即可重置。

## 常见问题

**要改我的项目吗？**
不用。page-harness 就是个反向代理，往 HTML 里塞一个脚本。除非 Agent 改了，你的代码一行都不动。

**没有源码的网站能用吗？**
能。公网地址默认进评审模式：Agent 只在页面上留意见、做临时改动，不碰文件。想强制切换用 `--review` / `--source`。

**用什么模型？要 API Key 吗？**
你的 Agent CLI 登录的是什么就用什么。page-harness 自己没有账号也没有 Key，每个对话可以单独选模型。

**安全吗？**
默认只监听 `127.0.0.1`，不需要登录。`--share` 才会开放到局域网，同事要拿签名过的邀请链接才能进。Agent 以非交互权限在 `--project` 里跑，所以只对你放心让它改的项目用。

**Live 的标记会不会留在代码里？**
每次 Live 或改文件之后都会扫一遍工作区，有残留就提醒你；加 `--live-guard-hook` 还会装一个 pre-commit 钩子直接拦下来。

**怎么重置？**
删掉 `<project>/.page-harness/` 就行。

## 文档

| 从这里开始 | |
|---|---|
| [快速开始](#快速开始) | 安装和第一次跑起来 |
| [用法](#用法) | 全部命令行参数、仅评审和书签 |
| [原理](#原理) | 代理、覆盖层、MCP 工具、Live 候选、评审模式 |
| [安全模型](#安全模型) | 哪些地方锁住了，怎么锁的 |
| [数据](#数据) | `.page-harness/` 里存了什么 |
| [常见问题](#常见问题) | 大家常问的 |
| [官网](https://cocofhu.github.io/page-harness-site/) | 产品演示与安装 |
| [npm 包](https://www.npmjs.com/package/page-harness) | 已发布的版本 |

## 开发

```bash
npm install
npm run dev            # 监听并重建前端脚本与 CLI
node dist/cli.js http://localhost:5173 --project ../some-app

npm run lint
npm run typecheck
npm test               # 单元测试 + 服务端集成测试（脚本化 Agent）
npx playwright install chromium
npm run build && npm run test:e2e   # 基于示例应用的浏览器测试
```

设置 `PH_FAKE_AGENT=1` 会多出一个脚本化的 `fake` Agent，测试用它走真实的 MCP 接口，不需要大模型就能覆盖整条链路。

## 参与贡献

欢迎到 [Tencent/page-harness](https://github.com/Tencent/page-harness) 提 Issue 和 PR。

- **流程：** Fork → 开分支 → 提交 → 开 PR
- **推之前跑一下：** `npm run lint`、`npm run typecheck`、`npm test`；动了界面的话再跑 `npm run build && npm run test:e2e`

## 许可证

[MIT](./LICENSE)。打包进来的第三方代码见 [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md)。

