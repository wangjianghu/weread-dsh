# weread-dsh（微信读书 DSH 插件）

> WeRead notes, deeply wired into DeepSeek Harness & AI workflows. / 把微信读书笔记变成 DSH 与 AI 工作流的一等公民。

微信读书 DSH 插件（由 [weread-vscode 0.1.2](https://github.com/wangjianghu/VSCode-WeRead) VSIX 改造，MIT）。

功能：微信读书笔记同步、Markdown 导出、笔记搜索、阅读洞察、笔记漫游、多账号管理、官方 API Key 通道（v1.1）。

**它不只是「导出笔记」**：笔记落到本地 Markdown 后，插件通过 DSH 的插件机制把它们接进 AI 对话——模型每轮自动知道你在读什么，会话内可直接指挥同步/搜索/洞察，其他 Agent 宿主可经 MCP 复用同一份数据。见下文「AI 与 Agent 集成」「DSH 深度集成」。

## 截图

> 📷 截图筹备中（Screenshots coming soon）。

<!-- 首发后补齐：书架/笔记详情/阅读洞察/笔记漫游/登录/MCP 六图
| 书架 | 笔记详情 |
| --- | --- |
| ![书架](assets/screenshots/bookshelf.png) | ![笔记详情](assets/screenshots/detail.png) |

| 阅读洞察 | 笔记漫游 |
| --- | --- |
| ![阅读洞察](assets/screenshots/insights.png) | ![笔记漫游](assets/screenshots/roaming.png) |

| 登录（三通道） | MCP 接入其他 Agent |
| --- | --- |
| ![登录](assets/screenshots/login.png) | ![MCP](assets/screenshots/mcp.png) |
-->

## 功能总览

**笔记同步与导出**

- 一键同步全部笔记为 Markdown（与原 VSIX 逐字节兼容的格式），划线/想法/章节点评/整本书评全覆盖
- 真增量同步：书计数不变不重拉，30 天兜底全量核对；3 并发流水线 + 软取消
- 冲突合并保护：本地手编与远端更新合并不互删；服务端三计数对账发现漏采
- 多账号管理：账号隔离目录、秒级切换、独立登录态

**阅读分析**

- 阅读洞察：活跃天数/连续阅读/深读比/分类雷达/作者云/时间线，月报一键导出
- 笔记漫游：SM-2 间隔复习抽样 + 随机划线卡片，收藏/评分/过滤，会话持久化
- 笔记全文搜索：跨全部已同步书籍，带章节出处

**DSH 原生体验**

- 侧栏「微信读书」面板：书架 / 笔记详情 / 阅读洞察 / 笔记漫游 / 设置 五页签，全主题令牌适配明暗色
- 悬浮阅读入口：点书直接开独立单例阅读窗口（CDP 单例复用，多账号端口分区互不劫持）
- 侧栏 KPI 胶囊（近 30 天活跃天数/笔记数）、输入框下方漫游小卡（随机划线取材）
- 三通道登录：协议扫码 / 粘贴 Cookie / 官方 API Key；凭据镜像 macOS Keychain，文件 0600

## AI 与 Agent 集成

这个插件的核心价值主张：**笔记同步只是手段，让 AI 用上你的阅读资产才是目的**。

- **阅读上下文注入**：每次模型请求自动附带「用户近期阅读」动态 context（近 5 本书 + 最新划线，10 分钟缓存）。你不用贴任何内容，直接问「这本书里作者怎么看 X」「从我最近的划线里找写作素材」——AI 天然带着你的阅读现场。
- **Agent 工具 `weread`**：DSH 会话内模型可直接调用 `sync / status / books / search / notes / insights / roaming`，工具调用渲染为卡片。说「同步一下微信读书，然后搜『认知负荷』的划线」，模型自己组合两步。
- **MCP server（跨宿主）**：`tools/mcp-server.mjs` 把插件 API 包装为 9 个标准 MCP 工具（5 只读 + 4 写路径），Claude / Cursor / 其他 MCP 宿主开箱即用，端点自动发现——不装 DSH 也能让别的 AI 用这份数据。
- **@选书 触发器**：输入 `@微信读书` 前缀即出书籍候选（DSH input trigger），把书递给 AI 不用离开输入框。
- **漫游小卡 × 写作流**：输入框下方常驻随机划线，配合写作场景「换一张→让 AI 展开」，形成取材-扩写的小循环。
- **官方 API Key 通道**：`wrk-` Key 绑定账号后启用官方网关，解锁想法/书评补采与同步对账（见下文专节）。

### 与 DSH / AI 能力的结合矩阵

| DSH / AI 能力 | 插件用法 |
| --- | --- |
| Context 注入（动态上下文） | 近期阅读 + 最新划线自动进每轮请求 |
| Agent 工具（function calling） | `weread` 7 动作，同步/检索/洞察全在会话内 |
| MCP 协议 | 9 工具包装，跨 Claude/Cursor 等宿主复用 |
| Input trigger | `@微信读书` 书籍候选直递输入框 |
| UI slots 注入 | 侧栏面板 / KPI 胶囊 / 漫游小卡三处原生入口 |
| 本地 Markdown 真源 | AI 生态通用格式：任何能读文件的工具/Agent 都能直接消费 |

## 架构

- **Host**：`index.js` + `lib/*.js` —— 登录（**三通道：协议扫码 / 粘贴 Cookie / 官方 API Key**，含 wr_skey 风控刷新与 Key 营救）、同步流水线（3 并发、增量判定、冲突合并、canonical 写盘、**想法/书评补采**、重复文件清理）、文件真源索引、洞察统计、漫游抽样、**官方三计数对账**、自动同步调度、官方网关客户端（`lib/gateway.js`，api_name 分发/skill_version 握手/upgrade_info 捕获）；`/weread/api/*` JSON API + Agent 工具 `weread`。
- **Client**：`client.js` —— 侧栏「微信读书」图标 + 主面板（书架 / 笔记详情 / 阅读洞察 / 笔记漫游 / 设置），全部 `--dsw-alias-*` 主题令牌；登录弹层三 tab；设置页含「官方通道（API Key）」卡片。
- **存储**：状态与凭据在 `~/.dsh/weread/`（secrets.json 仅本机 0600，API Key 另镜像 macOS Keychain 服务名 `dsh-weread-apikey`）；笔记真源在用户配置的输出目录（`accounts/<id>/` 账号隔离），Markdown 格式与原 VSIX 逐字节兼容。

## 与原 VSIX 的差异

- 不迁移 VSCode SecretStorage/globalState 旧数据（跨应用不可读）；首次使用直接登录即可。
- 目录选择改为手动输入绝对路径 + 后端校验（含 ENOENT 自动创建）。
- 漫游导图由浏览器 Canvas 生成后直接下载 PNG；洞察月报写入 `输出目录/阅读洞察报告/`。
- macOS 隐私设置深链未保留，权限错误以文案提示。

## 安装（四选一）

**方式一：插件市场（推荐）** —— 在 DSH 的 **插件 → 发现 → 添加索引源** 粘贴本仓库自托管索引：

```
https://raw.githubusercontent.com/wangjianghu/weread-dsh/main/market/index.json
```

之后在发现页找到「微信读书笔记（weread-dsh）」点安装。（需先启用实验性 **Custom plugin indexes** bundle）

**Install via market (recommended)** — DSH **Plugins → Discover → Add index source**, paste the self-hosted index URL above, then install *WeRead Notes (weread-dsh)* from the Discover list.

**方式二：npm 安装**

```bash
dsh plugin --profile desktop add weread-dsh
```

**Install from npm** — published as [`weread-dsh`](https://www.npmjs.com/package/weread-dsh); replace the profile name as needed.

**方式三：直装（pin 到 v1.9.12 对应 tag）**

```bash
dsh plugin --profile desktop add "git+https://github.com/wangjianghu/weread-dsh.git#v1.9.12"
```

**Install pinned to a tag** — the command above pins the exact v1.9.12 release tag.

**方式四：本地目录安装** —— DSH 插件页 **Add plugin** 选择本仓库目录（开发模式）。

**Install from a local directory** — **Plugins → Add plugin** with this repository directory (development mode).

## 使用

1. DSH 安装本 bundle，侧栏点「微信读书」。
2. 设置 tab 配置笔记存储路径（绝对路径，自动校验）。
3. 登录（三选一：扫码 / 粘贴 wr_vid+wr_skey / 官方 API Key）→ 同步。
4. Agent 可用 `weread` 工具：sync / status / books / search / insights / roaming。

## 官方 API Key 通道（v1.1）

在[官方页面](https://weread.qq.com/r/weread-skills)登录微信读书后复制 `wrk-` 开头的 API Key，粘进登录弹层第三 tab 即可：

- **已登录（扫码/Cookie）时绑定当前账号**（推荐）：不动账号目录与多账号模型；cookie 失效但 Key 有效时不误登出（Key 营救）。
- **未登录时独立登录**：官方网关暂无身份回显接口，账号 ID 由 notebooks 签名哈希生成（确定性）。
- Key 在场时自动启用：**想法/书评补采**（整本书评、章节点评进 Markdown——此前只有划线）、**同步对账**（服务端三计数 vs 本地导出条数，差异即提示可能漏采）、设置页「官方通道」卡片的连通性测试与解绑。
- 同步主管线（书架/划线）v1.1 仍走 cookie 通道；网关回包字段是否满足导出全字段以真机 `连通性测试`+`对账` 双信号验证后再切换（roadmap §8A 闸门）。

## DSH 深度集成

### 面向使用者的原生体验

- **工具卡片**：会话中 `weread` 工具调用渲染为卡片（action + 结果摘要）。
- **侧栏 KPI**：侧栏底部显示近 30 天「活跃天数/笔记数」胶囊，点击进入面板。
- **漫游小卡**：输入框下方常驻一条随机划线（🔄 换一张），适合写作间隙取材。
- **行内配置**：插件管理页微信读书行可直接配置（`plugins.row.config`）。
- **凭据安全**：macOS 下 cookie 与 API Key 分别镜像 Keychain（服务名 `dsh-weread` / `dsh-weread-apikey`），文件仅作回退。

### 面向插件开发者：本插件怎么嫁接 DSH（可作 DSH 插件开发参考）

DSH 插件 = **一个 cordis bundle**（`package.json` 的 `dsh` 字段声明）+ **Server/Client 两半**：

- **声明**：`dsh.bundle.patch` 指向插入条目（id: weread）；`dsh.client` 声明 web 平台客户端与 inject 的宿主 UI 包（sidebar/workspace/input-trigger/locale 等）。
- **Server 半**（`index.js`）：`ctx.webServer` 挂 `/weread/api/*` 路由与 `/weread/ws` WebSocket 升级（实时总线）；`ctx.tools.register` 注册 Agent 工具 `weread`（标准 JSON Schema parameters）；`ctx.effect` 注册生命周期清理（定时器/监听器随宿主卸载释放）。
- **Client 半**（`client.js`，由 `parts/*.js` 构建）：经宿主 `window.__ModuleLoader__.load` 装载，`ctx.slots.inject('sidebar.panellist' | 'main' | ...)` 注册侧栏图标与主面板；样式全走 `--dsw-alias-*` 主题令牌，明暗色自动适配。
- **上下文**：注册 context provider，把「近期阅读」注入每轮模型请求（这是 AI 结合的最短路径）。
- **安装形态**：本地开发用 profile 依赖 `link:` 直连源码目录；分发包以 bundle 名（如 `@local/dsh-weread`）注册进 `dsh.profile.bundles`。

## 互操作（E）

`/weread/api/*` 为自描述 JSON API（`GET /weread/api/openapi.json` 查看端点清单）。其他 Agent 应用/MCP server 可直接包装该 API 实现跨端笔记检索，例如：

```bash
curl -s http://127.0.0.1:<port>/weread/api/notes/search?q=认知 | jq '.items[0]'
```

Agent 工具 `weread` 动作：`sync / status / books / search / notes / insights / roaming`。

### MCP server（其他 Agent 宿主接入）

`tools/mcp-server.mjs` 把上述 API 包装为标准 MCP 工具（stdio；5 只读 + 4 写路径）：只读 `weread_search` / `weread_books` / `weread_notes` / `weread_insights` / `weread_status`；写路径 `weread_sync`（触发真实同步）/ `weread_roaming_card` / `weread_roaming_action`（推进漫游会话：换卡/收藏/复习评分）/ `weread_roaming_filter`（漫游池过滤——作用于面板共享会话）。端点自动发现：插件在收到首个面板请求时把 base URL 写入 `~/.dsh/weread/endpoint.json`；也可用 `--url` 或环境变量 `WEREAD_DSH_URL` 指定。

Claude Code 配置样例（`~/Library/Application Support/Claude/claude_desktop_config.json` 或对应 MCP 配置）：

```json
{
  "mcpServers": {
    "weread": {
      "command": "node",
      "args": ["<仓库路径>/tools/mcp-server.mjs"]
    }
  }
}
```

自测：`npm run mcp -- --selftest`（`npm test` 已包含）。

## 开发与测试

- **client.js 是构建产物**：业务代码在 `parts/*.js`（00-head → 90-tail 顺序拼接）。改 parts 后必须 `npm run build` 重建，**不要直接改 client.js**；`npm run check` 可校验产物与 parts 是否一致。
- **测试**：`npm install && npm test` 串跑——`build.mjs --check`（parts→client.js 一致性）、`node --test test/`（单元测试 163 例：markdown/store/analytics/zip/sync/api/auth/gateway/wsbus，零新依赖）、`smoke.mjs`（后端 400+ 断言，fake ctx 不触网）、`rmsmoke.mjs`（组件渲染 + 文案/i18n 断言）、`tools/react-mount-test.mjs`（真实 React 挂载 App/dock/侧栏 + @选书形状守卫，防面板空白类回归）、`tools/mcp-server.mjs --selftest`（MCP 全链路含异常路径）。每次改动后必跑。
- **版本记录**：见 [CHANGELOG.md](CHANGELOG.md)。

## 发版流程

1. `npm test` 全绿；2. package.json 升版本号；3. CHANGELOG.md 增加该版条目；4. git commit + `git tag v<版本号>`；5. 在 DSH 插件管理页重装 bundle 并刷新面板走查一遍。版本号、CHANGELOG、git tag 三者保持一一对应。

## 安全模型

- **面板加载失败修复（v1.9.12）**：v1.9.11 的认证代码直接读取宿主 `connection` 服务触发框架守卫异常，浏览器面板全量 500；现改为动态注入捕获，桌面/headless 两种宿主形态均正常（163 例单测回归覆盖）。 / **Panel load-failure fix (v1.9.12)**: v1.9.11 auth code read the host `connection` service directly and tripped the framework guard, 500-ing every panel request; now captured via dynamic injection — both desktop and headless hosts work (covered by 163 unit tests).
- **宿主调用方认证（v1.9.11）**：`/weread/*` 全部 HTTP 路由与 WS 升级须持有其一凭据——宿主签名 cookie（`ctx.connection.admit`，DSH 页面同源请求自动携带）或插件自签 Bearer token（随 `endpoint.json` 分发给 MCP 等本地工具，timing-safe 比较）。本机其他进程无法再匿名读取完整 API Key 或私人笔记；宿主无 `connection` 服务（headless 组合）且无 Bearer 时拒绝服务（fail-closed）。
- 本插件在本机开启仅 loopback（127.0.0.1/localhost/::1，可带端口）的 HTTP/WS 服务；带 Origin 的浏览器请求要求 Origin host 与 Host 一致且为 loopback（防 DNS rebinding），无 Origin 的本地工具凭 loopback Host 放行。
- 微信读书凭据（cookie / API Key）只存本机 `~/.dsh/weread`（secrets 文件 0600 权限位），不经任何第三方服务；登录二维码本地生成。
- 单例阅读窗口使用 CDP 调试端口（仅 127.0.0.1，窗口存活期间存在）。这是 Chrome CDP 的固有暴露面：存活期间本机任意进程可经调试端口读取页面会话。介意者可在设置中开启「关窗即退出」缩小存活期。
- 卸载清理为销毁性操作，API 层要求显式 `confirm: true`。

## 许可证

[GPL-3.0](LICENSE)。本项目由 weread-vscode 0.1.2（VSIX）改造而来，衍生作品同样以 GPL-3.0 发布。
