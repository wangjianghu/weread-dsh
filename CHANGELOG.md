# Changelog

## 1.9.12（2026-11-19）

**Bug 修复：面板「加载失败：cannot get property "connection" without inject」（v1.9.11 引入的回归）。**

- **问题**：v1.9.11 的宿主调用方认证在路由里直接读 `ctx.connection?.admit`。Cordis 的 Context 是服务解析代理，未在 `inject` 声明的服务属性一访问即抛 `cannot get property "connection" without inject`——`?.` 可选链无法绕过（抛错发生在属性返回之前）。浏览器请求无 Bearer 时每个 `/weread/api/*` 请求都走到这行，异常冒泡导致全量 500、面板加载失败，重试永远无效。
- **修复**：改用动态注入 `ctx.inject(['connection'], cb)` 捕获 `admitFn`（服务在则激活、卸载即置空）；`callerAuthenticated` 与 401/503 判定全部改读捕获值。headless 组合（无 connection 服务）行为不变：插件照常工作，认证降级为仅 Bearer、无凭据 fail-closed（503）。不把 `connection` 加进顶层 `inject`——那会让 headless profile 里整个插件 inactive，违背设计。
- **可测性**：`callerAuthenticated` 提取为导出的 `createCallerAuthenticated({ bearerOk, getAdmit })` 工厂。
- **新增 9 例回归测试**（`test/callerauth.test.js`）：Bearer 通过/拒绝、admit 通过/抛错/中途撤除、getAdmit 逐请求求值、Cordis 守卫语义锚点（旧写法必抛、新写法可用）、源码扫描防 `ctx.connection` 直访回潮。smoke 的全部 mock ctx 补齐 `inject`。
- **对抗审查加固（P1）**：`/weread/ws` 升级握手认证加 5s 超时拆线（admit 悬挂时防慢速占用）、`.catch` 兜底与 `settled` 防护（超时后迟到的认证成功不再对已销毁 socket 转交）。

## 1.9.11（2026-11-18）

**安全修复：`/weread/*` 全量宿主调用方认证（dshopen #522 审核要求）。**

- **问题**：本机任意进程可匿名访问 loopback 的 `/weread/api/*`——包括读取完整 API Key（`/api/gateway/key`）与全部私人笔记的接口。插件账号已登录不代表请求来自宿主所有者（原有防护只覆盖 DNS rebinding 与跨域网页，不覆盖本地非宿主进程）。
- **修复（双通道，其一通过才放行）**：① 浏览器/宿主页面经 `ctx.connection.admit`（DSH 的 dsh-auth 签名 cookie，同源请求自动携带）；② MCP/本地工具经插件自签 Bearer token（激活时随机 32 字节，随 `endpoint.json` 分发，timing-safe 比较）。`/weread/ws` 升级握手同认证。宿主无 `connection` 服务（headless 组合）且无 Bearer 时 fail-closed（503）。
- **MCP**：`tools/mcp-server.mjs` 自动读取 `endpoint.json` 的 `token` 字段随请求携带；支持 `--token` 参数与 `WEREAD_DSH_TOKEN` 环境变量；401/503 报错含升级引导。
- **兼容性**：客户端无需改动（同源 cookie 自动携带）；旧版 endpoint.json 无 token 字段时重启 DSH 由插件重写补齐。
- 新增 5 例 timing-safe 比较单测；smoke 增加无凭据 401 / 错 token 401 断言。

## 1.9.10（2026-11-16）

**对抗审查 v3（性能/稳定性专项）：全面复核 + 死代码清理。**

- **复核确认（无需修复）**：定时器生命周期（readerWindow 三守护缺席 5 轮停摆/busy 防重入/unref；扫码轮询 5min 超时+防重入+终态停转）、缓存上限（parseCache 600 / adoptRejectCooldown 32 / analytics LRU 12 / searchMapCache LRU 3 / notesCache TTL+轮末清）、wsCall 5s 超时幂等清理、store tmp+rename 原子写、wsbus dispose/ping、queryBooks snapshot memo、gateway MAX_PAGES=100 翻页保险丝、客户端监听器 9 文件全配对清理、interval 全带 useEffect cleanup。
- **死代码清理**：移除 `onDidCompleteSync`/`fireComplete`/`completeCallbacks`——生产零消费者（完成通知实际走 wsbus 广播），v1.9.6 死代码清理漏网；同步移除对应测试用例。

## 1.9.9（2026-11-13）

**体验修复：登录过期时不再自动弹登录窗、不再显示「同步失败」红色横幅。**

- **未登录自动弹窗收窄**：原 v1.0.8「登录过期或首用无书」都会自动弹登录弹窗；现仅「首用且无书」保留首用引导，登录过期不弹——黄色过期提示条（带「重新登录」按钮）已足够引导，一进门就弹窗反而打断浏览本地数据。
- **失败横幅只对「已登录且非登录类失败」展示**：未登录/登录过期时同步失败是可预期结果，红色「同步失败：登录已过期」与黄色提示条重复且制造焦虑，不再展示（在 1.9.8「登录恢复后隐藏陈旧横幅」基础上收窄）；已登录时的网络/接口错误照常展示。
- 手动点「同步笔记」遇 401 仍弹登录窗（用户主动动作后的引导，不变）。

## 1.9.8（2026-11-11）

**体验修复：登录恢复后「同步失败：登录已过期」横幅不再滞留。**

- **登录类同步失败打标 + 客户端陈旧性闸门**：`runSync` 失败时若为 401/「登录已过期」类错误，`syncState` 记 `loginExpired: true`（非 Failed 终态一律清标）；全局同步条在 `loggedIn` 已恢复时隐藏该类失败横幅。真机反馈场景：自动同步因 cookie 过期失败后，用户经阅读窗口重新拿到登录态，旧横幅仍常驻——此前 failed 终态没有任何消除条件（cancelled 有 15s 时间闸门，failed 只能等下一轮同步）。其余失败（网络/接口错）不受影响，照常展示。

## 1.9.7（2026-11-10）

**P2 收尾：对抗审查遗留清单全部处置 + 存量缺陷修复。**

- **P1-2 Markdown 结构注入防护（写→读幂等）**：想法/书评内容中与解析器结构同形的行（`### x`、`<!-- wr:nid:x -->`、`_记录时间：…`、`- 作者：…`、`💬/💭/🖍️` 标记、列表行）写盘时加零宽空格前缀使其不匹配任何锚定结构正则，解析侧并入内容前剥掉还原——杜绝 noteId 劫持/章节伪造/后续笔记被吞。新增注入回归测试。
- **存量缺陷：多行想法续行误并划线**（P1-2 测试暴露）：裸文本续行的归属改为按「最近标记」（💬 后归想法、`> ` 后归划线），旧逻辑恒先查 highlightText 导致带划线笔记的多行想法丢进划线文本。
- **时钟回拨四点防护**：lastAutoSyncAt / adoptRejectCooldown / noteSyncMarks / refreshBackoffUntil·lastRefreshAt 的「未来化」时间戳判为回拨产物重置或忽略——自动同步/采纳探测/空书跳过/凭据续命不再因回拨停摆到时钟追平。
- **性能**：对账的 `## 书评` 探测从每本书全量读盘改为只读尾部 8KB；store 大对象（≥100KB）写盘放弃 pretty（单次省 ~50-100ms 主线程阻塞）；`getLoginUid` 等 200-非-JSON 回包不再当网络错误重试 3 次。
- **健壮性**：`sanitizePathSegment` 截断 80 字符（防服务端可控超长分类名 ENAMETOOLONG）；备份 zip 超 65535 条目（ZIP16 上限）显式拒绝而非写错乱目录；noteId 兜底加自增序防同秒碰撞。
- **安全**：`/api/fs/list` 目录浏览限定 $HOME 子树；`loginByCookie` 的 wr_vid/wr_skey 白名单 `[\w-]`（防 cookie 头注入）。

## 1.9.6（2026-11-10）

**开源准备版：对抗性安全审查修复 + 单元测试体系 + 仓库脱敏。**

- **P0-1 本地 API/WS 总线防 DNS rebinding**：HTTP 路由与 `/weread/ws` 升级握手新增 loopback Host 白名单（localhost/127.0.0.1/::1，允许带端口；带 Origin 时 Origin host 须同 Host 且 loopback）——此前「Origin.host === Host」校验在攻击域解析到 127.0.0.1 时恒过，网页可经 rebinding 窃取网关 Key/换凭据/触发清理。附带：endpoint.json 只在 loopback Host 下写入（防 MCP 发现被指到外域）。
- **P0-2 accountId 路径穿越封堵**：`/api/accounts/switch` 校验 accountId ∈ 已登记账号；roaming 元数据/会话文件名与索引扫描根统一 `[^\w.-]` 清洗——此前 body.accountId 原样拼接落盘路径可写 stateDir 外任意 .json。
- **P1-1 同步 worker 互斥提前释放**：`Promise.all` → `allSettled`，任一 worker 抛错不再提前释放账号互斥、避免与残留 worker 双写同书文件。
- **P1-3 getLoginUid 补 5s 超时**：扫码登录第一步弱网不再挂 ~300s。
- **P1-5 卸载清理加确认参数**：`/api/uninstall/cleanup` 须带 `confirm:true`（盲打 400）。
- **gateway.notebooksAll 游标停滞去重**：停滞页的重复书不再追加进结果（单测审查发现）。
- **死代码清理**：api.js 移除 5 个全仓零引用导出（transformChapters/transformReviews/getBestBookmarks/getChapterInfo/getProfileByWebApi…）；client 侧删除 `W.Marquee` 别名与只写不读的 `W.__slotCtx`。
- **单元测试体系**：新增 `test/`（node:test，零新依赖）142 例：markdown 往返幂等、store 作用域/权限位、analytics SM-2/KPI、zip 二进制向量、sync 增量合并/取消/互斥、api 形状、auth 登录态分类、gateway 协议/翻页、wsbus 握手/Origin 校验。`npm test` 已接入。
- **开源脱敏**：冒烟测试与 CHANGELOG 中的真实微信读书账号 ID 替换为假 ID（端口分区断言同步重算）。

## 1.9.5（2026-11-10）

- **修复取消端点 ReferenceError（v1.9.4 引入）**：`/api/sync/cancel` 路由误引了 sync 路由块内的局部变量 `acc`——登录态点同步条取消按钮必抛「acc is not defined」（未登录 401 路径不触达，冒烟盲区）。现自取 `activeAccount()`；修的过程中又抓到第二层：`activeAccount().account` 上无 `id` 字段（外层才有）——冒烟补登录态断言（cancelling:false 路径）钉死。
- **悬浮入口静态/加载同大**：静态形态从 24px svg 图标改为与 loading 完全相同的 mini 书（封面+左右书页+书脊，30×20px），loading 时叠加三张错相翻页 leaf——视觉上静态是「合着的书」、点开后「翻起来」，大小恒定。

## 1.9.4（2026-11-10）

**UI 双改（真机反馈）：取消按钮全局化 + 悬浮阅读入口放大换翻书动效。**

- **取消按钮进全局同步条**：v1.9.3 的取消按钮在书架工具栏——切换一级菜单（洞察/漫游/设置）即不可见（真机反馈）。现同步状态条（`wr-syncstrip`，本就跨 tab 全局渲染）右端常驻「取消」按钮，任何页签都能取消；点击后按钮变「取消中…」禁用，终态自动复位。新增「已取消」终态 15s 灰条（✓ 前缀，非红色错误话术）——取消完成后跨页签可见结果。
- **悬浮阅读入口 1.5×**：34px → 51px（icon 16 → 24px），clamp 边距同步适配（拖拽边界、容器 resize 跟随都不出界）。
- **翻书 loading 动效**（参照 WorkBuddy flip-book-loading.html）：打开阅读窗口进行中，icon 从「整体 360° 旋转」升级为 mini 翻书——封面/左右书页/书脊 + 三张翻页 leaf 负延迟错相（rotateY 翻页 + 首尾淡入淡出消除回跳），配色沿用按钮主题蓝（#34a7ff 系）；`prefers-reduced-motion` 时静态半开页。
- rmsmoke +4 静态守卫（翻书三页结构/51px clamp/全局取消接线/cancelled 灰条）。全链 489 项绿。

## 1.9.3（2026-11-10）

**同步双升级：软取消 + 真增量（修复「每轮每本书全量拉笔记」的存量缺陷）。**

- **增量修复（存量缺陷，风控面）**：`shouldRefreshMetadata` 原判定远端书架数据——notebook 端点不返回 pcUrl，插件推导的 rawId 形态每轮恒命中「待刷」→ 元数据通道把**全部书**捞进队列，进度/计数增量判定名存实亡（每轮 ≈ 每本书一次 bookmarklist 请求，真机确认）。修：元数据判定改 localBook 侧（pcUrl 是 enrich 后写盘往返的 canonical 值）。
- **空书跳过（修复过程中发现的第二层浪费）**：无笔记的书拉回空后不落盘（无内容可写）→ 每轮都被当「新书」重拉一次空请求。现以 `noteSyncMarks` 记录每本书最近全量拉取时间：已核实且远端计数仍为 0 的空书跳过；写出第一条划线（计数出现）立即恢复拉取。
- **元数据轻路径**：仅元数据待刷的书（计数未变）不拉 bookmarklist——本地笔记即最新（新增划线必增计数），直接用本地内容重写文件刷进度/封面等元数据。
- **30 天兜底**：计数未变但超 30 天未全量拉取的书强制重拉一轮——覆盖「想法编辑（计数不变内容变）」边缘与历史数据自愈；到期全拉优先于轻路径。
- **软取消（协作式，书边界）**：同步中按钮变「取消」→ `POST /api/sync/cancel` 置标志 → worker 在取下一本书前检查（与账号切换保护同一安全位置）→ **在飞书自然完成**（3 路并发各持一本，最坏等待 ≈ 一本书处理时间；不 abort 在飞请求——风控上突掐不如自然完成温和）。终态新值 `cancelled`（区别于 failed，UI 非红色）：已完成部分保留（书级原子写无半本文件）、索引重建照常、对账跳过（半轮对账必误报）、互斥随轮释放（取消后立即可重新同步、标志不跨轮）。取消后重新同步 = 无损续传（增量判定逐书补齐）。三语文案 + hover 说明。
- smoke +13 断言（423 总）：增量三轮（计数全同→bookmarklist×0；PB1 计数变→仅 PB1×1；marks 清空→30 天兜底重拉 PB3）+ 取消链路（挂闸世界：cancelled 终态/书边界 3/5 停/文件保留/互斥释放/重同步补齐 5/5）+ 取消端点 401 守卫。测试世界书架计数与笔记内容自洽化（PB1 条数联动）。

## 1.9.2（2026-11-10）

**深入回归 + 对抗性审查轮**（独立子代理审查 v1.8.20..HEAD，10 项发现分级处置：2×P1 修复、3×P2 顺手修、5×知悉注记）。

- **#1（P1·风控）采纳拒绝冷却**：A2 回流守护每 10min 上报不同源窗内会话，插件凭据已死且不可采纳（vid 不匹配/窗内也死）时，原逻辑每轮重复 mineOk 服务端探测——日增上百次 x-vid/x-skey 裸接口请求。`adoptWindowSession` 对**确定性拒绝**（凭据活/vid 不匹配/窗内死）按上报指纹记 1h 冷却；网络异常不冷却（不惩罚瞬时故障）；凭据换血/窗内换会话指纹即变，不受影响。已知代价：弹层核验在冷却窗口内不再重试同指纹窗内会话（本也救不活）。
- **#2（P1·UX）同步旧帧闪烁**：`syncProgress` 保留上一轮 Completed 帧——第二次点同步首秒显示「100% N/N · 同步完成」约 1s 才被新帧覆盖（v1.9.1 修好进度显示后首次真实可见）。`/api/sync` started 即清帧（与切号清理同款）。
- **F1 登出/删号清 cookieOrigin**（自审）：凭据都没了，「上次续命」指纹不再残留设置页。
- **F2 verdictCache 上限 64 FIFO**（自审）：quitOnClose=off 常驻实例长期换血不再理论无界；淘汰语义无损（缓存本就 10min 过期）。
- **F3 切号清进度帧**（自审）：`syncProgress` 是不分账号的闭包变量，旧账号「X/N 本」不再泄漏到新账号书架。
- **#5（P2）** pushSession 删除不可达的 `loginExpired` 返回字段（死代码防误用）；**#9（P2）** 设置页续命行标注「当前账号」（三语），多账号不再误读。
- **#7/#8/#10（知悉）**：开书链最坏 +10s 串行延迟（预热 5s + 同值裁决 5s 超时，弱网有界）；B1 缓存 true 的 10min 踢下线盲区（页面自行露馅，过期自动重裁）；登录复核重试链重复 pushSession（同源 no-op，一次本地探测）。
- 测试 +19 断言（410 总）：B1 缓存三段语义（undefined 不缓存/true 缓存/有效期内信任旧结论）、C1 退避抑制/无凭据 no-op/inFlight 并发合并（手动闸验证单次底层 HEAD）、A2 死值不回流、#1 拒绝冷却（同指纹重报零探测）、#2 旧帧清除、F2 上限与 FIFO 淘汰、#6 换血×harvest 并发安全（setCookie 挂闸）、无凭据 verify 不误标过期。`_internal` 新增 `adjudicate`/`verdictCacheSize` 测试原语。

## 1.9.1（2026-11-10）

