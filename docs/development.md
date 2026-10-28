# 开发说明

面向改 page-harness 本身的人。产品用法见 [README.zh-CN.md](../README.zh-CN.md)。代理约束见 [AGENTS.md](../AGENTS.md)。

## 仓库地图

| 路径 | 内容 |
| --- | --- |
| `src/cli/` | 命令行参数和启动 |
| `src/server/` | 代理、鉴权、面板 API、评审、MCP、Live |
| `src/agents/` | Claude、Codex、Cursor、CodeBuddy、OpenCode 和测试用 fake agent |
| `src/shared/` | 服务端和客户端共用的协议与评审读取 |
| `client/overlay/` | 注入到被代理页面里的脚本，构建成 `dist/client/page/overlay.js` |
| `client/app/` | 面板和历史记录的 Vue 应用 |
| `dsh-plugin/` | 独立的 npm 包 `page-harness-dsh` |
| `test/` | Vitest。服务端集成测试会真的听端口 |
| `e2e/` | Playwright，只用 Chromium，固定一个 worker |
| `.github/workflows/ci.yml` | Node 20、22、24 上 lint、类型检查、单测、构建，以及插件任务 |
| `.github/workflows/release.yml` | 打 `v*` tag 时发布。发布前会 lint、类型检查和测试 |

`dist/` 不入库。发布时 `prepublishOnly` 会构建并刷新 `THIRD_PARTY_LICENSES.md`。

## 本地命令

```bash
npm ci
npm run dev
node dist/cli.js http://127.0.0.1:5173 --project ../some-app

npm run lint
npm run typecheck
npm test
npx playwright install chromium
npm run build && npm run test:e2e

cd dsh-plugin && npm ci && npm run check && npm test
```

`npm test` 在构建客户端之后才会检查 overlay 包里有没有嵌入协议。只改了 `client/overlay/` 时，先 `npm run build:client` 再跑相关测试。端到端夹具由 `e2e/fixture-server.mjs` 拉起，嵌入预览在 `17990`，父页面是 `17980`。

## 约定

- 源码是 ESM，`"type": "module"`。TypeScript 开了 `strict` 和 `verbatimModuleSyntax`。类型只作类型用时写成 `import type`。
- 服务端测试用 Vitest，放在 `test/` 或 `client/**/*.test.ts`。需要 DOM 的文件在开头写 `@vitest-environment happy-dom`。
- 插件测试用 `node --test`，放在 `dsh-plugin/test/*.test.js`。插件客户端不能 import 这些模块，所以纯函数在 `lib/*.js` 和 `lib/client.js` 各有一份，测试比较两边的函数体。
- 改界面时用现有的端到端用例，或者在浏览器里把受影响的路径点一遍。只看一张截图不算验证。
- 用户能看见的文案同时有中文和英文。DSH 插件跟随 `document.documentElement.lang`：`zh` 用 `zh-CN`，其余用英文。不要另存一套不会被 DSH 语言覆盖的语言偏好。
- 提交说明用英文，一句说清原因。功能 PR 不改版本号；`page-harness` 和 `page-harness-dsh` 的版本在发版提交里一起处理。
- 不提交 `.env`、token、`dist/`、`e2e/.tmp/`。

## DSH 插件

宿主逻辑在 `dsh-plugin/lib/host.js`，预览进程在 `preview.js`，候选记录在 `propose.js`。客户端 `client.js` 注册右栏页签、对话尾部和 `<page-element>` 芯片。

预览监听 `previewPort`（默认 17994）和它的下一个端口。DSH 自己的端口只给 DSH 用，预览不要并进去。静态文件优先用再下一个端口，并且只绑回环地址。

候选是一次 `page_harness_propose`。对话里只保留最新一组卡片可切换、放弃和采用。采用把一句「采用第 N 版」放进输入框，由 DSH 模型再改源码并调用 `page_harness_preview`。

## 鉴权不变式

面板 cookie 的规则在 `src/server/auth.ts`：

- 监听地址是回环，或者对外协议是 HTTPS：`SameSite=None; Secure; Partitioned`。这样 DSH 用 `127.0.0.1` 嵌 `localhost` 面板时，浏览器仍会带上 cookie，WebSocket 不会 403。
- 公网 HTTP：`SameSite=Strict`，不加 `Secure`。那种环境下 `Secure` cookie 存不住。
- 无 session cookie 的面板 WebSocket 保持 403。

`POST /__ph/api/review/resolve` 在 `checkUi` 之前处理，但必须先过 `checkLocalAgent`。浏览器一定会带 `Origin`，所以会被拒绝。复制给本机 Agent 的 curl 不带 `Origin`，仍然可以标记意见已解决。

## 嵌入页面的消息

父页面和 overlay 用 `postMessage`。来源必须是 `--embed-origin` 允许的父页面。

| 方向 | `type` | 作用 |
| --- | --- | --- |
| 父 → 页 | `ph:hello` / `ph:lang` | 建立父页面来源，并设置语言 |
| 父 → 页 | `ph:highlight` | 点亮被引用的元素 |
| 父 → 页 | `ph:candidate` | 在元素上临时应用一版。`clear: true` 撤掉 |
| 页 → 父 | `ph:quote` | 取点结果 |
| 页 → 父 | `ph:location` | iframe 里的实际地址，含 `pushState` |
| 页 → 父 | `ph:candidate-nav` | 页面上的候选条切换了版本 |

独立运行的 page-harness 不会发送 `ph:candidate`。声明式样式会套到该选择器上；带 `{` 的样式表按模型原文注入。元素内部有子元素时不改文案，图片只改 `<img>`。
