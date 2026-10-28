# page-harness-dsh

把正在运行的网页嵌进 DeepSeek Harness 对话右侧，支持**取点引用、在线编辑批注、一键团队分享评审**：

- **右栏实时预览**：Agent 写完网页、改完脚本或启动开发服务后，对话右侧直接显示页面（宽度可自由拖拽，不遮挡对话）。在页面上点选元素即可一键「引用到对话」，也可以原地改样式、钉批注，然后对 Agent 说一句「按意见改」自动完成修改。
- **团队分享预览**：拨动预览栏顶部的分享开关，或直接对 Agent 说「把 5173 分享给同事看看」，即可生成安全分享链接。同事打开链接就能在页面上取点、在线改样式、留意见和审批。

<p align="center"><img src="../docs/dsh-preview-light.png" width="720" alt="DeepSeek Harness 对话右侧预览页面"></p>

## 安装

从 npm 安装，或在本仓库构建后按目录安装：

```sh
dsh plugin --profile web add page-harness-dsh
```

```sh
npm ci && npm run build
dsh plugin --profile web add /absolute/path/to/page-harness/dsh-plugin
```

重启 `dsh web`，强制刷新浏览器。通过 npm 安装插件时会自动安装 `page-harness` CLI 依赖，无需另外全局安装。插件会优先使用同一仓库的 `dist/cli.js`，其次使用依赖包里的 CLI；也可以在设置里填 `cliPath`。

## 右栏预览

- **开发中随时打开**：点侧栏底部的 **开发预览**，会列出本机正在运行的 dev server（常见端口 3000、5173、8080 等，带页面标题），点 **预览** 就在当前对话右侧打开；也可以输入端口、URL 或工作区里的 HTML 文件。
- Agent 写完或改完网页会调用 `page_harness_preview`，右栏自动打开并刷新。HTML 文件由插件在本机起的静态服务提供；也可以传 dev server 端口或 URL。
- 某一轮写了 HTML 文件时，对话里会出现「写了网页 xxx.html，要在右侧预览吗？」，点 **在右侧预览** 即可。
- 某一轮改了脚本（js/ts/vue/svelte/css/py/package.json 等）时，会问「改了 xxx，要开启预览吗？」，点 **启动服务并预览**，Agent 会启动开发服务并在右侧预览。
- 启动不能保证一次成功。插件先请求这个地址：通了才打开预览。纯静态站点由插件自己提供，不经过 Agent。需要 dev server 时，插件不会猜命令，只把**一条命令和一个目录**交给 Agent；Agent 跑完后用同一个地址再调一次，插件确认端口真的通了才打开。端口被占用时，预览会自动改用下一对端口再试一次。
- 让 Agent 启动服务（`npm run dev`、`vite`、`python -m http.server`、`flask run`、`uvicorn`、`node server.js` 等）时，按上面的结果执行；万一它没打开预览，这一轮结束时插件找到对应端口就自动打开，找不到就在对话里提示。
- 会话标题栏的 **预览** 按钮开关 DSH 右侧边栏里的「预览」页签。页签标题是「预览」，完整地址只出现在预览栏里。没有预览时，页签里会列出本机的 dev server，也可以输入文件路径（如 `index.html`）或端口。
- 预览里点 **取点** 选中元素，再点 **引用到对话**，内容会追加到输入框；点 **意见** 留批注，之后说「按意见改」，Agent 会调用 `page_harness_notes` 读取并修改。
- 对引用的元素说「给几个候选」，Agent 会调用 `page_harness_propose`，在对话里列出 2–4 版（文案、样式或图片），此时不改文件。点某一版的 **采用**，这句话会写进输入框；Agent 再按这一版改源码，并调用 `page_harness_preview` 刷新。

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
| `page_harness_propose` | 为一个取到的元素记下 2–4 个候选（文案、样式或图片），不改文件。用户点采用后再改源码并刷新预览 |
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