**真机反馈双修：登录弹层全绿而横幅仍报「登录已过期」；同步进度只有转圈没有「X/N」。**

- **修复同步进度参数错位（进度数字从未显示过）**：`sync.updateProgress` 的调用签名是 `(step, currentIndex, total, p)`——进度对象在**第 4 参**；宿主 `onProgress: (p) => { syncProgress = p; }` 却把第 1 参的**阶段字符串**当对象存了 → `stateView.syncProgress` 恒为字符串 → 客户端 `totalBooks` 恒 undefined → v1.8.10 的「X% X/N 本 · 书名」进度显示从未真正工作。改为按第 4 参取对象（非对象帧丢弃），WS 相位广播同步改用 `currentStep`。
- **进度文案补笔记维度**：进度对象本就有 `syncedNotes/totalNotes`，书架同步指示补「· X/Y 条」（有笔记计数时），书+笔记双维度如「23% 34/144 本 · 512/2323 条 · 书名」。
- **修复登录态分裂（弹层全绿 vs 横幅过期）**：`/api/login/verify` 核验结论现在**回写 loginState**——核验成功即撤销 `loginState.expired`（核验≠登录，不走 `fireLoginState`，原路径只返回通道状态、不动 loginState：expired 一旦被同步 401 设置就再无撤销路径）。核验失败且凭据在场才标过期（从未登录的用户仍显示「未登录」而非「登录已过期」）。
- **书架状态不再冻结**：①弹层开着时轮询不停（`usePoll` gate 从 `syncing` 放宽为 `syncing || showLogin`）——401 后同步按钮熄灭、轮询停摆、横幅僵死的路径堵上；②弹层关闭即主动拉一次 `/api/state`（无论是否登录成功，核验修正后的状态即时可见）。
- smoke 新增 6 断言：进度对象形状（currentStep 在场、2/2 本计数，修复前恒字符串）+ verify 判死/恢复两态回写 loginState；13.79 世界补书架端点桩（动态开关：checkLoginStatus 第一跳就是 notebook，判死场景需一并关）+ weread 域通用空体兜底（测试世界绝不打真网）。全链 453 项绿。

## 1.9.0（2026-11-10）

**主题：登录共享的准确性与及时性——阅读窗口与插件凭据从「事件点汇合」升级为「持续互救」。**

- **B1 同值死会话提前归因**：`prepareSession` 原三态裁决只覆盖「值不同」分支——窗内 skey 与插件同值且服务端已死时开书直接撞「加载失败」。现同值也做服务端裁决（**10min 实例级裁决缓存**，只缓存确定性结论；网络异常不缓存保持保守），判死提前返回 `loginExpired` toast 引导重扫（复用 v1.7.18 话术），消掉最后一个「撞墙才知道」盲区。缓存同时服务三处裁决点——连续开书/推窗零重复服务端往返。
- **A1 登录成功即推窗**：新增 `readerWindow.pushSession()`——宿主登录态点亮（`onDidChangeLoginState(true)`，覆盖扫码/Cookie/窗内采纳全部路径）即对打开中的窗口跑一次三态裁决：窗内挂死会话 → 立即换血注入 + 重载（重载后自动补工具条），不再等用户下次开书。窗口不在场/同源健康时是廉价 no-op（一次本地探测 + 缓存裁决）。
- **A2 会话回流守护**：新增 harvest 定时器（默认 10min，随开窗启动、关窗停摆，防重入）——窗口在场时周期读窗内 weread Cookie，与插件凭据不同源即经 `onWindowSession` 上报宿主采纳。窗内浏览是滚动续命源（Chrome 收 Set-Cookie 自动换新 skey），原设计只在开书/导航事件点反向同步，用户页内连读数日插件凭据就会落后；现在**回流随时（只读+上报，不动页面），换血仍只在导航事件**——不打扰阅读。
- **C1 开书预热刷新**：`open-reader` 路由在开窗前调 `auth.warmupRefreshForOpen()`——距上次续命 >30min 才强制 HEAD（退避保护仍生效），保证注入窗口的是最新血；同值 30min 内不重复 HEAD。顺带给 `refreshCookiesFromServer` 补 5s 超时（对齐 fetchUserInfo 的 P1-12——原裸 fetch 网络挂起会拖住开窗链）。
- **B2 Cookie 来源指纹可见**：`authMeta.cookieOrigin = { at, source: login|head-refresh|window, skeyTail }`——登录、HEAD 续命、窗内采纳三个换血点全部记录；`/api/state` 的 `loginChannels.cookie.origin` 暴露；设置页账号卡新增「Cookie 上次续命：X 前 · 来源：扫码登录/自动续命/阅读窗口回流」（三语，悬停显示 skey 尾号）。续命时同步更新 `simpleBrowserAuth` 快照（原「只在登录时写、只写不读」的僵化数据激活）。首次把登录健康度对用户可见。
- **C2 启动/复核救活**：新增 `tryRescueFromWindow(reason)`（exportWindowSession + adoptWindowSession 复用，弹层核验 v1.8.10 同款逻辑）挂两条路径：①启动后台分类完成后凭据已死 → 尝试从孤儿窗口救活；②`ensureLoginFresh` 同步前复核判死 → 尝试救活（窗口在场=用户可能刚活跃过；窗口关着 export 秒回 null，零成本）。
- **修复存量 TDZ**：`classifyLoginState` 原为 `const` 箭头函数，声明在启动调用点之后——启动分类的 ReferenceError 被外层 try/catch 静默吞掉，**v1.0.6 的启动校验从未真正执行过**。改为函数声明（整体提升），启动/30min 复检两条路径都真实跑起来。
- smoke 新增 28 断言（13.66b auth 级来源指纹/预热门、13.78b 同值裁决+缓存+推窗+回流×15、13.79 预热 HEAD/来源翻转、13.79b 启动救活 apply 级），rmsmoke +2（设置页续命行两种来源）。全链 443 项绿（smoke 379 / rmsmoke 47 / mount 5 / mcp 12）。

## 1.8.20（2026-11-10）

- **「关窗即退出」做成设置项（默认开）**：设置页 → 单例阅读窗口 → 新增开关「关窗即退出 Chrome 实例」+ 取舍说明（开：关窗后程序坞不留图标、下次全新拉起约 1-2 秒；关：实例常驻重开秒回、程序坞图标滞留）。默认维持 v1.8.19 行为（关窗即退出）。
- 接线全链：prefs 键 `readerWindowQuitOnClose`（默认 true）→ /api/config 白名单 → readerWindow deps `quitOnClose()` 决策时实时读取——运行中改设置即刻生效，无需重开窗口。三语文案齐全。
- smoke 新增 6 断言：默认开 / 持久化关闭 / 关闭时关窗不退出且端口保留（reopen 快开可用）+ 既有 13.84 不回归。全链 416 项绿。

## 1.8.19（2026-11-10）

- **关窗即退实例（程序坞图标随窗消失）**：阅读窗口是独立 profile 的 Chrome 实例，macOS 下用户关窗后进程常驻——程序坞多出的 Chrome 图标滞留（真机反馈）。守护缺席检测（连续 5 轮不见窗口）从「仅停摆守护、实例留存待 reopen」改为**优雅退出实例**：复核 targets 仍空 → `Browser.close` → 未竟则 SIGTERM 进程组兜底 → state 摘除端口。两条护栏：①退出前窗口若已回来（缺席误报/极速重开）则取消；②只在 state 端口未被新 open() 改写时才清 port。守护重启时缺席计数归零（防首 tick 误触发退出）。代价：下次 open 全新拉起（约 1-2s），换取坞区干净。
- smoke 13.84 四断言：开窗成功 / 窗口在场绝不退出 / 关窗后 Browser.close / state 摘端口。全链 410 项绿。

## 1.8.18（2026-11-10）

- **修「点击悬浮阅读入口却在浏览器开页签」**（真机取证 + 全链根因）：
  1. **根因一·端口同号共享**：两账号阅读窗口实例被分到同一端口 47833——Chrome 绑不上 IPv4 时退绑 [::1]，两实例分占双栈；而 probe/pickPort 只探 127.0.0.1，谁看谁都像「端口空置」。端口候选改为**按账号哈希分入互不相交的 8 连号区**（两个不同账号实测分入不同端口区，至少隔一个区宽；测试用脱敏假账号 2100000001/2100000002 复现）。
  2. **根因二·跨账号窗口劫持**：state 里的端口被别人的实例应答时，复用路径会导航**别人的窗口**、reopen 路径等_ready 永远等不到自己的窗口。现在**端口归属核验**：越界端口（不在本账号区）一律废弃重建，绝不 navigateExisting / Browser.close / 导出会话。
  3. **根因三·垂死实例免死**：P2-24 守卫只要 CDP 有应答就跳过僵尸清理——「实例活着但窗口已关（空 targets）」的单例锁持有者被 spared，后续 spawn 全部转发失败，tier1/2 连败落 `open -a Chrome` 页签兜底。守卫收紧为**有活窗口（ok+targets）才免死**。
  4. **probe 双栈化**（127.0.0.1 + [::1]）：同号共享在构造上不可能、自己的 v6 窗口也能找到。
- **9 项事故回归断言**（smoke 13.83）：事故账号分区不重叠 / 双栈 probe / 越界端口绝不复用且不落页签兜底 / state 自愈 / 垂死实例必被清理。
- 现场遗留自愈：两个旧实例（47833 双栈分占）在下次各自账号 open 时被 reopen 复活或清理，无需手动处理。

## 1.8.17（2026-11-10）

- **设置页布局自卫（针对真机「标题与内容同行」）**：本地无头 Chrome 复现（含 1800px 祖先容器）始终正确，真机面板始终错位，宿主环境无法复刻。新增防御层：`.wr-card{display:block!important}` + `.wr-set-card>*{flex-basis/grid-column/max-width 强制整行}`——正常文档流零感知，若外部样式把卡片变成 flex-row/inline/grid 任何横向上下文，子块强制回到整行独占。对抗验证：模拟宿主末位注入 `.wr-card{display:flex!important;flex-wrap:wrap}` 仍保持每块一行。
- **真机布局探针**：设置页挂载 600ms 后实测「标题行 vs 首个内容行」的 x/y/宽 + 卡片/grid/标题的 computed display，经既有 /api/client-diag 通道写入 op 日志（每页面加载一次）。下次真机打开设置页即可拿到定位数据。
- 取证记录：DSH web CSS（asar 提取 22 个 CSS 文件）无 .wr-* 选择器、无 [class*=] 属性选择器、无裸 div{display:flex} 规则——宿主 CSS 直接攻击路径全部排除，转向「环境差异实测」路线。

## 1.8.16（2026-11-10）

- **修洞察页说明浮层窄窗口右缘截断**：Top10 表头 ⓘ 悬浮说明（价值分公式「笔记产出分50% + 深度占比30% + 完成率20%…」）在窄窗口下超出右缘显示不全。原实现两处病根：`white-space:nowrap` 长文案不换行、位置钳制硬编码「假定浮层 ≤220px」对长文案失效。改为**先隐形渲染量实际宽高再定位**：右侧放不下翻到光标左侧、底部放不下翻到光标上方、超视口宽贴右缘，配合 `max-width:min(420px, calc(100vw - 16px))`（宽窗口单行、超窄换行）兜底。趋势图/散点图悬停浮层同链路一并受益。

## 1.8.15（2026-11-10）

- **修时间线显示「同步时间」冒充创建时间（根因级）**：洞察页最近笔记时间线的时刻应取笔记创建时间，实测三条新划线全显示 2026/11/9 23:00——正是同步时刻。取证链：web 端 `/web/book/bookmarklist` 对新管线划线（回包 `type:0`、无 style）**不返回 createTime**（旧划线正常返回），`transformNotes` 的 `Date.now()` 兜底把同步时刻写成 createTime 并持久化为 md「记录时间」；同书 2018 年旧划线时间正常即为对照。官方网关 `/book/bookmarklist` 实测条条带真实 createTime（含当日新建），web 通道则拿不到——修复分四层：
  1. **不再伪造**：`transformNotes`/`toSec` 缺 createTime 落 0 而非 `Date.now()`；解析层 `buildBaseNote` 默认 createTime 由「解析时刻」改 0（顺带修掉无锚点笔记内容哈希混入时刻导致的 noteId 每次解析漂移——type-4 书评注释早已点明此坑）。
  2. **远端权威自愈**：`mergeWithLocalNotes` 中匹配笔记的 createTime 以远端真实值为准（本地版本即便因时间戳较新胜出也覆写）——存量被污染的「记录时间」在网关通道（绑定 API Key）下一轮同步自动修复；`isNoteChanged` 纳入 createTime 差异（远端有真实值时）保证触发 md 重写。
  3. **未知时间聚合豁免**：createTime=0 的笔记不再被时间窗剔除（刚同步的新划线不从时间线消失），时间线内置前（最新批次语义，防 top-50 截断）；热力图/活跃日/连续天数只统计有时间笔记，不产生 1970 假桶。
  4. **记录时间写盘规范格式**：`toLocaleString()` 改 `YYYY-MM-DD HH:mm:ss`（locale 无关），杜绝 Date.parse 无法往返的 locale 格式引发每轮重写；旧格式文件仍可解析。
- **时间线笔记类型徽标化**：原正文行首纯文本「划线 」前缀取消（与 meta 行类型重复），改为 meta 行内徽标（时间 · 书名 · [划线/想法/划线+想法] · 章节），划线=品牌蓝、想法=琥珀、划线+想法=绿描边，未知名目走中性灰。
- 月报/周报时间线条目对 createdAt=0 显示「时间未知」而非 1970。
- **运维提示**：cookie 通道拿不到新管线划线的创建时间是服务端裁剪，代码侧无法凭空补——账号绑定官方 API Key（设置页「官方通道」）后网关优先，新划线即有真实时间且存量污染自动修复。
- +16 smoke 断言（不伪造/自愈覆写/不清零/往返无损/新旧格式解析/聚合豁免/置前）；332 断言全绿。

## 1.8.14（2026-11-10）

- **修「模块 title 不是独立一行」真正的病根（两个）**：
  1. **双列并排拆除**：v1.8.6 引入的容器查询双列网格在 DSH 宿主提供祖先容器时生效，半宽卡片两两并排——相邻卡片的内容出现在本卡标题右侧，视觉上「标题与内容同行」。用户三连反馈并以唯一全宽的笔记配置卡为范本。全面回归单列全宽（表单内部双栏与极窄标签上置保留，两者均为合法后代查询）。
  2. **数据与卸载卡出血修复**：日志卡收尾自 v1.8.6 起多一个右括号，把 grid 提前关死——数据与卸载卡（及 v1.8.13 的版本脚注）被挤到 wr-body 直下，全宽 1768px 出血（真机截图裁切 1068px 宽实况）。归还括号后七卡全部 860px 等宽。
- **新增 tools/layout-repro.mjs**：真 React 渲染 Settings + 无头 Chrome 量几何（每卡各子块 x/y/w/h + 祖先容器模拟），本轮定位两病根的关键工具，可复用。
- **rmsmoke 新增嵌套守卫**：grid 必须 8 子（7 卡+脚注）、wr-body 只含 grid，括号漂移弹卡出血即测试失败。
- 定位方法升级：四轮反馈的「标题不独立」实为并排+出血叠印；几何复现（860px 等宽/标题 y 领先内容 43px）取代肉眼推断。

## 1.8.13（2026-11-09）

- **模块标题分隔强化**：真机截图反馈 v1.8.12 前的 1px 浅灰分隔线太弱，标题与首行内容视觉粘连像「同一行」。标题下分隔线改为 2px 深一档（border-l2）+ 下间距 10→14px，所有模块标题行一眼独立。
- **设置页新增版本脚注**：页面底部显示 `weread-dsh v1.8.x`——重启后一眼确认当前加载的构建（本轮用户截图实为 v1.8.11 旧布局：登录按钮仍在标题行，新版未加载）。
- **build.mjs 自动注入版本号**：`W.VERSION` 取自 package.json 注入 client.js，`--check` 逐字节比对强制同步，升版本永不漂移。

## 1.8.12（2026-11-09）

- **修悬浮阅读入口随窗口缩放出界**：v1.8.11 只在恢复位置时夹紧一次，拖动过悬浮球后再调整面板/窗口宽度，球仍会落到可视区外「看不到」。现在监听父容器尺寸变化（ResizeObserver + resize 兜底，rAF 合帧），坐标一越界立即夹回可视区——任何时候悬浮球始终可见。
- **设置页模块 title 全部独占一行**：对齐笔记配置模块的标题样式——账号管理（重新登录）、官方通道（绑定 API Key）的动作按钮移到标题下方独立行右对齐，单例阅读窗口的「✓ 就绪」状态移出标题行；重复文件清理/日志/数据与卸载本就合规。rmsmoke 新增守卫：所有 `wr-set-title` 只允许「图标+文字」，混入按钮即测试失败。

## 1.8.11（2026-11-09）

- **修悬浮阅读入口「消失」**：拖动过悬浮球后面板变窄/变矮时，记忆坐标落在可视区外——重启后球再也看不到点不到。恢复位置现在 clamp 进当前面板尺寸（rAF 等 layout 后夹紧），坏坐标自愈。
- **账号管理行视觉强化**：每账号独立行加分隔虚线（末行无）、行距加大；窄面板下名称占主导、操作按钮组整组换行不散乱。

## 1.8.10（2026-11-09）

**四项体验优化**。

