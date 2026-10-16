# page-harness-dsh

DeepSeek Harness 插件，两个功能：

- **右栏预览**：Agent 写完网页后，对话右侧直接显示页面，上面带 page-harness 的取点和意见。取点后点「引用到对话」，元素的选择器、文字和 HTML 会填进输入框。
- **分享预览**：一键启动 page-harness 分享预览。同事打开分享链接，就能在正在运行的页面上取点、留意见、审批。

## 安装

先在仓库根目录构建 page-harness，再把本目录装进 web profile：

```sh
npm ci && npm run build
dsh plugin --profile web add /absolute/path/to/page-harness/dsh-plugin
```

重启 `dsh web`，强制刷新浏览器。插件会优先使用同一仓库的 `dist/cli.js`；也可以在设置里填 `cliPath`。

## 右栏预览

- **开发中随时打开**：点侧栏底部的 **开发预览**，会列出本机正在运行的 dev server（常见端口 3000、5173、8080 等，带页面标题），点 **预览** 就在当前对话右侧打开；也可以输入端口、URL 或工作区里的 HTML 文件。
- Agent 写完或改完网页会调用 `page_harness_preview`，右栏自动打开并刷新。HTML 文件由插件在本机起的静态服务提供；也可以传 dev server 端口或 URL。
- 某一轮写了 HTML 文件时，对话里会出现「写了网页 xxx.html，要在右侧预览吗？」，点 **在右侧预览** 即可。
- 某一轮改了脚本（js/ts/vue/svelte/css/py/package.json 等）时，会问「改了 xxx，要开启预览吗？」，点 **启动服务并预览**，Agent 会启动开发服务并在右侧预览。
- 启动不能保证一次成功。插件先请求这个地址：通了才打开预览。纯静态站点由插件自己提供，不经过 Agent。需要 dev server 时，插件不会猜命令，只把**一条命令和一个目录**交给 Agent；Agent 跑完后用同一个地址再调一次，插件确认端口真的通了才打开。端口被占用时，预览会自动改用下一对端口再试一次。
- 让 Agent 启动服务（`npm run dev`、`vite`、`python -m http.server`、`flask run`、`uvicorn`、`node server.js` 等）时，按上面的结果执行；万一它没打开预览，这一轮结束时插件找到对应端口就自动打开，找不到就在对话里提示。
- 会话标题栏的 **预览** 按钮开关右栏；没有预览时右栏里会列出本机的 dev server，也可以输入文件路径（如 `index.html`）或端口。
- 右栏宽度随意拖：拖右栏左边缘调宽度（会记住），对话区跟着变窄，不会被遮住。关掉后屏幕右边缘留一个小把手，点它或向左拖就能打开。
- 预览里点 **取点** 选中元素，再点 **引用到对话**，内容会追加到输入框；点 **意见** 留批注，之后说「按意见改」，Agent 会调用 `page_harness_notes` 读取并修改。

预览用 `previewPort`（默认 `17994`）和 `previewPort + 1`，静态文件服务只监听 `127.0.0.1`，优先用 `previewPort + 2`。iframe 地址是「浏览器访问 DSH 用的主机名 + 这两个端口」：

- 浏览器和 DSH 在同一台机器，或通过 SSH 转发访问：预览只监听 `127.0.0.1`。SSH 转发时把预览的两个端口也转过去，例如

  ```sh
  ssh -L 3080:127.0.0.1:3080 -L 17994:127.0.0.1:17994 -L 17995:127.0.0.1:17995 your-host
  ```

- 从其他地址打开 DSH（公网 IP、域名）：预览监听 `0.0.0.0`，安全组要放行这两个端口。远程浏览器必须先用嵌入令牌换 Cookie，否则页面返回 403。令牌只出现在 `--json` 的 ready 行里，由插件放进 iframe，不会写进普通日志。

page-harness 只允许 DSH 页面的源（第一次调用插件接口时记录）嵌入预览，取点引用也只发给这个源。HTTPS 页面不能嵌入 HTTP 预览。

## 分享预览

- **预览栏**：预览打开后，拨动右栏的分享开关即启动当前页面的分享。开关打开后，旁边的新标签按钮才可点，打开的就是这条分享链接。再拨一次即关闭。
- **对话**：直接说「把 5173 分享给同事看看」，Agent 会调用 `page_harness_share`，对话里出现分享卡片。

| 工具 | 作用 |
| --- | --- |
| `page_harness_preview` | 在右栏预览网页（`path`，默认 `index.html`；或 `url`）。再次调用会刷新 |
| `page_harness_notes` | 读取预览上未解决的意见 |
| `page_harness_share` | 启动分享预览（`url`，可选 `project`，默认当前会话的工作目录）。同一页面重复调用会复用 |
| `page_harness_status` | 查看是否在运行和分享链接 |
| `page_harness_stop` | 停止分享 |

同一时间只运行一个分享预览；换一个页面会先停掉旧的。`dsh web` 退出或重启时会一起停掉。

## 端口与网络

page-harness 用两个相邻端口：分享端口 `port`（页面）和 `port + 1`（邀请链接、意见面板）。同事要能访问这两个端口。

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `previewPort` | `17994` | 右栏预览端口。本机或 SSH 转发时只监听 `127.0.0.1`；从其他地址打开 DSH 时监听 `0.0.0.0`，并用嵌入令牌限制访问。控制端口是它 +1 |
| `port` | `17990` | 分享端口，控制端口是它 +1 |
| `host` | `0.0.0.0` | 监听地址 |
| `publicHost` | 空 | 同事访问用的主机名或 IP。云主机填公网 IP 或域名；留空用本机第一个局域网地址 |
| `publicScheme` | `http` | 前面有 TLS 终止时选 `https` |
| `withAgent` | `false` | 同时启用本机 Agent CLI。默认只评审 |
| `cliPath` | 空 | `dist/cli.js` 路径，留空自动查找 |

在云主机上：安全组放行 `port` 和 `port + 1`，并把 `publicHost` 设为公网地址。

## 安全

- 没有邀请链接的机器访问分享的两个端口都返回 `403`；邀请换来的是带签名的评审者 Cookie，评审者碰不到 Agent。
- 右栏预览的文件必须在工作区内，静态服务拒绝指向根目录以外的符号链接。代理目标只允许本机和内网地址，拒绝公网和链路本地地址。
- 从非回环地址嵌入预览时，未持嵌入 Cookie 的连接不能成为所有者，也不能直接打开页面。
- 插件的 `/page-harness` 接口只接受同源 JSON POST。
- 分享时只有本机回环请求是所有者。通过远程浏览器使用 DSH 时，你自己打开分享链接也是评审者身份。

## 开发

```sh
cd dsh-plugin
npm test
```

`lib/host.js` 是 Host 入口（工具、`/page-harness` 接口、设置），`lib/preview.js` 管理 page-harness 子进程，`lib/page-preview.js` 和 `lib/static.js` 负责右栏预览，`lib/client.js` 是右栏面板、标题栏按钮、侧栏按钮和对话卡片。右栏不用 DSH 自带的详情栏（它限宽 300–520px），而是挂在 `shell.overlay` 里、贴在窗口右侧，并给 DSH 主框架留出同样宽的右边距。改 Host 后重启 `dsh web`；改 Client 后强制刷新即可。
