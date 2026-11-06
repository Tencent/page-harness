# 给改这个仓库的代理

用户文档在 [README.md](./README.md) 和 [README.zh-CN.md](./README.zh-CN.md)。目录、命令和开发约定在 [docs/development.md](./docs/development.md)。这里只写改代码时容易踩错的约束。

## 先跑什么

Node 20.11+。根目录 `npm ci` 之后：

```bash
npm run lint
npm run typecheck
npm test
```

改了 `dsh-plugin/` 还要在该目录跑 `npm run check` 和 `npm test`。改了页面上能看见的行为，再 `npm run build && npm run test:e2e`。`dist/` 被 gitignore，不要提交构建产物。

## 两个包，两条运行路径

- 根包 `page-harness` 是 CLI。它代理用户的页面，注入 overlay，并用本机的 agent CLI 改源码。
- `dsh-plugin/` 是 DeepSeek Harness 插件 `page-harness-dsh`。预览由 DSH 调 CLI，参数带 `--no-agent`。候选由 DSH 模型调用 `page_harness_propose`，不要在插件里启动 page-harness 自己的 agent，也不要把几版同时写进源码。

插件装进 DSH profile 后是文件副本，不是源码目录的符号链接。改 `dsh-plugin/lib/` 不会自动出现在正在跑的 DSH 里。

## 不要改的行为

- 预览端口保持独立。DSH 用自己的端口（常见 3080）。页面预览默认 `17994`，面板和 `/__ph/ws` 用下一个端口。不要把这两个端口反代进 3080，也不要加路径前缀。
- 回环或 HTTPS 上的面板 cookie 是 `SameSite=None; Secure; Partitioned`。公网 HTTP 保持 `SameSite=Strict`。无 cookie 的 WebSocket 必须继续 403。
- `POST /__ph/api/review/resolve` 只给本机 curl / 复制出的提示词。带 `Origin`、跨站 `Sec-Fetch-Site` 或面板 session cookie 的请求返回 403。面板改意见走 WebSocket，不走这个地址。
- DSH 里采用某一版时，输入框里的 `<page-element>` 不带内部 HTML。选择器、标签和文本放在属性上，具体改动写在后面的句子里。

## 插件客户端

`dsh-plugin/lib/client.js` 是一个没有 import 的浏览器脚本。和它对应的纯函数在 `propose.js`、`preview-bar.js`、`share-bar.js`。改其中一份时，另一份必须保持函数体一致；`dsh-plugin/test/` 会比对。`npm test` 不会执行 `client.js`，所以还要过 `npm run check`。

## 提交

功能 PR 不要改 `package.json` 的 `version`。提交说明用英文祈使句，说明为什么改。没有明确要求就不要 push，也不要开新的发布 tag。

## 发版

只发布根包 `page-harness`。tag 必须是 `v` 加 `package.json` 里的版本，例如 `v0.1.12`。不要给 `page-harness-dsh` 单独发版，也不要改它的版本号。

DSH 直接安装 npm 上的 `page-harness@<该版本>`。插件源码留在 `dsh-plugin/`，运行时用这个 CLI 包。以后每次发版都这样。