- **同步进度显示**：同步中状态栏实时显示「百分比 已完成/总数 本书 · 当前书名」（取自 /api/state 的 syncProgress 链路；此前仅「同步中…」恒定文案）。
- **登录状态跨端共享**：打开登录弹层核验失败时，自动尝试从阅读窗口导出当前会话（CDP 取 wr_vid/wr_skey）并走采纳判定（同源校验 + 账号匹配 + 服务端裁决），采纳后复核呈现真实状态——「窗内已登录而弹层报已过期」不再出现。采纳逻辑提取为 `adoptWindowSession`（开窗反向同步与弹层核验共用）。
- **账号管理布局**：每账号独立一行——头像（无头像占位图标）+ 名称/活跃标签 + 右侧操作按钮组（切换/删除整组对齐，窄面板整组换行）。
- **阅读窗口多账号隔离**：profile/state 按活跃账号分目录（`reader-profile-<账号>` / `reader-window.<账号>.json`）——每账号独立登录态、独立窗口单例、bounds 各自记忆；切账号后 open() 自动落新账号 scope，空 profile 首开自动注入该账号 Cookie（免重登）。退出兜底遍历全部账号 state 带走所有实例；进程核验放宽为 profile 基前缀（覆盖全部账号）。旧单账号路径无缝兼容；测试可注入 `rawConfig.getAccountId` 固定语义。
- +4 smoke 断言（多账号 scope 隔离/存量兼容/ownedPids 集合）；316 断言全绿。

## 1.8.9（2026-11-09）

- **插件名语言联动第二通道**：locale 重注册路线真机验证不触发侧栏重绘——语言切换时改为 **dispose + 重注入侧栏 slot**（slots store 更新驱动宿主重渲染取新 label），与 locale 重注册并存双通道。侧栏项注册提为可重执行函数。

## 1.8.8（2026-11-09）

**三项真机反馈**：插件名语言联动补强、同步完成增量 toast、登录二维码本地化。

- **登录二维码本地生成（根除境外依赖）**：原客户端 img 直连 `api.qrserver.com`（境外公共服务）——网络不可达时二维码破损（真机实况：alt="login qr" 占位符，与 npm registry 同被阻断的环境）。vendor qrcode（MIT，core + svg-tag 渲染器 + dijkstrajs）至 `lib/vendor/qrcode/`，新增同源端点 `GET /api/login/protocol/qrcode?data=`（限微信读书域、512 字节、no-store）返回 SVG；客户端 img 改指本端点。**vendor 与原包输出经 4 文本 × 4 ECC 级别 = 16 组逐字节比对一致**；files 清单含 vendor（pack 28 文件）。
- **同步完成 toast 带增量**：syncState 新增 `lastSummary {syncedBooks, syncedNotes, failedBooks, at}`（服务端成功路径写入）；客户端完成 toast 显示「同步完成：N 本书 · M 条笔记[· K 本失败]」，全 0 时「无更新」——覆盖手动/登录后/调度器全部触发源。
- **插件名语言联动补强**：侧栏是宿主 React 树，插件内部语言切换不触发其重渲染（v1.8.7 不足的根因）。语言变化时把当前插件语言的面板名重写入宿主 locale 三语槽位（幂等覆盖）→ locale store 更新驱动宿主重渲染 → 侧栏 label（惰性读 W.t.panel）拿到新名。初始挂载即对齐一次。
- +3 smoke 断言（vendor SVG 合法性 / 端点 200 / 非 weread 域 400）；npm test 312 全绿。

## 1.8.7（2026-11-09）

**两项用户反馈**：切语言插件名不同步；多账号落地。

- **语言↔插件名联动**：侧栏插件名改由插件界面语言驱动（原走宿主 locale.bind，切插件语言侧栏名不动）；语言配置新增「跟随 DSH 界面语言」（`auto`，**新默认**）——面板文案与插件名随 DSH 宿主语言自动切换（`W.detectHostLang` 经 locale.bind 翻译反推宿主语言）；显式选 zh/zh-TW/en 则固定。存量已保存过设置的用户不受影响（其 prefs.language 为具体值）。
- **多账号真行为**：`multiAccountEnabled` 从假开关（基线起配置存了但零消费）转真——开：登录新账号即新增并存、自动切换活跃账号；关：登录新账号连同凭据/Cookie 续命定时器清理其余账号（保持单账号）。策略经 `auth.setMultiAccountPolicy` 由宿主注入（读运行时配置）。
- **登录弹层多账号语义提示**：顶部显示「当前：xxx · 新登录将新增/替换账号」，登录前即知结果（三语）。
- +5 smoke 断言（多账号并存/切换/替换清理、语言默认 auto）；npm test 304 → 309 全绿。

## 1.8.6（2026-11-09）

**设置页布局/样式/自适应重做（用户需求）**。全部文案与字段逻辑不动，rmsmoke +6 条结构守卫。

- **容器自适应（核心）**：`.wr-set-grid` 弃用 `max-width:640` 单列——改 CSS 容器查询（`container-type:inline-size`，按面板实际宽度而非视口断点）：≥700px 自动双列网格（笔记配置大卡全宽+内部双栏：存储同步｜界面/AI 集成；其余卡片两两并排），≤430px 标签上置式表单（替代原 110px 固定左列在窄面板的挤压换行）。
- **视觉层次**：卡片标题统一「图标+标题+右侧动作」flex 行（原 `margin-left:auto` 在块级标题下不生效，按钮从未真正靠右）；卡片标题带底边框分隔；卡内分组（界面集成/AI 集成）降级为色条小标题 `wr-set-subtitle`；结果/提示块加左侧强调条。
- **粘性保存条**：保存按钮 `position:sticky` 吸底——长表单滚动途中常驻可见，不再需要滚到最底。
- **开关行两端对齐**（`justify-content:space-between`，标签弹性+开关贴右）；数字输入统一 `wr-num` 宽度类；危险操作按钮收敛 `wr-btn-danger` 类；统一 `:focus-visible` 键盘焦点环（可访问性）；目录选择弹窗宽度 `min(560px,92vw)` 自适应。
- 新增 3 个图标（key/terminal/spark）；rmsmoke +6 条设置页结构类守卫（防布局回归）。

## 1.8.5（2026-11-09）

**对抗性审查 v2 全量修复（4 批 commit：P0×2 + P1×13 + P2×31；报告见 docs/adversarial-review-v2.md）**。npm test 由 291 → 304 断言，+3 组真机盲区回归守卫。

- **P0-1 noteId 互逆性断裂（每轮同步全库全量重写 + 手加笔记每轮丢失）**：写盘每条笔记输出 `<!-- wr:nid:ID -->` 锚点；解析侧锚点还原远端 noteId（原版无条件覆盖 `local_<sha1>` → detectNoteChanges 永报全量变更）；💬 行并入未终结的相邻划线（「划线+想法」不再拆 2 条，时间行/章节边界=终结符）；isNoteChanged 的 modifyTime 仅双方在场时比较（读回恒 undefined 致每轮误报 modified）；mergeWithLocalNotes 保留 local-only（手加笔记不再被静默丢弃）。实测：数据不变的第二轮 diff 全零（原版 a:N/d:N 恒全量），真实变更/新增/删除仍正确检出。
- **P0-2 WS 客户端重连指数扇出（后端不可达 18s 实测 155 万条重连链）**：onerror+onclose 双触发只计一次 + 退避 NaN 兜底 + ±20% jitter；修复版实测同时长降至个位数。
- **P1 全修**：登录后 syncing 永久卡 true / 每次手动同步假「无更新」toast（客户端语义跟上 /api/sync 异步化，轮询监测终态复位）；发现页未绑 Key 静默变设置页（tab/activeTab 一字之差）；同步中切账号跨账号污染（worker 每书前校验活跃账号，变了即中止）；syncBook 与 fullSync 零互斥（统一 syncingAccounts）；漫游会话多端点并发双推进/旧状态写回（per-key promise 队列串行化）；扫码轮询 error 相位泄漏 + dispose 不清理；Agent 工具 sync 裸调绕过 fs.watch suppress（B3 回归）；fetchUserInfo 无超时挂 5 分钟堵死阅读窗口队列；npm pack 缺 lib/*.mjs（分发即崩，实测坐实）；36 版未提交 + 核心文件 untracked（git clean 即灭失 v1.5-v1.8）；test 链缺 build --check。
- **P2×31**：api 重试纪律（4xx 不重试/429 Retry-After/jitter）；扫码防重入+取消竞态终检；自动同步失败 30min 退避；gateway body 超时；grade 非法 400；roaming meta 写放大/收藏淘汰保护；CHEAP_SIG 串键；wsbus ping 半开剔除/Origin 校验/写背压；readBody 挂起；searchMap 3 槽 LRU；refresh=1 8s 上限；gateway key 登录门禁；client-diag 节流；readerWindow 三路轮询共享 probe/僵尸清理二次确认/导航去抖分槽/probe 过滤/wsCall timer/window.close nativeness 伪装；@选书防抖/memo 打穿修复/挂载双请求/ToolView memo/ScrollText timer/wrDiag catch/统计代次守卫。
- **测试补盲**：wsbus Origin 拒连+超大帧拆线（真 WS 客户端）；upgrade 钩子接线断言；client-diag 路由断言；MCP 异常→isError；@选书候选形状守卫（v1.8.3 name 崩溃回归线）+前缀门控+防抖（sandbox 真 timer + 跨 realm race 适配）；smoke 180s 全局超时。
- 待真机验证 3 项暂缓：后退 450ms 兜底误判（P2-20）、1.5s CDP attach 与 bfcache（P2-21）、面板不可见轮询门控（P2-33）。

## 1.8.4（2026-11-09）

**修阅读窗口工具栏导航四键「无反应/延迟严重」（真机探针：书架页命中/主线程均健康 → 病在逻辑层）**。

- **三个病根**：① app 窗口直开书页时 history 栈为空，裸 `history.back()/forward()` 是无操作（「无反应」）；② 刷新/回首页在 canvas 书上是整页重载，秒级且零反馈，连点还会把导航叠起来（「延迟严重」）；③ 工具栏被微信读书重渲染摘掉后，3s 自愈轮询最坏留 3 秒「看得见点不动」死窗。
- **修法**：导航四键全面升级——即时 toast 反馈（`wr-nav-hint`）+ **900ms 连点去抖** + **死历史兜底**（后退无可退 → 自动去书架；前进无可进 → 提示「已是最新一页」）；「回微信读书首页」改为「回书架」（直达 `/web/shelf`，已在书架则提示不空跳）；刷新带「刷新中…」反馈。
- **失联自愈升级**：`MutationObserver` 盯 documentElement 直系子节点，工具栏被摘掉的瞬间 150ms 内补回（替代 3s 轮询死窗；页面内部 churn 不触发，零开销）。
- 291 断言 ×2 全绿（+2）。

## 1.8.3（2026-11-09）

**修 @ 菜单整体消失（真机三验：连官方分组都没了）——诊断信使首战立功**。

- 现象链：v1.8.2 注册成功（信使回报已确认）→ 输 `@微信读书` 候选渲染即崩 → React 崩掉整个菜单组件 → 之后输 `@` 也全空。
- **崩溃点（DSH 菜单渲染源码）**：`item.label !== void 0 && item.label.toLowerCase() !== item.name.toLowerCase()` —— `item.name` **无守卫解引用**；我们的候选只有 `label` 没有 `name` → TypeError。
- 修复：候选补 `name`（与 label 同值，别名行不渲染）。命中探针加 30s 节流防刷日志。
- 经验（候选）：DSH 菜单候选条目的安全形状是 `{name, label, value, section?}`——**`name` 必填**，`icon/description/drill` 可选。

## 1.8.2（2026-11-09）

**修 @ 选书仍不出现（真机二验）+ 按用户需求改为前缀触发**。

- **根因（双门禁）**：v1.8.1 只补了 `dsh.client.inject` 包声明（服务进 fiber），但插件模块返回对象的 `inject: ['slots','locale']` 是**服务名门禁**——`ctx.get('inputTriggers')` 仍被拒。官方 ui-skill 的形式是模块 inject 里直接列 `"inputTriggers"` 服务名。现两处都齐。
- **前缀触发（用户需求）**：`@微信读书` / `@weread`（前缀后可跟书名关键词）才出现「微信读书」分组——不与官方 @ 文件/子智能体/对话候选混排。
- **诊断信使**：新增 `POST /weread/api/client-diag`，客户端关键节点（服务不可用/注册成功/注册异常）回报宿主日志——静默失败从此直接可见，不再浪费排查轮次。
- 289 断言 ×2 全绿；构建校验 291287 字节一致。

## 1.8.1（2026-11-09）

**修 @ 选书不出现（真机首验：输 `@` 只有文件/对话组，无书架候选）**。

- 根因：插件客户端 ctx 按声明注入服务——`dsh.client.inject` 没声明 `@deepseek-ai/dsh-client-ui-input-trigger`（官方 reference/commands/skill 全都声明），`ctx.get('inputTriggers')` 拿不到，v1.8.0 的注册被防御式 try/catch 静默吞掉。
- 修复：inject 列表头部补上该包（DSH 核心自带，官方 UI 包硬依赖它，无兼容风险）。
- 教训（候选经验）：**插件客户端服务必须查 manifest inject 门禁，防御式 try/catch 会把「服务没注入」伪装成「功能没生效」**。

## 1.8.0（2026-11-09）

**roadmap §11 平台能力拓展点四项齐发（@选书 / 工具富渲染 / MCP 写路径 / 面板实时化）**。

- **§11-1 对话输入框 `@` 选书**：客户端注册 `inputTriggers` 源（trigger '@'）——输 `@` 弹书架候选（前 8 本），选定插入 `@《书名》` 提及；模型凭书名调 weread 工具取笔记；点击提及打开插件面板该书详情（title→bookId 反查缓存）。防御式注册：服务缺失/形状不符静默跳过。
- **§11-2 工具结果富渲染**：weread 工具 books/search/notes/roaming/insights 五动作的文本首行附 `<!--wr-card:JSON-->` 结构化标记（模型可无视）；客户端 WereadToolView 解析渲染可点 chip——封面小图 + 进度/划线数 + 出处，点击进面板详情；标记后原文折叠保留。
- **§11-5 MCP 写路径**：mcp-server v0.5.0 新增 4 工具（共 9）：`weread_sync`（触发同步）、`weread_roaming_card`（抽卡）、`weread_roaming_action`（next/prev/收藏/复习评分/reviewStart/End/refresh）、`weread_roaming_filter`（漫游池过滤）。selftest 12 断言全绿。
- **§11-6 面板实时化**：`lib/wsbus.mjs` 零依赖 WebSocket 总线（自实现 101 握手 + 掩码帧解析 + ping→pong），挂 `webServer.registerUpgrade('/weread/ws')`；同步（started/done/相位变化，覆盖调度自动同步）与漫游动作（面板/MCP 触发）实时广播；客户端 dock 换卡、KPI 胶囊刷新即时响应（悬停不打扰）；WS 断连自动退避重连，消费方保留轮询兜底。
- 289 断言全绿（+7：wsbus 真客户端端到端 3 + wr-card 标记 4）；需 ⌘Q 重启真机验证（重点：@ 候选弹层、工具卡 chip 点击、dock 即时换卡）。

## 1.7.20（2026-11-09）

**问 DSH 双入口职责拆分 + 弹条取词修复 + roadmap 拓展点落盘**。

- **工具条「✦ 问 DSH」简化（用户需求）**：只做输入框开合——点开并聚焦、再点收起、**失焦自动收起**（150ms 宽限保住「发送」按钮的 click）；就绪-自动发等功能从工具条移除（划选弹条入口保留全功能）。
- **修弹条「问 DSH」未自动带走选区**：canvas 书选区不在 DOM、弹条出现前无任何动作快照，点击时四层触发链全空 → 只进就绪态。现在**借道同弹条官方「复制」按钮**：真实点击给了文档瞬时激活（user activation 文档级），程序触发其复制流时 execCommand 放行 → copy 钩同步截获 → 自动发送 + 送达 toast（90ms×4 重试容其异步；无「复制」按钮或未截到则回落就绪态）。副作用说明：借道会把选中写入系统剪贴板（与官方复制一致）。
- **roadmap §11 落盘**（`docs/roadmap.md`）：DSH 平台能力拓展点 1/2/5/6 立项——@选书（inputTriggers）、工具结果富渲染（output.render）、MCP 写路径、面板 WebSocket 实时化（registerUpgrade）；未选 3/4 备查。
- 280 断言全绿（+2 新断言：工具条专职开合、弹条借道复制）；需 ⌘Q 重启 + 重新扫码后真机验证。

## 1.7.19（2026-11-09）

**体验三修：问 DSH 输入框常驻遮挡 + 侧栏 KPI 胶囊含义/不更新 + 漫游小卡设置项联动**。

- **输入框收纳三保险（修常驻遮挡）**：原版「再点一次收起」只在 60s 就绪期内生效——过期后白框永远关不掉、遮挡阅读内容。现在：① 输入框开着时点「问 DSH」=收起（不论就绪期）；② **90 秒无输入自动收起**（输入重置计时）；③ **点击框外任意处即收起**、Esc 收起。文档级监听每文档只挂一次（3s 自愈重跑 inject 不叠加）；自动发送命中时顺手收起。
- **侧栏 KPI 胶囊**：`X天/N条` = **近 30 天活跃天数/笔记条数**（悬停有说明）。不更新的原因：胶囊有 30 分钟模块级缓存且挂载后不重取——服务端洞察在同步后其实已新鲜。现在**同步完成后立即失效重取**（手动同步/登录后自动同步两条路径都接上；旧值先展示不闪空，3s 去抖），tooltip 注明「同步后即时更新」。
- **设置页联动**：「输入框下方漫游小卡」关闭时，收起其专属设置项（滚动方式/自动轮播/轮播间隔/字号/滚动速度——都只作用于小卡）。
- 280 断言全绿（+1：收纳三保险标记断言，重写旧的开合断言锚点）；build 校验 283296 字节一致。

## 1.7.18（2026-11-09）

**修两件事：书页一律「加载失败」的归因与提示 + DSH 退出后阅读器 Chrome 不回收（quit 钩子）**。

- **「加载失败」根因（真机取证）**：阅读窗口 Cookie 注入照常，但页内 `/web/book/info` 返回 `errCode:-2012「登录超时」`、宿主 `login/verify` 同判 `cookie.expired:true`——**插件 Cookie 通道已在服务端过期**，死 Cookie 注进窗口页面等于未登录，书页一律「加载失败，请点击重试」（API Key 通道不受影响，笔记同步照常，故不易察觉）。**恢复办法：设置 → 扫码登录 重新登录一次。**
- **代码修正（不再无脑注入死凭据）**：`prepareSession` 注入前先服务端裁决自家凭据（复用 v1.7.6 `checkSession` 通道，仅 `false` 确判才动）：判死 → 跳过注入、`open` 结果带 `loginExpired`，open-reader 路由记 WARN、客户端 toast 明确引导「重新扫码，笔记同步不受影响」——把「窗口坏了」和「该重扫了」分开。裁决通道异常（`undefined`）维持原注入行为（保守不误报）。
- **quit 钩子（退出兜底）**：DSH 退出是「最多 5s 宽限 → `process.exit()` 强退」（dsh profile-boot `PROCESS_SHUTDOWN_TIMEOUT_MS=5000`），dispose 的 Browser.close/listPids 全是异步往返，慢机器上被强退打断 → Chrome 成孤儿、下次启动受牵连。现补进程级 `'exit'` 钩子（`process.exit()` 前同步触发）：**ps 身份核验（命令行含本 profile，防 pid 复用误杀）→ SIGTERM 整个进程组**（detached spawn 即组长，渲染/GPU 子进程一并带走），零 await；dispose 也改为同步先杀、异步收尾。tier1 spawn 落盘 pid；reopen 转发进程是瞬时不记。SIGKILL 级硬崩无法拦截，残留由既有 pgrep 清扫兜底。
- 279 断言全绿（新增 12：exit 钩子注册/ownedPid/同步击杀/dispose 摘除、凭据判死三态 ×2 场景）；重写 13.78-D 旧断言（空 profile「不裁决」正是「加载失败」陷阱源头）。

## 1.7.17（2026-11-09）

**「问 DSH」划线即捕获（对齐官方 AI问书 的自动化，替代手动复制）**。

- **用户诉求**：像官方「AI问书」一样自动拿到选中文本，不要手动复制。
- **排查全记录**（canvas 书选区只活在他们闭包里）：DOM selection 被 `user-select:none` 封死；`DataTransfer.prototype.setData` 原型钩不被其 copy 事件对象命中（v1.7.16 已改事件级捕获兜底）；Vue 实例 `__vue__` 生产版抹除；合成/CDP 代点被 user-activation 校验拦截。反混淆 bundle 定位到官方实现：**选区=内容对象数组（getOffset/getTextLength），划线时 `abstract: getTextFromObjs(...)` 必然进自家 API 请求体**。
- **方案（fetch/XHR 自捕获）**：页面内挂 fetch + XMLHttpRequest 钩，凡官方 API 请求体携带 `abstract/markText/content/text` 文本字段（含中文/字母、非 base64、4-2000 字）即截获为划线快照；排除埋点（river/report/midas/logging）。**点马克笔/波浪线/写想法 = 文本天然出口，无需复制**。
- **新触发链**：DOM 选区 → 选区快照 → 剪贴板快照 → **划线接口快照**（各 120s）→ 输入框。就绪态提示更新为「划线或复制，截到即自动发送」。
- 顺手把 v1.7.14 的模板字面量 `\/` 转义坑又补了一处（`/log` 边界）——smoke 编译守卫再次拦截。
- 267 断言全绿。

## 1.7.16（2026-11-09）

**「问 DSH」复制截获真路径修正（真机五轮：就绪提示正常，但真实复制后未自动发送）**。

- **真机取证**：用户真实点「复制」后检查页面状态——`DataTransfer.prototype.setData` 原型钩**未捕获**（其 copy 事件的 clipboardData 对象另有来源，不走原型链）。CDP evaluate 上下文无用户激活，自测 execCommand 被拒（事件都不触发），只能靠真实点击验证。
- **修正（capture-copy 双保险）**：document **捕获阶段**监听 `copy` 事件（官方实现必经此事件，且捕获先于其监听执行）：① 每事件**实例级**包裹 `ev.clipboardData.setData`；② 复制瞬间官方临时元素（selectNodeContents + execCommand 的实现）的选区文本就在 `window.getSelection()` 里——直接读取。两条路任一命中即喂快照并触发就绪自动发。
- 265 断言全绿。

## 1.7.15（2026-11-09）

**「问 DSH」时序反转（真机四轮：点「复制」会收起弹条，弹条里的问 DSH 随之消失）**。

- **问题**：官方「复制」按钮点击后弹条即收起——「复制 → 点弹条问 DSH」的顺序永远走不通；且合成/CDP 代点复制均被用户激活校验挡住（实测 setData 未触发）。
- **方案（就绪-自动发）**：先点「问 DSH」（任意入口）→ 进入 60s 就绪态（toast 提示）→ 再点「复制」（弹条收掉无妨）→ 钩子截获 setData 的瞬间**自动发送**。就绪期内再点「问 DSH」= 切换为手动输入框。划选快照到达同样触发自动发。
- **入口重复说明**：弹条「问 DSH」与顶部工具条「✦ 问 DSH」并存是有意为之——弹条随选区出现/消失，工具条是弹条不在时的常驻入口（如复制收弹条后、无选区提问）；两者行为完全一致。
- 264 断言全绿。

## 1.7.14（2026-11-09）

**「问 DSH」canvas 书选区捕获（真机三轮：弹条注入成功但走了输入框兜底）**。

- **排查**：这本《走进我的交易室》正文 canvas 渲染 + `user-select:none`——选区**完全不进 DOM**（selectionchange 快照也拿不到）；选中文本只活在微信读书 JS 闭包里。反混淆其 bundle：**「复制」的实现是 copy 事件里 `e.clipboardData.setData(format, text)`**。
- **剪贴板钩**：注入脚本挂钩 `DataTransfer.prototype.setData`——用户点弹条「复制」的瞬间，选中文本即被截获快照（其临时元素的 selectNodeContents 也会顺带喂饱选区快照）。触发链兜底：**DOM 选区 → 选区快照 → 剪贴板快照（各 120s）→ 输入框**。
- **canvas 书标准流（两击）**：划选 → 点弹条「复制」→ 点「问 DSH」（自动带走）。DOM 书仍是一击直达。
- 修复过程中另修模板字面量转义坑（`\/` 在模板串中被吃成 `/` 导致注入脚本语法错误，smoke 编译守卫捕获）。
- 263 断言全绿。

## 1.7.13（2026-11-09）

**「问 DSH」真机二轮修复（真实点击无 toast + 多会话找不到答案）**。

- **划选弹条注入（主修）**：程序化点击全链正常而真实点击无 toast——真实点击被微信读书自己的选区弹条（同 z-index、后入 DOM）**遮挡截走**。现在把「问 DSH」**直接注入微信读书的划选弹条**（克隆其「AI问书」按钮样式、蓝色字、排在其右侧；cloneNode 不携带原监听、无误触发）：划选 → 弹条上直接点「问 DSH」→ 带走选区。随弹条创建/销毁，3s 自愈周期幂等补注。
- **送达会话标明（多会话定位）**：用户开着 3 个 DSH 会话，答案一直正常推送到 session-79 但用户看的是别的窗口——以为「没有作答记录」。现在 toast 直接显示 **「✓ 已送达 DSH「会话标题」」**；诊断接口列出全部活跃会话（id/status/标题）。
- 261 断言全绿。

## 1.7.12（2026-11-09）

**「问 DSH」体验修复（真机截图反馈：输入框显示迟缓 + 需手动复制粘贴选中文本）**。

- **选区快照（免复制粘贴）**：微信读书的划线动作（马克笔/波浪线等）会**消费掉 DOM 选区**——用户先划线再点「问 DSH」时选区已被清空，只能回落输入框手动粘贴。现在注入脚本监听 `selectionchange`，划选瞬间抓快照留存 120 秒；点按钮时优先用当前选区，其次用新鲜快照——**划线后直接点 ✦ 即可自动带走原文**。
- **输入框预渲染（修迟缓）**：原实现点击时才创建输入框 DOM，赶上页面正在渲染高亮（canvas 重绘）就明显卡顿。改为工具条注入时预渲染（隐藏），点击只做 `display` 切换——零 DOM 构建，即时弹出；Enter 发送 / Esc 关闭 / 再点按钮开合切换。
- 258 → 260 断言（快照监听 + 预渲染切换标记）。

## 1.7.11（2026-11-09）

**修复「问 DSH」真机不作答的真凶 + 诊断过程两项附带修复**。

- **真凶（CDP 返回形状读取错误）**：`drainAskQueue` 读 `Runtime.evaluate` 结果只取了一层 `rs[0].result.value`——真实 CDP 返回是双层 `{result:{result:{value}}}`（外层包装 + RemoteObject），恒为 undefined → **页面队列被 splice 取走后静默丢弃**（表现为：点了没反应、无日志、诊断 at=0）。修正为双层读取并兼容扁平形状。
- **为什么测试没拦住**：smoke 假 wsCall 恰好返回扁平形状，与 bug 同构——已把两处假实现改为真实 CDP 形状（对该 bug 永久回归）。
- **诊断手段（本轮立功）**：v1.7.10 的 askAgents 诊断段确认了「服务可用、roots=2、onReaderAsk 从未执行」→ 锁定 drain 环节；真机分段测试（点按钮/开输入框/手工入队/查队列存活）进一步锁定读取层。
- **附带修复（存量缺陷，跨周午夜实测翻车）**：「洞察含阅读目标进度」测试用固定时间戳笔记，周窗口跨天瞬间出窗导致 00:04 失败——改为动态写入当下时间戳笔记（任何时刻属本周）断完即删。
- 258 断言全绿（跨午夜复跑 ×2）。

## 1.7.10（2026-11-09）

**修复「问 DSH」首版真机失败（推送会话无反应）**。

- **根因定位过程**：页面链路完好（队列被排空、按钮在位），失败发生在宿主 onReaderAsk 内部——而首版失败路径**无日志**（只有成功路径记录），无法区分「agents 服务取不到 / 无活跃会话 / followup 异常」三种可能。
- **修复**：
  1. `export const inject` 增加 `'agents'`——服务在插件加载时保证在场（原 `ctx.get('agents')` 单通道在宿主插件上下文中可能解析不到）；
  2. 服务获取双通道 `ctx.agents ?? ctx.get('agents')`；
  3. **全路径留痕**：每次问 DSH 的成败都写 op 日志（失败含原因与活跃会话数）；
  4. `agent.followup()` 单独 try/catch（消息投递异常不再静默）；
  5. `GET /weread/api/open-reader/diagnose` 增加 `askAgents` 段（服务可用性 / roots 数 / 最近一次问 DSH 结果），可 curl 实时确诊。
- 258 断言全绿（含 1.7.9 的 12 项选中即问用例）。

## 1.7.9（2026-11-08）

**选中即问 v1（阅读窗口 → DSH 会话）**——基于微信读书自带「AI 问书」的实测调研做差异化（调研结论：官方 AI问书实际是全库搜索问答，chatid=search_entrance，会把其他书的内容当"本书"作答且不标注——实测两问全部引自其他书）。

- **阅读窗口工具条新增「问 DSH」按钮**：划选文本后一键把（选中文本 + 书名 + 章节）递给 DSH 会话；无选中文本时弹出输入框（可粘贴/直接提问）。页面内 toast 回执（已送达/失败/30 秒超时）。
- **通路零新增攻击面**：页面把问题写入 `window.__wrAskDSH` 队列，宿主复用既有 1.5s 注入守护轮询顺路排空（一次轻量 evaluate，无域启用、短连即断）——无跨域请求、无新监听端口、无 CORS/Origin 改动；回执经 evaluate 回写页面。
- **宿主 onReaderAsk**：按页面书名解析本地索引（bookId + 笔记文件路径），附该书最近 3 条划线作个人上下文，构造提问消息 `agent.followup()` 唤醒**最近活跃的 DSH 会话**作答（消息 source.kind='weread-reader'，限频 10s/条）。消息内置引用规范：只引本书并标章节出处、引其他书必须标注书名（正面规避官方 AI问书的跨书混同缺陷）。
- **回答发生在 DSH 对话流**：可继续追问（带完整上下文）、可检索（sessionQuery）、AI 可调 weread 工具（notes/ask）查全书——官方面板没有的能力。
- 测试 246 → 258：Bootstrap 标记与语法、队列排空（载荷/回执/零重复）、apply 级端到端（followup 恰好一次、消息形状/书解析/划线上下文/引用规范、限频）。
- **待真机验证**：followup 消息为手工构造（结构与官方 `createUserMessage` 一致：id/role/content/source，已按 dsh-llm/dsh-agent-loop 源码核形），未经过活跃 DSH Agent 实测；失败路径有日志与页面回执兜底。
- 版本说明：1.7.7/1.7.8 为并行会话交付（漫游关键词、命令富卡片、doc-reader 路径桥接）；本条目在其上叠加，未改动其内容。

## 1.7.8（2026-11-08）

用户需求两条：`/doc` 等阅读器命令反馈同款卡片；卡片里的文件路径可点击打开。

- **路径可点击**：命令富卡片结果文本中的绝对路径（`/Users|/private|/tmp|/var|/opt|/home` 开头）渲染为可点击链接。点击优先派发 cancelable 的 `dsh:open-in-reader` 窗口事件——doc-reader 插件在场时 preventDefault 接管、激活阅读器面板直接打开；无人接管时回退网关新增的 `POST /weread/api/open-file`（宿主校验路径必须位于笔记输出目录内，防任意路径打开；darwin 用 `/usr/bin/open`、win32 用 `start`、其余 `xdg-open`）。
- 与 doc-reader v0.6.0 配套：其新增 `/doc` 命令富卡片（同款样式）与 `dsh:open-in-reader` 监听桥。

## 1.7.7（2026-11-08）

用户反馈两条：斜杠命令执行后在会话流里看不到反馈卡片；`/weread-roaming 程苓峰` 想按公众号关键词抽卡。

- **命令反馈富卡片修复**：`WereadCommandView` 取参形状与 `conversation.chat.commandview` 槽位实参（`{ node: 命令对象 }`，结果在 `outcome.text`）不符，`p.node.command` 永远取不到 → 富卡片从不渲染，退化为不显眼的通用细行。修正取参链（`p.command ?? p.entry?.command ?? p.node[.command] ?? p`），读 `outcome.text`/`outcome.kind`，并加内联样式兜底（左侧强调边 + 底色卡片，错误态红色），不依赖 CSS_60 也醒目可见。
- **漫游关键词过滤接通**：`normalizeFilter`/`buildFilterKey`/`buildPoolFromIndex` 新增 `query` 维度——书名/作者/分类大小写不敏感包含匹配，建池时整书跳过（省 notes 拉取），池缓存键含 query。`/weread-roaming 关键词` → 保留其他筛选面、设置 query 并立即抽卡（结果文本附「关键词 · 过滤后池 N 张」）；裸 `/weread-roaming` 在存在关键词时自动清除回全池；关键词零命中返回明确错误文案。hint 更新为「可选：书名/作者关键词（如 程苓峰），留空全池随机」。
- 实测：索引 25 本书中「程苓峰」命中 1 本（2 条笔记）；rmsmoke 38 项断言全过；`build.mjs` 重建 client.js（280764 字节）。

## 1.7.6（2026-11-08）

用户反馈：悬浮阅读 icon 打开的窗口「已登录」，但登录弹窗 Cookie 通道芯片「已过期」、发现列表开书即「登录已过期」。

- **排查结论（互通性）**：阅读窗口始终是同一个（单例 + 专用 profile），Cookie 本就共享；不一致是**假象与真相之别**——悬浮 icon 打开的是上次页面（同 URL 不重导航），停留在会话死前渲染的旧 DOM，看着「已登录」；发现列表开书是真导航，服务端校验 skey 失效立即露馅。根因：窗口会话判定只看 Cookie **日期**（v1.5.2），服务端已死的 skey（日期未到）永不换血。
- **三态裁决（换血）**：窗内 skey 与插件 skey 值不同时，宿主用 x-vid/x-skey 裸接口**服务端裁决**窗内会话：死 → 注入插件凭据换血（首启/同 URL 均强制重载页面，撕掉过期假象）；活（窗内扫码的新会话）→ 不覆盖（v1.5.2 保护保持）；网络异常 → 保守不动。值相同或空 profile → 原行为。
- **反向同步（窗→插件）**：窗内会话有效而插件 Cookie 通道缺失/已死时，经统一登录落账**采纳窗内会话**（账号记录 + Cookie 通道 + 登录态广播）——窗内扫码一次，登录弹窗芯片转绿、后续开窗免重登。保护：插件自身凭据仍有效时不打扰；窗内 vid 与当前账号不匹配时跳过（防串号）。
- 测试 230 → 246：三态裁决×4（服务级假世界）、同 URL 换血重载、首启换血重载、反向同步采纳（apply 级 fetch 桩：登录态点亮 + 同源短路 + 凭据保护路径）。修复过程中另修 deps 合并回归（readerDeps 透传被默认覆盖）。

## 1.7.5（2026-11-08）

两项用户需求（书评回读 + 快照拆分），214 → 230 断言。

- **`## 书评` 区块回读为 type-4 笔记（详情页/漫游可见）**：整本书评此前只写进文件末尾区块、不进笔记数组——插件界面完全看不到。现在：
  - 解析器把 `## 书评` 区块读回一条 type-4 笔记（章节「书评」、内容哈希 noteId 跨解析稳定→漫游键不漂移）；
  - 详情页出现「书评」章；漫游池纳入书评候选，**「仅书评」筛选首次真正可用**；
  - 防双写：渲染器跳过 type-4（书评只经 `## 书评` 通道输出）；
  - 防误删：同步管线把 type-4 从变更判定/合并中过滤（书评是独立通道），并对账计数跳过（文件区块已计 1，笔记再计会双算）；
  - **附带修复既有缺陷**：本轮书评拉取软失败但笔记变化触发重写时，原会把 `## 书评` 区块写丢——现用文件已有 type-4 兜底传入渲染器，重写不再丢书评。
- **索引快照拆独立文件（state.json 瘦身，v1.7.4 暂缓项）**：`index.snapshot` 原存在 `state.<account>.json` 里，任何一次 setState（同步状态/对账/日聚合）都连带 MB 级快照全量重写，一轮同步 ≥5 次 = 50-100ms 分散阻塞。现拆为 `index.<account>.snapshot.json` 独立 aux 文件（C3 模式）；旧数据首读自动迁移（搬家 + 从 state.json 删键，其余键原样保留）；卸载清理自动覆盖（globs stateDir *.json）。
- **同毫秒竞态（测试三轮连跑抓到）**：`poolBuiltAt`/`poolsInvalidatedAt` 均用 `Date.now()`，同一毫秒内「建池↔索引重建失效」无法定序，`isSessionStale` 的 `<` 判定随机翻转（生产同理会漏报过期会话 → 用户停在部分池）。改单调递增发号（`max(now, last+1)`），先发者必小，时序确定。
- 已知语义变化：书架/统计的「笔记数」现在把整本书评计 1 条（对账口径不变，仍按内容条目对齐官方三计数）。

## 1.7.4（2026-11-07）

回归测试轮 + 性能对抗性审查修复（176 → 214 断言）。

**审查修复（P1×3 + P2×5，全部带回归测试，关键项突变验证）**：
- **守护定时器关窗后自动停摆（P1）**：原 inject/bounds/jam 三定时器从首次开窗空转到 DSH 退出（用户关窗后仍 ≈158k HTTP 探测/天 + 79k 次同步读盘/天）。现连续 5 轮不见窗口即停摆，open() 自动重启；closeWindow 主动停摆；自愈恢复期缺席不算（恢复后 bounds 守护也重启）。
- **漫游池构建 O(笔记×记录) → O(1) 查表（P1）**：resolveMetaRecord 未命中时线性扫全部 meta 记录（实测 2000 书/6000 笔记/3000 meta：1180ms/次）。getRoamingMetaStore 建 noteId→record 索引 Map，upsert/淘汰同步维护。实测池构建 **1180ms → 3.5ms**；sessionNext 冷路径 **2330ms → 18.8ms**。另：recordAction 复用已读 metaStore（每动作 2 次全量读+normalize → 1 次）。
- **详情页 O(章×笔记) 渲染 → 一次分组 memo（P1）**：渲染体内 chapters.map × notes.filter，300 章×3000 笔记 = 每次渲染 90 万次比较，滚动联动每跨章一遍。useMemo 按章节一次 O(N) 分组，secNotesOf O(1) 查表（渲染/摘录多选共用，语义不变）。
- **getSearchableMap 幽灵引用（P2）**：被两处调用但从未定义，ReferenceError 被 try/catch 吞掉 → B1 搜索预筛从未生效（每次全量逐条扫）。真实现：按快照指纹缓存 bookId→{hayMeta, hay}（hay 含全部笔记文本），书架搜索用 hayMeta（保持原行为），笔记搜索用 hay（预筛首次真正生效）。
- **守护防重入（P2）**：inject/bounds/jam interval 不等上一轮 async 完成——页面卡顿时 evaluate 5s 超时 > 1.5s 周期，实测叠 3-4 个并发 WS。三 tick 各加 busy 标志（突变验证：去掉后并发峰值=3）。
- **自愈不叠加（P2）**：恢复链（关页+等待+tier 重试）可超 20s 周期，持续卡死时下一 tick 会叠加第二轮关页+重拉。inRecovery 期间 tick 早退。
- **协议扫码 error 相为终态（P2）**：登录成功但保存失败后原仍每 1.5s 外网轮询到 5min 超时。
- **否决一项审查建议**：对账「只读前 8KB 判有无书评」——`## 书评` 由渲染器写在文件末尾（markdown.js:287），截读会把大书书评判丢，破坏对账正确性；保持全文异步读（本就不阻塞事件循环）。
- **暂缓（记录在案）**：state.<account>.json 含 index.snapshot 全量重写（每轮同步 ~5 次、2000 书 ≈MB 级 pretty JSON、50-100ms 分散阻塞）——需拆独立快照文件 + 迁移逻辑，收益在后台同步路径非交互路径，留待单独版本。

**测试轮发现并修复**：
- **dispose 竞态（P1）**：渲染 watchdog 自愈走到一半（closeTarget → sleep(1500) → 重开）时宿主 ⌘Q 退出，dispose 清掉定时器但**在飞的回调仍会重拉 Chrome——窗口在 DSH 退出后复活**。修复：`disposed` 标志（tick 顶层 + 关页等待期后双重检查）。突变验证：去掉守卫测试即失败（launch=2）。
- **注入脚本结尾 `inject()` 必抛 ReferenceError（P2）**：命名函数表达式的名字不在外层作用域，每次注入 evaluate 都带异常返回。移除（IIFE 自执行 + DOMContentLoaded 闭包重试本就完备）。
- **`waitReady` 默认参数引用未定义的 `READY_TIMEOUT_MS`（P2）**：休眠 ReferenceError，现调用方恰好全部显式传参掩盖；改常量 9000。
- **测试注入口**：`apply(ctx, { readerDeps })` 透传 readerWindow 依赖，路由级用例（open-reader 503 / diagnose / close）不再依赖真 Chrome。

**新增 38 项单元/回归测试**：watchdog 单击恢复不自愈、dispose 后守护全停、关窗自动停摆+open 重启、closeWindow 停摆、防重入（并发峰值=1）、自愈不叠加、bounds 变更才写盘、并发 open 串行化、同 URL 不重导航、parseCookieHeader/buildArgs 纯函数、noteId 索引语义、代际重试上限（永不稳定不死循环）、TTL 缓存命中、skipIfUnchanged 不扰动代际、搜索预筛真实现、**路由层 stale 会话自动重载闭环**（「1/1 切标签才变 1/58」接线层验证）。

## 1.7.3（2026-11-07）

用户反馈两项：漫游进度环偶发 1/1、阅读窗口工具条点击无反应。

- **漫游 1/1 根治（两层修复）**：
  1. **代际守卫**：indexsvc 新增快照代际计数（每次落盘自增）；`getCandidatePool` 构建前后对账——池若是在索引重建中途读出的（混合新旧快照=部分数据）自动重试到稳定快照。v1.4.6 只清了缓存，但「清缓存→构建中池仍把部分结果写回缓存」的窗口仍在，此为根因修复。
  2. **会话自愈**：`invalidatePools` 同时标记活跃会话过期（poolBuiltAt 时间戳），`/api/roaming/session` 视图发现过期会话自动按当前 filter 重载——不再依赖用户切标签才看到 1/58；重启续读的空池会话也改为视图前等待建好（不再闪 0/0）。
- **阅读窗口点击无反应（真机诊断）**：实测渲染主线程假死——HTTP/WS 通道正常但 `Runtime.evaluate`/`Page.enable` 全部超时（连 DevTools agent 都不执行），窗口对一切点击无响应。v1.7.0 移除持久附着后失去了「DevTools 在场→页面不冻结」的副作用，页面被遮挡/后台约 5 分钟即可能被冻结或假死。三层处置：
  1. **防冻结启动参数**：`--disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding`（阅读窗口常驻活跃，禁止一切后台节流/冻结）；
  2. **渲染 watchdog**：每 20s 极轻探针（evaluate `1`），连续 2 次无响应 → 判定主线程假死 → 自动关页并由既有实例重开（≤40s 自愈，日志可见「自愈重开/自愈完成」）——即便根因在微信读书页面自身也能恢复；
  3. 有/无注入脚本的头less长跑 A/B 对照在跑（定位注入脚本是否参与诱因）。
- smoke 176 全绿（+5：代际守卫重试、会话过期标记/自愈、watchdog 自愈）。需 ⌘Q 完全重启 DSH 生效（重启会顺带关掉当前假死窗口）。

## 1.7.2（2026-11-07）

- **修复对账行叠印（1.7.1 引入）**：根因是 `.wr-set-label` 固定 110px，加 nowrap 后长内容溢出与右侧状态文字重叠。本行放开标签宽度（`width:auto`）+ 整段不折行；行内放不下时整段换行（行本身 flex-wrap）。
- **翻书动画方向（用户指定）**：改为右侧书页向左连翻——`rotateY(0 → -360deg)` 线性循环（绕书脊，一周两次翻页）。
- 纯 Client 改动，⌘R 刷新即生效。

## 1.7.1（2026-11-07）

- **阅读悬浮入口（dock）**：icon 颜色改为 `rgb(52,167,255)`（用户指定）；点击打开阅读窗口期间 icon 播放翻书动画（rotateY 翻页循环 + 3D 透视），打开完成即停。
- **设置页官方通道卡**：「同步对账（2026/11/7 19:13）」整段不折行（label 与时间戳均 `white-space:nowrap`）。
- 纯 Client 改动，⌘R 刷新即生效（Host 无变化；若一并重启亦无妨）。

## 1.7.0（2026-11-07）

用户反馈两项（点击仍延迟 + 退出 DSH 不关窗），触发架构级修复。

- **点击延迟根治：彻底去掉持久 CDP 会话**。真机测量定位：程序化点击即时生效、合成输入完全无效——页面在「被 DevTools 附着检视」状态下输入/主线程被拖慢（1.6.x 为维持工具条注册保持了带 `Page.enable` 的长连会话）。曾尝试 Chrome 扩展注入（`--load-extension` + MV3 content script，零附着最优解），实测被 Google Chrome 稳定版 137+ 拒绝（日志："--disable-extensions-except is not allowed in Google Chrome"）。最终方案 = **注入守护**：
  - 常态仅 `/json/list` 纯 HTTP 轮询（1.5s，零 WebSocket、零域启用、零注册）；
  - 检测到窗口 URL 变化（新文档）→ 短连一次 `Runtime.evaluate` 注入工具条+护甲脚本（含 DOM 就绪等待），之后由页面内 3s 自愈维持；
  - 打开书时立即注入一针（首屏不等轮询周期）；全程不再 attach 任何域（`Page.enable`/`Network.enable`/`addScriptToEvaluateOnNewDocument` 全部退役）。
- **退出 DSH 关闭阅读窗口（用户需求）**：dispose 时先记一次窗口位置，`Browser.close` 关窗，残留进程 SIGTERM 兜底；bounds/注入守护定时器随卸载清理。
- **修复 chrome:// 内部目标误判**：`omnibox-popup` 等 Chrome 内部页在 /json/list 中也是 page 类型，此前被当「多余窗口」反复收敛关闭、并干扰单例判定；现在 probe/收敛全程过滤 `chrome://`。
- 真机验证：导航后守护自动补注入 ✓、dispose 实例退出 ✓；smoke 171 全绿（扩至注入守护/零附着/chrome:// 过滤用例）。需 ⌘Q 完全重启 DSH 生效。

## 1.6.3（2026-11-07）

- **修复「工具条点击后响应延迟严重」（安静附着）**：v1.6.2 的持久会话启用了 `Network.enable`——它把整页网络挂上调试插桩，微信读书的 Service Worker 在被调试态下导航被拖慢（刷新/回首页这类完整导航首当其冲）。改为**安静附着**：
  - 去掉 `Network.enable`（真 Chrome 实测 `Network.getCookies/setCookie` 无需它即可用，Cookie 注入不受影响）；
  - 保留 `Page.enable`（实测它是 `addScriptToEvaluateOnNewDocument` 真正执行的前提，不能去）；
  - 工具条去掉 `backdrop-filter` 毛玻璃（常驻 GPU 开销，换纯色底），阴影减档。
- smoke +1 断言（170 全绿：不得出现 Network.enable）。需 ⌘Q 完全重启 DSH 生效；若刷新/回首页仍有可感延迟而后退/前进正常，请反馈（那就是 Service Worker 启动等待，另有对策）。

## 1.6.2（2026-11-07）

- **修复「工具条闪一下就没」（两个叠加根因，均已在真 Chrome 定位复现）**：
  1. **短连注册失效**：`Page.addScriptToEvaluateOnNewDocument` 的注册随 CDP 会话存活，旧实现发完命令即断连 → 注册被清除；「闪一下」来自 `Runtime.evaluate` 在当前页的立即补跑，下一次导航即消失。修复：对页面 target 维持**一条长连会话**（导航不换 target，注册持续生效；断开/换窗口自动重连，建连失败降级旧短连路径不阻断打开）。实测对照：断开会话后导航，工具条即不再出现（根因实锤）。
  2. **document-start 挂载落空**：注册脚本在文档创建瞬间执行，此时 DOM 未解析（documentElement 为空），挂载被 try/catch 静默吞掉。修复：注入函数内置 `readyState === 'loading'` 判断，等 `DOMContentLoaded` 后重试；自愈定时器改为单次注册（`__wrBarTimer` 守卫）。
  - 附带：换书导航保留「同 URL 不重载」（保滚动位置）；dispose 同时关闭长连。
  - 已知边界：DSH 退出后长连断开，窗口内**下一次导航**起工具条不再出现（当前页不受影响）；重开 DSH 后点开书即恢复。
- smoke +2 断言（169 全绿：长连只建一条、DOM 就绪守卫）。
- 需 ⌘Q 完全重启 DSH 生效。

## 1.6.1（2026-11-07）

- **工具条改为贴顶右上角（用户指定位置）**：用户希望放到窗口标题栏位置——macOS 原生标题栏属 Chrome 原生 UI，插件无法置入；等效实现：默认**紧贴标题栏正下方、与窗口顶边齐平的右上角**（顶部方角、底部圆角，形如标题栏延伸）。仍是可拖拽 + 位置记忆；若与微信读书自家页头控件重叠，拖开即可。
- smoke +1 断言（167 全绿）。需 ⌘Q 完全重启 DSH 生效。

## 1.6.0（2026-11-07）

- **阅读窗口迷你顶栏（用户需求，对标 WebBar 工具栏）**：窗口内注入可拖拽的小工具条——**后退 / 前进 / 刷新 / 回微信读书首页**四个按钮。
  - 实现经既有引导脚本通道（`Page.addScriptToEvaluateOnNewDocument`，随 window.close 护甲一并下发）+ `Runtime.evaluate` 立即补跑——当前已加载页首屏即见，其后每个新文档自动生效；
  - 动作全在页面内完成（`history.back()/forward()`、`location.reload()`、跳 `#home`），零 CDP 往返；仅作用于 weread.qq.com 域，其余页面零注入；
  - 可拖拽任意放置（默认右上角），位置记忆在专用 profile 的 localStorage；SPA 重渲染移出 DOM 时 3s 自愈补回；整段脚本 try/catch 包裹 + smoke 语法编译守卫，坏也不影响页面本身；
  - 键盘党：Chrome 原生 ⌘[ / ⌘] / ⌘R 同样可用。
- smoke +2 断言（166 全绿：readerbar 注入标记 ×2 通道 + 动作存在性）。需 ⌘Q 完全重启 DSH 生效。

## 1.5.4（2026-11-07）

- **修复「位置大小没记住」（1.5.3 实测缺陷）**：宿主日志实证 capture/restore 都在工作，但捕获只发生在「点开书/点关闭按钮」两个瞬间——用户调整窗口在**阅读期间**、关窗走红色关闭钮，调整结果从未被捕获，下次还原的自然是启动默认值（1240×900）。
  - **bounds 守护**：窗口存活期间每 5s 经 CDP 轮询窗口位置大小，**变化才写盘**；窗口/实例关闭则保留最后记忆。调整后 ≤5s 内即持久化，与关窗方式无关。
  - 定时器 `unref` + 随插件 `dispose` 清理；diagnose/capture 兜底逻辑保留。
  - smoke +1 断言（164 全绿：模拟阅读中调整窗口、无任何后续操作，守护自动记忆）。
- 需 ⌘Q 完全重启 DSH 生效。

## 1.5.3（2026-11-07）

- **阅读窗口记住位置和大小（用户需求）**：不依赖 Chrome 自身记忆，插件经 CDP 自管——
  - **捕获**：每次打开（复用/新开路径）与「关闭阅读窗口」时，`Browser.getWindowForTarget` 读取当前 bounds 存入 `reader-window.json`（含 windowState，最大化/全屏也记）；
  - **还原**：实例死透后重新拉起时，先 `Browser.setWindowBounds` 还原记忆的位置大小再置前；
  - **修复覆盖问题**：原来每次拉起都传 `--window-size=1240,900`（即便 Chrome 记住了也会被覆盖）——现仅首次（无记忆 bounds 时）作默认尺寸，之后不再传；
  - diagnose 返回 `bounds`（设置页检测可直接核对）；多屏拔掉显示器导致坐标出界的场景依赖 macOS 对离屏窗口的自动回收（窗口仍可拖回）。
- smoke +3 断言（163 全绿：bounds 捕获/还原/不再传 --window-size）。需 ⌘Q 完全重启 DSH 生效。

## 1.5.2（2026-11-07）

用户反馈三项。

- **设置卡文案**：移除「参考 WebBar 的单窗口容器」实现细节（×3 语），注入描述同步改为「失效时补入」。
- **登录态持久化增强**：Cookie 注入条件从「窗口无任何 weread Cookie」升级为「窗口 wr_skey 缺失或已过期」——窗内扫码得到的有效会话永不被旧凭据覆盖；skey 过期而插件侧有较新凭据（用户重登过插件）时**自动复活，免扫码**。日志区分「首次注入/失效重注入/会话有效跳过」。
- **修复日志面板默认频道 bug**：下拉默认值 `toggle` 并非真实频道（实为 op/roaming/dedupe/cleanup 四频道），导致默认打开永远「暂无数据」；默认改 `op`（操作频道，open-reader/同步等都在此），并注：日志为内存环形缓冲（每频道 400 行），**⌘Q 重启后清零**。
- smoke 更新 +1 断言（162 全绿：在期跳过 / 过期重注入两分支）；需再次 ⌘Q 完全重启 DSH 生效。

## 1.5.1（2026-11-07）

- **修复「打开书籍提示 chromeExecutable is not a function」**：v1.5.0 把默认 Chrome 路径解析误写成 IIFE——模块初始化即执行，`chromeExecutable` 变量成了**字符串**而非函数；smoke 全部注入了假实现所以没暴露（DI 测试盲区）。改为惰性函数（`deps.chromeExecutable` 注入优先，默认按平台路径探测）。smoke 补回归：不注入 `chromeExecutable` 时断言 `_internal.chromeExecutable` 是函数且 `open()` 默认路径全链路无异常（+2 断言，158 全绿）。**需再次 ⌘Q 完全重启 DSH 生效。**

## 1.5.0（2026-11-07）

打开书籍改为 **WebBar 式单例窗口**（用户需求：单例窗口、不开多窗、不用默认浏览器）。

- **机制迁移**（参考 `~/Documents/Cursor/Fanfou/apps/WebBar`：唯一 NSPanel 一次创建、`show()` 永远复用同一实例、内容窗口内导航）：
  - 窗口体 = Chrome app-mode 窗口 + **专用 `--user-data-dir`**（`~/.dsh/weread/reader-profile`，登录态/窗口位置持久，等价 WebBar 持久 WKWebsiteDataStore）；
  - 单例复用 = **CDP**（`--remote-debugging-port`，仅 127.0.0.1）：窗口已在 → `Page.navigate` 原窗口导航 + `Page.bringToFront`（等价 WebBar 复用同一 panel）；窗口被关 → 同 profile 再拉一次自动开回（Chrome 单实例转发）；每次打开后收敛到 ≤1 个页面目标（多出的窗口直接关）；
  - **绝不开第二个窗口、绝不落默认浏览器**：Chrome 缺失时报错引导；拉起彻底失败的唯一兜底是 v1.4.9 的「Chrome 同窗口页签」，永不 `open <url>`。
- **登录态自动注入**：profile 内无 weread Cookie 时，把插件已存账号 Cookie（wr_vid/wr_skey 等）经 `Network.setCookie` 注入；已有（窗口内扫码过）则不动，避免旧凭据覆盖新会话。
- **反关闭护甲**：`Page.addScriptToEvaluateOnNewDocument` 置空 `window.close`——app 窗口无浏览历史、页面脚本可直接关窗（微信读书反 SSB），先堵住；不影响用户 ⌘W 关窗。
- **环境实测教训**（本版开发中验证）：DSH 工具沙箱内直接 spawn 的有头 Chrome 因沙箱嵌套 SIGTRAP 崩溃、`open -na --args` 在 macOS 26 会丢参数——真实拉起必须在插件宿主进程（tier 1 直接 spawn）或 LaunchServices（tier 2）上下文；`lib/readerWindow.js` 按此分层并自带端口冲突/僵尸实例清理。CDP 客户端逻辑已对真 Chrome 147 实测通过（探测/护甲/Cookie 注入/导航/置前/关闭）。
- **Host**：`/api/open-reader` 换用新管理器；新增 `GET /api/open-reader/diagnose`、`POST /api/open-reader/close`；openapi 登记。**本版 Host 改动需 ⌘Q 完全重启 DSH 生效**，之后可用 `node tools/reader-window-live.mjs`（终端跑）或设置页「检测阅读窗口」做真机自检。
- **Client**：三处入口（发现/详情/dock）toast 统一走 `W.readerToast`（reader-window/chrome-tab 兜底/报错三分支）；设置页卡片改「单例阅读窗口」+ 检测/关闭按钮与状态行；清理 v1.4.5-1.4.8 遗留的 AppleScript 授权文案键 ×3 语。
- smoke +21 断言（156 全绿）：tier1 拉起参数、护甲/注入/跳过注入、换书复用导航、关窗重开、多窗收敛、僵尸清理、兜底页签、无 Chrome 报错、域名守卫。

## 1.4.9（2026-11-07）

App 窗口阅读机制定稿：**免权限的单窗口页签模式**。

- **四轮 AppleScript 实测的最终结论**：用户系统授权开关已 ON，插件侧 AppleScript 仍秒级超时且 stderr 为空（SIGTERM 无错误码）——执行 osascript 的发送方（插件宿主进程）与 TCC 授权主体（DeepSeek Harness 主 App）不一致，系统授权页无法为该发送方补授权，此路在当前进程模型下不可靠。**彻底放弃 AppleScript 导航**（连同 probe/open-auth-settings 端点与授权引导卡全部移除）。
- **主机制 = `open -a "Google Chrome" <url>`**：同一个 Chrome 窗口内新开页签——零权限依赖、永可用、窗口永不重复；无 Chrome/非 mac 才落默认浏览器。设置页卡片改为「✓ 免授权·单窗口页签模式已启用」+ 使用说明（页签会累积，读后随手关）。
- **修复详情页旧 toast**：v1.4.4 后详情页按钮的提示分支漏改，chrome-tab 模式被误报为「已在浏览器打开」（用户看到的错误提示来源）；三处入口（发现/详情/dock）文案统一为「已在 Chrome 窗口新页签打开」。

## 1.4.8（2026-11-07）

- **修复「已授权仍失败 → 死路引导」**：用户系统设置中 DSH→Chrome 开关已 ON，但插件侧 AppleScript 仍失败且日志显示**秒败（非超时）**——高度怀疑 osascript 执行进程与 TCC 授权主体不一致。处置：
  - **失败不再堵死**：任何 AppleScript 失败（未授权/曾被拒/主体不一致）→ 降级 `open -a "Google Chrome" <url>`（**同窗口新页签**，无权限依赖、窗口永不重复），并正常打开书籍（用户要求）；
  - **诊断信息全量暴露**：完整 stderr 压平后落日志与 prefs，设置页「App 窗口阅读」卡在未授权态显示**错误详情**（等宽小字）——用于下一轮定位主体问题；
  - toast 明确当前模式：「已在 Chrome 窗口新页签打开 · 同窗自动导航需授权」。
- 优先级顺序：AppleScript 同窗导航（授权且主体匹配时最佳）→ 同窗新页签（保底，永不引导死路）→ 默认浏览器（仅无 Chrome/非 mac）。

## 1.4.7（2026-11-07）

- **修复 v1.4.5 回归「打开书籍落默认浏览器且连开多页签」**：授权弹窗挂起时 osascript 15s 超时被「其他 AppleScript 异常」分支静默降级 `open <url>`（默认浏览器），每次点击一个新页签。重构判定：**macOS+Chrome 路径下任何 AppleScript 失败（未授权/曾被拒/弹窗超时未答）一律返回 `needAuth` 走设置页引导，绝不静默开浏览器**；浏览器兜底仅保留给无 Chrome/非 mac。单发导航脚本（20s 容弹窗作答），取消前置 probe 双跳；探测端点（设置页「检测授权」）改 6s 短超时，超时同样计为未授权。

## 1.4.6（2026-11-07）

- **修复漫游进度环偶发「1/1 → 切标签才变 1/58」**：根因是漫游池的 TTL 缓存与索引重建脱节——池若在**索引部分重建的瞬间**（同步写盘/启动竞态）构建，只看到当时已落盘的少数笔记（如 1 条）并按 filter 键缓存钉死；切筛选标签换了 cacheKey 才重建出真实规模。修复两层：①`reloadSession` 强制清池缓存（重载必新鲜）；②索引服务新增 `onRebuilt` 钩子——**内容确实变化的重建**自动触发 `roaming.invalidatePools()`，同步收尾、fs.watch、切号等所有重建路径全覆盖。smoke 复现原症状（1 条瞬间建池=1）并断言修复后同 filter 重载=真实规模（138 断言，+3）。

## 1.4.5（2026-11-07）

单例复用机制重构 + 完整授权引导（用户实测两轮失效后的根因版）。

- **根因一（app-mode 窗口不可枚举）**：Host 日志实证三次均走"新建窗口"分支——`--app` 创建的 app-mode 窗口**不在 Chrome AppleScript 的 windows 枚举里**，查找永远落空。**弃用 `--app`**，改 AppleScript 全托管普通窗口：`make new window` 创建（可枚举）、已有 weread 窗口则导航+置前——单例由机制保证。
- **根因二（授权识别永不命中）**：AppleScript 的权限错误号（-10004）在 **stderr**，execFile 的 `err.code` 只有退出码——旧的 `ERR:-10004` 匹配永远不中。现捕获 stderr 判别（-10004/-1743/权限）。
- **未授权不再静默开窗**：探测到未授权时返回 `needAuth`（不自动新窗），client toast 引导并**自动跳转设置页**。
- **设置页新增「App 窗口阅读」引导卡**：授权状态徽标（已授权=绿「多入口共用一个窗口」/未授权=琥珀/未检测=灰）、「检测授权」按钮（`/api/open-reader/probe` 实测）、「打开系统授权设置」按钮（直开 系统设置→隐私与安全性→自动化）+ 四步图文说明（含"首次点书也会弹授权框，点允许即可"提示）。授权状态经 stateView（`appWindowAuth`）持久展示。
- 字典 +9 键 ×3；135 断言全绿。

## 1.4.4（2026-11-07）

实测驱动的三处修复。

- **修复详情 404（路由按 id 形态分发）**：curl 实测 `web/bookDetail/<hash>` 200、`web/bookDetail/<数字id>` **404**——上版对全部 id 用该路由是错的。现 Host 统一计算 `detailUrl`：hash 型（≥20 位十六进制）→ 详情路由；数字/混合型 → `buildPcUrl` 阅读页（站内可跳转）。搜索与推荐的 `detailUrl` 均由 Host 补全，client 不再猜路由。
- **修复 App 窗口单例失效（权限根因）**：AppleScript 控制 Chrome 需 macOS 自动化授权——沙盒实测「权限违例 -10004」；Host 首用时会弹授权框，但旧实现 5s 超时在用户点击前静默放弃 → 永远新开窗口。现超时放宽 15s 给用户授权时间，权限违例时 toast 引导（系统设置→隐私与安全性→自动化→允许控制 Google Chrome）并降级新窗口。
- **推荐按钮显示条件放宽**：`detailUrl || readerLink` 任一存在即显示（两者均由 Host 补全——**本版 Host 改动需 ⌘Q 完全重启生效**，上版只 ⌘R 也会导致按钮不显示）。
- 字典 +1 键 ×3（needAuthTip）；135 断言全绿。

## 1.4.3（2026-11-07）

- **悬浮入口换微信读书品牌 icon**：dock 图标改用插件同款「翻开的书」标识（`W.I.weread`，fill currentColor）；**无书可开时点击打开微信读书首页**（App 窗口，站内可任意跳转），不再提示无书。
- **发现页入口收敛（用户反馈三项）**：
  - 移除与「打开阅读」重复的「App 窗口阅读」——保留「打开阅读」（本就走 App 窗口单例）
  - 「详情」改为**站内详情路由** `web/bookDetail/<id>`（App 窗口内可继续跳转书城/阅读器，替代孤立 H5 `book-detail?type=1`）
  - **修复推荐列表按钮不显示**：实测官方 recommend 回包**没有 readerLink 字段**——Host 侧代理时用 `buildPcUrl`（与本地书同算法）为每本补全阅读链接；搜索结果个别缺链条目同样补全。
- 字典 +1 键 ×3（viewDetailAppTip）、dockTip 更新；135 断言全绿。

## 1.4.2（2026-11-07）

App 阅读入口全面铺开 + 细节打磨（用户四项）。

- **常驻悬浮 App 阅读入口**：面板右下角圆形悬浮按钮（📚 SVG），**可拖拽**（Pointer Events + 视口夹取，位置持久化 localStorage）；点击 = App 窗口打开「最近阅读」——优先上次 open-reader 的 URL，兜底书架最新有 pcUrl 的书；拖动与点击按位移自动区分。
- **发现页操作行重排（用户指定）**：「App 窗口阅读」移到最左（新增 `W.I.window` SVG 图标），三个入口（App 窗口阅读/打开阅读/详情）同字号同样式；**「打开阅读」与「详情」改为直接走 App 窗口**（open-reader 单例复用导航），不再跳默认浏览器。
- **推荐列表右侧 App 阅读入口**：「为你推荐」每条右侧窗口图标按钮，一键 App 窗口打开该书。
- **漫游进度环缩小**：36px → 20px（r15→8、描边 3→2.5），与顶栏行高协调。
- 字典 +3 键 ×3 语（openReaderAppTip/dockTip/dockNoBook）；135 断言全绿。

## 1.4.1（2026-11-07）

- **导图按钮**：📷 emoji 换为 SVG 相机图标（stroke currentColor 随主题变色），旁附「导图」文字，hover 提示完整说明。
- **详情页导图弹窗与漫游完全同构**：重写 `W.NoteExportModal`——同一布局骨架（maxWidth 700 / 左预览右设置栏 / 主题色板 div 同款 boxShadow 与 title / 时间单选 radio / 底部 确认导出·复制图片·取消 竖排），复用漫游全部文案键（exportModalTitle/copyImageBtn/copyImageTip 等），行为一致（点遮罩自关、复制后可粘贴进对话发图）。
- **App 窗口单例复用（用户需求）**：`open-reader` 先经 AppleScript 查找已有微信读书窗口（active tab URL 前缀匹配）——找到则**导航并置前**（不再开新窗口）；找不到才 `--app` 新建。Toast 区分「已在 App 窗口打开」。

## 1.4.0（2026-11-07）

阅读方案重启探索（WebBar 机制迁移）+ 详情页导图。

- **「App 窗口阅读」上线（风控边界的精确定位）**：用户提供的 WebBar（macOS 菜单栏 app）实测打开微信读书**无风控**——分析其源码：WKWebView **顶层浏览上下文**，无 iframe 嵌入特征；对照此前 iframe 实验被警告，结论=**风控检测的是「嵌入」而非「第三方窗口」**。等价迁移：Host 侧 `open -na "Google Chrome" --args --app=<readerLink>`（Chrome 独立无地址栏窗口，同机制顶层上下文）；无 Chrome 回落默认浏览器。入口：发现页结果卡 + 详情页工具栏「🪟 App 窗口阅读」（域名白名单校验仅 weread.qq.com）。
- **后续提案（未实施）**：给 WebBar 注册 `webbar://` URL scheme，插件优先调起——已验证容器、体验最连贯，改动在 WebBar 仓库，待用户拍板（analysis-05 §2）。
- **详情页逐条导图（用户需求）**：漫游导图能力抽为可复用 `W.NoteExportModal`（八主题/笔记时间 vs 当前时间/下载 PNG/复制到剪贴板，与漫游同款 Canvas 卡片）；详情页每条笔记时间行新增「📷」按钮直接生成分享卡片图；主题列表经 App state 传入。
- 漫游侧 `rmFmtExportDateParts` 暴露到 W；字典 +8 键 ×3 语；135 断言全绿。

## 1.3.3（2026-11-07）

- **撤下面板内阅读 iframe 实验（真机风控实测）**：v1.3.2 的实验入口真机打开即触发官方风控弹窗「请勿使用第三方插件——账户信息泄露/被盗、账号封禁风险」。账号安全为插件红线（同「笔记写回不做」），移除「面板内打开」入口与覆盖层，维持系统浏览器外链（第一方上下文无警告）。插件内阅读就此定案：不做（[analysis-05](../docs/analysis-05-in-plugin-reading.md) 已更新「响应头放行 ≠ 产品允许」的完整结论）。
- **多选标记美化（用户反馈：与竖线重叠）**：选择控件改为标准圆形勾选框（14px、1.5px 描边、选中=品牌色底+白色 ✓、悬停微放大），与笔记竖线保持 10px 间距；定位在竖线左侧垂直居中，仍零位移零遮挡。

## 1.3.2（2026-11-07）

- **多选标记定位（用户指定）**：「● 已选」改到笔记卡片**竖线左侧垂直居中**的纯 CSS 圆点（选中=品牌色实心、未选=灰空心）——不进文档流（进出多选模式零位移）、不遮正文、不与首行重叠。悬停圆点显示已选/未选中提示。
- **发现 tab 无 Key 隐藏（用户拍板）**：未绑 API Key 时整个「发现」页签不显示（书城搜索/推荐无 cookie 通道接口，引导卡方案废弃）；解绑后若停留在发现页自动回落书架。
- **iframe 阅读实验上线（用户要求）**：curl 实测官方阅读页响应头**无 X-Frame-Options、CSP 无 frame-ancestors**（不禁止嵌入）→ 发现页结果卡新增「**面板内打开**」：全面板 iframe 覆盖层（标题栏含「在浏览器打开」与关闭），顶部注明实验特性——iframe 内登录态与浏览器隔离，首次需在框内扫码。若实测内容可正常渲染，这将是插件内阅读的正式形态。
- 字典 +5 键 ×3 语；135 断言全绿。

## 1.3.1（2026-11-07）

细节打磨轮（用户四项反馈）。

- **登录弹层图例重排**：图例移到标题右侧（「登录微信读书 …… ●有效 ●已过期 ●未配置 ✕」），圆点用 CSS 着色（绿/琥珀/灰）而非文本符号；chips 下方 hover 行默认文案简化为「悬停查看各通道状态」。
- **修复多选标记遮挡正文**：详情页摘录多选的「● 已选」标记原为右上角 `position:absolute`，与引用正文首行重叠（截图实证）；改为静态独立行（选中态加粗），永不遮挡。
- **发现页无 Key 行为澄清**：书城搜索/推荐仅有官方网关接口（cookie 通道无对应能力），未绑定时显示引导卡片，文案补充「绑定不影响现有登录，随时可解绑」。
- **新增分析文档**：[插件内直接阅读可行性](../docs/analysis-05-in-plugin-reading.md)——官方网关无正文接口，原生阅读不可行（roadmap 亦明确不做）；iframe 嵌官方网页阅读器预期被 X-Frame-Options 拒（可半小时实测定案）；务实闭环 = 深链 + 进度回读（已具备），「稍后读/继续读置顶」列入 v1.4 候选。
- 字典：图例拆键（hint + 三色标签）×3、发现页引导文案补句 ×3。

## 1.3.0（2026-11-07）

v1.2 剩余 + v1.3 发现全量落地（roadmap §8A 收官版本）。

- **官方阅读统计（洞察页）**：`/readdata/detail` 接入——洞察顶部新增「官方阅读统计」区：本周/本月切换、四指标（总时长/有效天数/日均/环比↑↓）、读得最多 Top3、偏好分类 chips；未绑 Key 显示引导绑定。
- **精确阅读进度（详情页）**：`/book/getprogress`——书籍头部新增「🕐 进度% · 累计分钟」胶囊（悬停显示最近阅读/读完时间），服务端真实数据取代书架粗略百分比。
- **热门划线（详情页）**：`/book/bestbookmarks`——章节笔记下方新增可折叠「🔥 热门划线」区（Top20，含划线人数与章节归属）。
- **「发现」tab（面板第五页签）**：书城搜索（六 scope：找书/全部/听书/作者/全文/公众号）+ 编号结果卡（书名/作者/⭐评分/在读人数/分类/简介/打开阅读直达链接）+ 翻页；「为你推荐」列表 + 换一批；未绑 Key 引导卡。
- **网关封装 ×7**：`readdata / bookProgress / storeSearch / recommend / similarBooks / publicReviews（双层 review 拍平）/ bestBookmarks`（similar 按官方硬性要求显式 count/maxIdx）。
- **HTTP 端点 ×7 + Agent 工具 ×3**：`/api/gateway/stats|progress|search|recommend|similar|reviews|bestbookmarks`；`weread` 工具新增 **stats / store / recommend** 动作（未绑 Key 均给中文引导语）；openapi.json 全量登记。
- 字典 +35 键 ×3 语（发现/统计 30 + 详情页 5）；smoke 135 断言（+12：七封装契约、路由 400 守卫、工具引导语）；rmsmoke +6 组（Discover/OfficialStats 各态渲染）。
- 协作：发现/统计 UI 由 teammate（discover-ui）按契约并行交付，build.mjs 仅登记新 part 一行（已 review）。

## 1.2.6（2026-11-07）

- **登录 chip 内边距**：`.wr-login-tab` 横向 padding 0→10px（文本贴边框，用户反馈）。
- **hover 详情行**：chip 悬停改弹层内固定高度详情行（原生 title 有 ~1s 延迟且无样式，观感像「没显示」）；默认显示图例（●绿=有效/●琥珀=已过期/●灰=未配置）；字典 +channelLegend ×3。

## 1.2.5（2026-11-07）

- **「已配置（未复核）」状态消解**：原语义=本地存有凭据但近 24h 未向服务端核实。现打开登录弹层即自动调 `POST /api/login/verify`（服务端 `verifyNow` 实时核验 cookie 与网关 Key），一秒内把状态落定为 **有效 / 已过期 / 未配置**；核验期间 hover 显示「校验中…」。核验失败的兜底文案改为「已配置（自动核验未完成）」。
- **弹层排版与样式（用户要求）**：
  - 状态点从 chip 开头移到**名称尾部**——放开头的圆点会被误读为「单选选中指示」（与选中态的边框高亮撞语义）；统一实心点、颜色即语义（绿/琥珀/灰），核验中带呼吸动画
  - 「打开官网获取 Key」链接与「更新 Key/提交」按钮**同行**（左链接右主按钮），不再竖排
  - 已绑定状态改为浅绿高亮条；说明文字行距收紧
- 修复 v1.2.4 的漏改：扫码/粘贴 Cookie 两枚 chip 的内联状态文字未被正则命中（截图证实仍在），本次整块重写彻底移除。
- 字典 +1 键 ×3 语、措辞修正 ×3；123 断言全绿。

## 1.2.4（2026-11-07）

- **登录弹层状态条简化（用户要求）**：通道 chip 仅显示「颜色圆点 + 通道名」，状态说明（已绑定尾号/有效/过期/未配置、最近校验时间、凭据共用提示）全部移入 hover 提示。
- **书架账号下拉菜单（用户要求）**：工具栏的裸账号 `<select>` 升级为下拉菜单——当前账号名按钮 ▾ → 菜单含：账号列表（点击切换，活跃账号标注）、**登录账号**（打开登录弹层）、**退出账号**（`POST /api/logout`，清 cookie+API Key，toast 确认后刷新书架与状态）。点击外部自动收起；danger 色标退出项。
- 字典 +4 键 ×3 语（menuLogin/menuLogout/loggedOutToast/logoutFailed）；rmsmoke 补账号下拉入口断言。

## 1.2.3（2026-11-07）

- **登录弹层通道状态条（用户需求）**：弹窗顶部一排三个可点 chip（即 tab），实时显示各登录方式有效状态——
  - API Key（官方）：`已绑定 ····尾号（有效/待复核）` / `未配置`（悬停显示最近校验时间）
  - 扫码登录 / 粘贴 Cookie：`Cookie 有效` / `Cookie 已过期` / `已配置（未复核）` / `未配置`（两者是同一份凭据，状态共用，悬停有说明）
  - 状态点颜色语义：绿=有效、琥珀=过期、灰=未配置；打开弹层即拉取最新状态
- 后端配套：`/api/state` 新增 `loginChannels`（cookie present/valid/expired + apiKey bound/keyTail/valid + 最近校验时间；valid 依据 `getLastRawCheck` 的 ok/via 判定，Key 营救场景 cookie 正确标为过期）。
- 字典补 8 键 ×3 语；rmsmoke 渲染文本收集器支持 props.label；新增通道状态两组渲染断言。

## 1.2.2（2026-11-07）

真机收官轮：**对账全绿（25/25 一致，用户确认）**；修两项反馈。

- **修复侧栏插件名漏出字面 `panel.title`**：v1.2.1 的 `locale.bind` 翻译在纯嵌套注册下查不到键（miss 时返回键名本身）→ 侧栏显示 `panel.title`。修复：字典同时注册嵌套 `{panel:{title}}` 与扁平 `'panel.title'` 双形状；label 加防漏兜底（翻译结果等于键名时回退 `W.t.panel`），任何路径都不再漏出字面量。
- **登录弹层默认选中 API Key（补漏）**：v1.2.1 只改了 LoginModal 内部默认值，书架事件层（无 `detail.tab` 的派发与挂载消费两条路径）仍显式置「扫码」→ 设置页入口进弹层还是扫码页。三条默认值路径统一为 API Key（官方）。
- roadmap：v1.1 真机验收最后一项（对账一致）达成。

## 1.2.1（2026-11-07）

真机反馈三项修复（同步成功后的收尾轮）。

- **修复「深响 2/11」类残缺同步（网关兜底没接住的盲区）**：api.js 的 `getBookNotes` 双地址兜底会吞掉鉴权失败——死 cookie 下 web 端点返回 200+残数据（深响只回 1 条，既不抛错也不完整），错误触发式的网关兜底根本不会被唤醒。改为 **Key 在场时划线直接网关优先**（官方 `/book/bookmarklist`），cookie 降为兜底；双通道皆败才上抛。修复 getBookNotesWithCache 中网关失败+cookie 失败路径会静默缓存空数据的死分支。
- **修复对账数字「轮转错位」（0↔3 换着来）**：同步尾段旧序是「建索引 → 清理（改名/迁移文件）→ 对账」——对账按清理前的陈旧文件路径解析，数字张冠李戴。改为 **清理 → 索引重建 → 聚合 → 对账**，对账永远读终态。真机核验：MP 三兄弟文件内容实为 3/2/2 与服务端一致，本轮同步后对账应仅剩真差异。
- **登录弹层 UX（用户三项要求）**：①API Key（官方）tab **移到最左且默认选中**；②已绑定时弹层显示绑定态（尾号），并从本机同源端点（`GET /api/gateway/key`）**预填持久化的 Key**——不用再去官网复制，提交即更新（按钮变「更新 Key」）；③三语字典补 `apiKeyUpdate`/`apiKeyBoundState`。
- **侧栏插件名语言切换提速**：侧栏 label 改走 `ctx.locale.bind(NS)` 的翻译函数——随 DSH 应用语言即时重解析；旧实现读我们自己的 `W.t`（受 5s 状态轮询节流）→ 切语言有可感延迟。
- smoke 123 断言维持全绿（网关优先路径由既有兜底用例覆盖）。

## 1.2.0（2026-11-07）

网关升级为**全通道数据兜底**（真机闸门通过后提前完成 v1.2 核心），修复四项用户反馈。

- **修复「cookie 过期 → 同步整体失败」（1/2/4 三项反馈的共同根因）**：用户 cookie 被风控过期后，同步主管线（书架/划线）仍走 cookie → 每本书 3 次重试超时拖足数分钟才报「登录已过期」（表现为"一直同步中"），且用户误以为 API Key 没存住（Key 实际一直在且有效，日志显示当日三次重复绑定）。现 cookie 失败/缺失而 Key 在场时自动切换：书架→官方 `/user/notebooks`、划线→官方 `/book/bookmarklist`（官方回包 `chapters[]` 章节名按 uid 回填进 `updated[]`）。`verifyNow` 补 Key 营救：cookie 判无效但 Key 有效 → 保持登录（同步入口不再被死 cookie 拦截）。
- **全局同步状态条（修「切菜单影响同步」的感知面）**：Host 同步本就与面板无关，但进度只显示在书架页，切走即"消失"。现 tabs 下方常驻状态条：同步中（书名+百分比）/ 失败（错误摘要），任何页签可见。
- **修复 DSH 侧栏插件名不随语言切换**：DSH 经 locale 服务按 `panel.title` **点路径**解析侧栏/面板名（截图里别家插件露出字面 `panel.title` 即此机制的 miss），我们注册的是扁平 `{panel}` → 永远回退中文。改嵌套 `{panel:{title}}` 三语注册；`locale/*.json` 补 `panel` 节并新增 `zh-TW.json`（清单层：标题/描述繁体）。
- smoke 123 断言（+4）：cookie 全挂→网关兜底同步落盘（含章节名回填）、verifyNow Key 营救。
- 说明：API Key 本就持久化（secrets.json 0600 + Keychain 镜像 + 启动补水，重启不丢）；本次修的是「同步不使用它」。Key 失效场景（网关 401）在连通性测试/登录路径已有明确中文提示。

## 1.1.3（2026-11-07）

对账残留根治 + i18n 全覆盖 + 繁体中文。

- **修复 markdown 写→解析不幂等（3/25 残留差异的根因）**：写入侧只给多行划线**首行**加 `>` 前缀，解析侧只认单行 `> `——多行/换行开头的划线与想法续行全部丢失（2019 年公众号文章对账 0↔2/3 漂移、每轮同步重写抖动）。修复：写入侧逐行加 `>`（标准 blockquote，想法首行 `💬 评论：` + 续行裸文本）+ 解析侧**续行归并**（相邻 `> ` 行并入同一划线、块内裸文本并入当前笔记；空行/标题/列表/emoji 标记终结块）。**旧文件不改一个字节即可追溯找回丢失文本**（用户真实文件离线验证：三本书对账口径计数 2/3/2 与服务端全对齐）。往返幂等测试覆盖多行/换行开头/内部空行/多行想法/旧格式恢复。
- **i18n 全覆盖（用户主诉：切 English 大部分界面仍中文）**：v1.0 只翻常用层，深层文案硬编码。现 6 个组件文件（书架/详情/洞察/漫游/设置/App）全部用户可见文案（按钮/toast/空态/占位符/提示，含插值函数键）入字典；字典 102 → **380 键**，T_ZH/T_EN/T_ZH_TW 三语键完全对齐（rmsmoke parity 断言）。导出图 canvas 的周名/水印/未命名书名同样走字典。
- **修复 tabs 不随语言切换**：90-tail tabs useMemo 依赖缺 `langTick`，切语言后 tab 标签永不更新（主诉根因之一）。
- **新增繁体中文（zh-TW）**：设置页语言三选（简体中文/繁體中文/English）；setLang 三语 + 回退链（zh-TW 缺键→简中→键名）；台湾用词习惯（設定/筆記/登入/掃碼/貼上/備份/匯出…，技术词保留原文）；locale.register 补 zh-TW。
- 服务端数据字面量（'未分类' 等比对键）保留硬编码，与展示文案分离。
- smoke 119 断言（+6 幂等）；rmsmoke 29 项（+三语/parity/回退链/深层抽查）。

## 1.1.2（2026-11-07）

真机对账首跑（4/25 不一致）归因与修复。三类问题全部定性（网关 ground truth 核实）：

- **修复「只有书评/想法的书漏采」（阿加莎 0/1 类）**：补采触发条件原先依赖 cookie 书架的 reviewCount，而该书在 cookie 侧计数为 0 → 永不触发。现网关在场时把官方 /user/notebooks 合并进同步清单：**官方三计数覆盖 cookie 计数**（gate 权威化）+ **cookie 书架缺失的书直接补进清单**（如仅 1 条书评、无划线的书）。书评是独立于笔记数组的写盘通道，`shouldUpdate` 判定增加「有书评即写」。
- **修复「未命名书籍文件名乒乓」（MP 文章 0↔3 漂移类）**：服务端对部分 2019 年公众号文章返回**空标题**（网关核实：title 为空串），多书同名「未命名书籍」→ `{{title}}` 模板冲突 → _1/_2/_3/_4 反复改名、被重复清理误伤，对账读取时点赶上改名即忽 0 忽 3。现 `buildFileName` 对空标题/未命名书籍回退 **bookId** 作文件名；存量文件按 frontmatter bookid 走 canonical 命中，不强制迁移。
- **对账本地计数口径对齐官方**：官方把划线与想法各自计 1（一条带想法的划线 = 2），整本书评在 `## 书评` 区块。本地计数改为内容条目数（划线/想法各计 1 + 书评区块计 1），消除语义性假差异。
- 对账复用本轮同步已拉取的 notebooks（免二次翻页）；网关合并失败软降级回 cookie 计数。
- smoke 113 断言（+7）：网关驱动同步（计数订正/缺失书补齐/无标题文件名回退/书评落盘/对账归零）+ buildFileName 回退纯函数。

## 1.1.1（2026-11-07）

- **修复「设置页点绑定 API Key 只跳页不弹窗」（用户反馈）**：`weread:open-login` 事件派发时书架组件尚未挂载（App 只渲染当前 tab，监听器不存在），App 层只完成了切 tab；而书架挂载后的自动弹层仅对「未登录」生效——登录态用户被跳到书架后什么都没有。该竞态自 v1.0.9「设置页常驻登录入口」即潜伏，v1.1 的「绑定 API Key」按钮（面向已登录用户）必现。修复：App 层暂存请求（`__pendingLogin`/`__pendingLoginTab`，同既有 `__pendingDetail` 模式），书架挂载时消费——**登录态下也弹**；事件支持 `detail.tab`，设置页「绑定 API Key」直达 API Key tab（不再停在扫码页）。洞察/漫游空态「去登录」同样受益。
- react-mount-test 新增端到端回归：真实 React 挂 App → 切设置 → 派发事件（tab=apikey）→ 断言弹层出现且直达 API Key 表单、暂存标志被消费。

## 1.1.0（2026-11-06）

官方 Skill 引入线第一期（roadmap §8A，决策 D5-D7）：API Key 官方通道 + 笔记完整性。源起 [analysis-04-weread-official-skill.md](../docs/analysis-04-weread-official-skill.md)。

- **官方网关客户端 `lib/gateway.js`**：接入微信读书官方 Agent 网关（`POST i.weread.qq.com/api/agent/gateway`，Bearer `wrk-` Key）；api_name 分发、业务参数平铺、`skill_version` 上报、`upgrade_info` 捕获落 state、`/_list` 自发现；`/user/notebooks`（count+lastSort 游标）与 `/review/list/mine`（synckey 游标）翻页封装；fetch 可注入（测试不触网）。
- **登录三通道**：登录弹层新增「API Key（官方）」tab。已登录时绑定当前账号（推荐路径，账号目录/多账号模型不变）；未登录时独立账号（官方 `/user/profile` 未开放则按 notebooks 签名哈希生成确定性伪 ID）。Key 存 secrets.json（0600）+ macOS Keychain 镜像（独立服务名 `dsh-weread-apikey`，含启动补水）；登出/删号/卸载清理同步覆盖。
- **登录态融合**：`isLoggedIn = cookie ∨ apiKey`；API-Key-only 账号校验走网关 ping（同享 10 分钟缓存/7 天宽限语义）；cookie 失效但 Key 有效时**Key 营救**——不误登出，同步可走网关；切号同步切换网关 Key。
- **想法/书评补采（数据正确性）**：官方口径「所有笔记内容 = 划线 + 想法/点评」，此前同步只调 bookmarklist——**整本书评、章节点评从未进本地 Markdown**（markdown.js 的 `## 书评` 渲染钩子一直空转）。现在对 `reviewCount>0` 的书叠加拉取：网关 `/review/list/mine`（Key 在场）或 web `/web/review/list` 兜底（cookie 在场）；划线想法按 range/abstract 归并到既有笔记，章节点评为独立想法笔记，整本书评接渲染钩子；软失败不阻塞主同步。单书刷新（详情页）同样补采。
- **官方三计数对账**：网关在场时同步收尾按官方口径（noteCount+reviewCount）逐书比对本地导出条数，差异写入 `syncState.reconcile`，设置页「官方通道」卡片与工具 status 展示——「同步是否完整」从感觉变成可验证。
- **设置页「官方通道」区**：绑定态（Key 尾号脱敏 + skill 版本）、连通性测试（`/api/gateway/test`：ping + `/_list`，即 roadmap §8A 的真机 Go/No-Go 闸门）、解绑、upgrade_info 提示、对账结果（含差异书列表前 5）。
- **修复存量 bug（smoke 新用例发现）**：`revalidateAndBroadcastLoginState` 在「登录广播成功后账号被登出 / 校验持续异常」时以 2.5s **无限重试**（每轮还写 state 文件），进程永不退出、CPU 空转。现无凭据即停 + 重试上限 5 次。
- 工具 `status` 增加官方通道与对账行；openapi.json 登记新端点（login/apikey、gateway/test、gateway/unbind）。
- smoke 106 断言（+34：网关握手/错误/翻页/upgrade_info、apiKey 存取、想法三分类与归并、对账、登录绑定/独立/登出、补采落盘、路由守卫）；rmsmoke 新增官方通道区与 API Key 登录组件渲染断言。
- **待真机验证（用户配 Key 后）**：`/api/gateway/test` 连通、对账差异为 0 或可解释、书评出现在 Markdown。

## 1.0.9（2026-11-06）

用户复测反馈"刷新/同步未检测过期、无登录入口"的修复。

- **同步/刷新前实时复核**：auth 新增 `verifyNow()`（绕过 10 分钟校验缓存与 7 天宽限直接问服务端，不动凭据）；`/api/sync` 与 `/api/book/sync`（详情刷新，**原路由无任何登录守卫**）入口先 `ensureLoginFresh`（上次裸校验 >2 分钟即复核），过期即 401 + `loginExpired` 标记 → 客户端弹登录。
- **设置页常驻登录入口**：「账号管理」标题栏新增「登录 / 重新登录」按钮（无论当前登录态显示与否），经 `weread:open-login` 事件切书架弹登录——此前所有入口都以 `!loggedIn` 为前提，宿主状态失真时全应用无登录入口。
- smoke 新增：详情刷新 401 守卫、verifyNow 实时判无效单测；rmsmoke 断言设置页登录入口文案。

## 1.0.8（2026-11-06）

- **未登录主动引导**：① 书架首次使用（未登录且无书）或登录过期时，自动弹出登录弹层（每会话一次）；② 点「同步」收到 401 时直接弹登录而非仅 toast 报错；③ 漫游/洞察空态在未登录时显示「去登录」按钮（跨页签事件切回书架并弹登录）；④ 新增 `weread:open-login` 面板内事件（与 open-detail/open-roaming 同机制）。

## 1.0.7（2026-11-06）

- **修复书架无法滚动**：书架根节点复用了 `wr-root`（`height:100% + overflow:hidden`）嵌在 App 滚动容器 `wr-body`（`overflow:auto`）内——内容超高时内层裁切、外层不溢出，两头都没有滚动条；分类一多（约 40 个公众号分类）必然触发。书架根改为 `wr-bookshelf-root`（不锁高度、不裁切，随 `wr-body` 自然滚动）。
- **顺带修复详情页同族隐患**：面包屑 wrapper 内的详情根节点 `height:100%` 会超出容器被裁掉一条（面包屑高度），改 `flex:1` 链路，章节导航/正文内部滚动不受影响。

## 1.0.6（2026-11-06）

- **修复"凭据已失效但面板仍显示已登录"**：根因是非严格校验的 7 天宽限期（`lastVerifiedAt` 新鲜时服务端判无效也返回 true，防网络抖动误登出），UI 与同步入口均未区分"验证有效"与"宽限中"。auth 管理器新增 `getLastRawCheck()` 暴露底层真实校验结果；Host 新增登录态三分类（有效 / **登录已过期**（凭据在但已判无效，黄色横幅+重新登录按钮）/ 未登录），启动与 30 分钟复检统一走分类器；`/api/state` 增加 `loginExpired`；同步入口 401 文案分级；重新登录即清除过期态。
- smoke 新增 auth 单测（宽限 true + raw false 分离；宽限外 false 且 cookie 按原设计保留）；rmsmoke 新增过期横幅断言。

## 1.0.5（2026-11-06）

- **修复详情页刷新清空笔记（数据丢失级）**：`syncBook`（详情页「刷新」走的路径）原实现把远端笔记**直接覆盖写盘**，绕过主管线的本地合并保护——公众号书等场景远端 bookmarklist 常返回空列表，一次"刷新"即把本地笔记清成"暂无笔记"。现对齐主管线：本地/远端差异判定 + `mergeWithLocalNotes`（远端为空全保留本地、本地更新时间优先），计数按合并后重算；新增回归断言"远端空列表不清空本地（2→2）"。

## 1.0.4（2026-11-06）

用户复测反馈的两项修复。

- **数据浮层"点面板内区域不关"**：v1.0.2/3 的关闭判定基准是"整个漫游面板之外"，点漫游面板内的卡片/筛选/空白都被视为"内部"而不关闭。判定基准改为**浮层与「数据 (D)」按钮本身**——除此之外任何区域（含漫游面板内、宿主侧栏/会话/输入框）点击或焦点移入即隐藏；事件仍走捕获阶段防宿主 `stopPropagation`。
- **dock 小卡点击不切换面板**：`W.selectPanel` 原在 apply 时一次性绑定 `ctx.get('layout')`，服务未就绪时永久失效（症状：详情已暂存但需手动点侧栏）。改为**每次调用惰性解析**多个候选服务名（layout/workspace/uiLayout/panels），全部失败时**兜底点击我们注册的侧栏图标容器**（等价用户手动点侧栏）；侧栏图标挂 ref 捕获 DOM 节点供兜底使用。

## 1.0.3（2026-11-06）

- **修复数据浮层"点会话区关不掉"**：v1.0.2 的外部点击监听走事件冒泡阶段，而宿主 UI（侧栏/会话列表/输入框）在 mousedown 冒泡阶段 `stopPropagation()`，导致只有点标题栏能关（用户实测反馈）。改为 **document 捕获阶段**监听 mousedown/pointerdown（先于目标处理器执行、不被拦截），保留焦点移出与整窗失焦路径。

## 1.0.2（2026-11-06）

- **漫游数据浮层失焦自动隐藏**：外部点击之外，新增焦点移出（键盘 Tab / 程序化聚焦到漫游区外）与整窗失焦（切换应用/面板）两条关闭路径；浮层内操作不受影响。

## 1.0.1（2026-11-06）

用户走查反馈修复。

- **漫游「记得/忘记」常驻**（修复冷启动设计缺陷）：此前分级按钮只在复习模式出现，而复习模式依赖到期卡、到期卡又依赖首次评分——冷启动死循环。现在普通漫游即可评分（Space 记得 / X 忘记）建立 SM-2 曲线；快捷键提示常显；当日重复评分仍幂等。
- **设置项位置**：「周目标」「界面语言」从「AI 集成」区上移至「笔记配置」区（多账号模式之后），更易发现。
- rmsmoke 新增断言：普通模式 记得/忘记 常驻、设置页 界面语言/周目标 行存在（防"旧 bundle 误报缺失"类回归）。

## 1.0.0（2026-11-06）

稳定发布版本。路线图（v0.2.0 → v1.0）全部落地。

### 新增

- **i18n 生效**：`language` 配置（中文 / English）切换 W.t 常用文案字典；深层文案仍为中文（已在手册注明）；locale/en.json 元信息翻译。
- **用户手册** `docs/user-guide.md`：面向非程序员的安装、登录（扫码/Cookie 图文步骤）、日常使用、快捷键、数据位置、备份与卸载、故障排查表。
- **全量备份**：设置 →「📦 打包全量备份」把笔记目录 + 状态文件（**排除凭据与端点**）打成 zip 存到下载目录；自写 ZIP 生成器（store + UTF-8 EFS 标志——系统 zip CLI 对中文文件名会乱码）；`POST /api/backup` 支持指定目录。
- **卸载前清理**：设置 →「🧹 卸载前清理本机数据」（二次确认）：删除 Keychain 凭据镜像 + `~/.dsh/weread/` 全部状态 JSON；明确不动笔记目录与备份；`POST /api/uninstall/cleanup`。
- **阅读目标（P2 转正）**：设置周目标（条/周），洞察页 🎯 胶囊显示本周进度与连续达标周数（近 8 周趋势聚合）。
- **划线摘录卡片（P2 转正）**：书籍详情「摘录多选」→ 点选任意笔记 → 底部浮条一键复制带出处（书名·章节）的 Markdown 引用块，供写作粘贴。
- **README**：发版流程（版本号/CHANGELOG/git tag 三对齐）。

### 测试

- smoke 63 断言（+周目标/备份 zip 内容与凭据排除/卸载清理清空验证）；rmsmoke 17 项（+i18n 切换往返）。

## 0.5.0（2026-11-06）

AI 深度集成版本（D1/D2 决策后收窄：不做向量检索、不做素材直通）。

### 新增

- **`weread ask` 工具动作**：基于本地打分检索（复用 0.5ms 级搜索）取 top-12 相关笔记，带编号出处返回给模型组织答案，并约束"不编造材料之外的内容"；纯本地，不依赖外部 API。
- **上下文注入可配置化**：新增 `ctxInjectEnabled / ctxBookCount / ctxIncludeHighlights / ctxHighlightCount / ctxExcludeTitles`（排除书名关键词，逗号分隔）；设置页新增「AI 集成」区；配置变更即时失效注入缓存。
- **修复存量 bug**：A2 上下文注入自 B1 性能改造后 `queryBooks` 异步化未 await，注入内容实际一直为空——本次测试化时发现并修复（text() 同步返回缓存 + 异步重建）。

## 0.4.0（2026-11-06）

MCP server 版本（D3 决策提前）：笔记能力开放给其他 Agent 宿主。

### 新增

- **MCP server**（`tools/mcp-server.mjs`，stdio JSON-RPC）：暴露 `weread_search / weread_books / weread_notes / weread_insights / weread_status` 五个只读工具；`--selftest` 内置假 API 全链路自测 + 真实 stdio 管道验证，已入 `npm test`。
- **端点自动发现**：插件收到首个面板请求时把 base URL 写入 `~/.dsh/weread/endpoint.json`；MCP 侧支持 `--url` / `WEREAD_DSH_URL` 覆盖。
- README 增补 MCP 配置样例（Claude Code 等）。

## 0.3.0（2026-11-06）

复习与报告版本：漫游从"随机抽卡"升级为 SM-2 记忆巩固，洞察增加周报与 AI 解读闭环。

### 新增

- **SM-2 间隔重复**：每条笔记元数据增加 {sm2EF, sm2Interval, sm2Reps, sm2Lapses, sm2Due}；普通漫游到期卡优先（最早到期先出）；`记得`(q=4) 按曲线拉长间隔（1d→6d→×EF），`忘记`(q=2) 重置 1 天并降 EF。
- **今日复习模式**：`POST /api/roaming/action {action:'reviewStart'}` 进入只出到期卡的队列模式（剩余计数/结束复习）；漫游面板入口按钮 + 忘记/记得按钮 + 快捷键 Space/X；输入框小卡显示到期角标（🎯 复习 N），点击直达漫游 tab。
- **会话续读**（v0.2 补充说明）：复习模式与剩余队列随会话文件持久化。
- **周报**：每周首个调度 tick 自动生成 `阅读洞察报告/阅读周报-YYYYMMDD.md`（本周 vs 上周同期差值）；`POST /api/insights/weekly-report` 可手动触发。
- **AI 解读闭环**：洞察页导出报告后出现「🤖 AI 解读」按钮，一键复制解读提示词（粘贴到输入框即可让 AI 结合文件分析）。

### 测试

- smoke 45 断言（+SM-2 落盘/到期模拟/忘记重置/周报）；rmsmoke 15 组件渲染（+复习入口/复习模式文案断言）。

## 0.2.0（2026-11-06）

工程收尾与发布纪律版本。功能面与 0.1.2 工作区一致（含下述审查修复），不新增功能。

### 对抗性审查修复（30/30，详见 docs/adversarial-review.md）

- **P0×4**：同步按钮假反馈（改启动+轮询状态机、401 校验、30 分钟登录复检）；设置保存静默丢弃 outputPath（走校验通道 + validation unknown 态）；/api/state 每轮 4 次同步 IO（store stat 签名解析缓存 + queryBooks 记忆化）；笔记双读双解析（单次解析 + mtime 缓存 + rebuild 接入 shouldReparseFile）。
- **P1×10**：搜索 haystack 缓存；canonical 查找每轮同步一次映射 + frontmatter 只读 8KB；fs.watch 自触发 suppress；扫码轮询 cancel 端点；analytics 廉价指纹预检 + LRU12；App 轮询浅比较 + 全 tab memo；usePoll 防重入；切账号请求代次守卫；dock 独立 /api/roaming/card（与面板会话隔离）；toast 自动消失 + 登录后自动同步。
- **P2×15**：漫游池文本截断 + history 上限 + 过期缓存清理；notesCache 过期即删；roaming.meta 拆独立文件（roaming.\<account\>.meta.json，5000 条淘汰）；挂载重复拉取收敛；Insights 悬停零重渲染；树视图分段渲染；导图主题实时探测；高频文案入 W.t 字典等。

### 工程化

- git 仓库化（基线 tag `baseline-pre-0.2`）。
- `build.mjs`：parts → client.js 一键构建 + 语法校验 + `--check` 与产物逐字节比对，防手工 cat 回潮。
- `npm test` 三套测试接线：smoke（35 后端断言，含重启续读/接口健康）+ rmsmoke（11 组件渲染）+ react-mount-test（真实 React 挂载 App/dock/侧栏 + 降级横幅断言 + 挂载树大小守卫，防"面板空白"类回归静默溜过）。
- package.json 版本对齐 0.2.0；本 CHANGELOG 建立。

### 新增（本版两项 P1）

- **漫游会话持久化**：`roaming.<account>.session.json` 保存 history（≤200）/浏览位置/metrics/筛选，重启续读同一张卡；pool/statsPool 由索引后台重建，next 到尾部自动等待重建。
- **接口健康降级**：`/api/state` 新增 `apiHealth`（启动校验/30 分钟复检/同步结果/登录联动，网络错误经 weread.qq.com 探测区分「接口不可达」与「凭据过期」）；不可达时面板顶部显示降级横幅（本地数据可正常浏览），Agent 工具 `status` 返回降级标记。

### 性能实测（缓存热）

搜索 0.3–0.5ms ｜ 洞察 7ms ｜ 状态 0.5ms。

## 0.1.2（2026-11-05）

初始版本：由 weread-vscode 0.1.2 VSIX（MIT）移植为 DSH 插件。同步流水线、Markdown 导出（与原版逐字节兼容）、文件真源索引、阅读洞察、笔记漫游、多账号；DSH 深度集成：阅读上下文注入、工具卡、侧栏 KPI、输入框漫游小卡、行内配置、Keychain 凭据镜像、/weread/api 互操作 API、fs.watch 实时联动、斜杠命令。
