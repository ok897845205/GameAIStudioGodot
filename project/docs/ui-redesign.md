# GameAIStudio UI 重构方案（assistant-ui 自有运行时移植）

> 状态：施工中。决策已冻结，自底向上移植。任务追踪见任务清单 #1–#15。
> 参考蓝图：`E:\AIProject\assistant-ui`（Y Combinator 投资的开源库 assistant-ui，"ChatGPT UX in React"）。

## 1. 目标

把当前密集三栏控制台（`packages/renderer/src/app.tsx`）重构为**生产级 ChatGPT 风格聊天 UI**：流式输出、代码块高亮、markdown、双主题、可深度定制视觉。

## 2. 已冻结的决策

| 议题 | 决策 |
|---|---|
| 布局骨架 | **聊天 + 预览 双主舞台**：左(项目列表) / 中(角色 Thread) / 右(预览, 可折叠) |
| 低频诊断（CLI 健康/系统环境/Godot 运行时） | **移入设置弹层/设置页**，主界面只留状态指示 |
| 主题 | **双主题可切换**（CSS 变量 :root/.dark + ThemeProvider + localStorage） |
| 技术栈 | **Tailwind + shadcn/ui** |
| assistant-ui 引入方式 | **全部自有重写**：运行时 + 表现层都按蓝图一行行移植进本仓库自维护 |
| 流式输出 | **真流式**：改后端把本地 CLI 的 stdout 增量经 IPC 推到前端 |
| 多角色表达 | **每(项目×角色)独立子会话**：每对挂一个 runtime，角色 Tab 切换即切 runtime |
| 消息分支/编辑/重发 | **v1 即包含**（完整复现 message-repository 父子树） |
| 响应式底座 | **一并自有重写** assistant-ui 的 tap/store（不依赖外部包） |

## 3. 范围边界

**砍掉（不移植，与 GameAIStudio 无关）**：所有后端集成（ai-sdk / langgraph / langchain / ag-ui / a2a / google-adk / opencode）、`mcp-apps` / `react-mcp`、`devtools`、`sandbox-host`、`o11y` / `heat-graph` / generative-compiler、`cloud`、`react-native` / `lexical`、voice & speech adapters。

**保留并自有重写（"我们的运行时"，估 ≈1.5–2 万行）**：见下层级。

**保留不动**：现有 `window.studio.*` IPC 契约、main/preload 服务与既有测试（真流式为**新增**通道，不改既有签名）。

## 4. 依赖图与移植顺序（自底向上）

```
tap(fiber 运行时)  ──┐
subscribable        ─┼─→ store(scopes/clients) ─→ runtime cores ─→ external-store runtime
assistant-stream    ─┘                              (thread/composer/        ↓
types + message-repository(含分支) ────────────────  attachment)      React 绑定(Provider/hooks)
                                                                              ↓
                                                                    primitives(Thread/Message/Composer/ActionBar)
                                                                              ↓
                                                                    vendor styled 组件(shadcn 主题)
```

并行的两条非移植工作线：
- **后端真流式**：`main/agent-service.ts` stdout 边产边发 → `ipc.ts`+`preload` 新增 `onAgentStream` 通道。
- **GameAIStudio 接线**：`AgentMessage→ThreadMessageLike` convertMessage；onNew→`runAgentTurn`；onCancel→`cancelActiveRun`；isRunning→busy/activeRun；attachments→现有图片流。

## 5. 包结构

新工作区包 `project/packages/assistant`（`@gameaistudio/assistant`）：
```
src/
  types/         # Unsubscribe / message / ThreadMessageLike ...
  tap/           # fiber 响应式运行时（移植 packages/tap）
  subscribable/  # 订阅原语（移植 core/src/subscribable）
  stream/        # 流式组装（移植 assistant-stream 子集）
  runtime/       # message-repository + 运行时核心 + api/base/interfaces
  runtimes/      # external-store 运行时
  store/         # scopes / clients（建在 tap 上）
  react/         # context + AssistantRuntimeProvider + hooks
  primitives/    # Thread/Message/Composer/ActionBar/Attachment
```
styled 表现层 vendor 到 `packages/renderer/src/components/assistant-ui/`（shadcn 风格，消费者拥有、可改）。

## 6. 重构后布局

```
左栏 项目列表(自有)    中栏 角色子会话(Thread)              右栏 预览主舞台(可折叠)
  项目 ●            ┌ 角色 Tab: 制作人|策划|程序|美术|QA ┐   ┌ 实时预览 iframe ┐
  + 新建(弹层)      │ 每(项目×角色)=独立 Thread/runtime  │   ├ Tab:构建|Git|产物┤
  ⚙ 设置(弹层)      │ 真流式打字机 / markdown / 代码高亮  │   └ 整栏可折叠      ┘
                    └ Composer(草稿/📎图片/CLI 选择/↑发送) ┘
```
设置弹层收纳：新建表单、CLI 健康、系统环境、Godot 运行时诊断。

## 7. 当前进度

- [x] 决策冻结 + 任务清单 #1–#15
- [x] 包骨架 `packages/assistant`（package.json/tsconfig/exports）
- [x] #3 subscribable 移植（typecheck 通过）
- [x] #2 tap fiber 运行时移植（31 文件，typecheck 通过 + 3 个运行时冒烟测试通过：useState/useMemo 派生、dispatch 调度重渲染、订阅通知、useEffect 生命周期、StrictMode 双调用）
  - 框架决策：完整复刻 `react-dispatcher`（运行时换 React 内部 dispatcher），使下游 store 可保持 `import from "react"` 的 hook 写法不变，低风险移植。
  - 类型修正：`useEffect.EffectCallback` 用 React 兼容的 `() => void | Destructor`，内部 cleanup 赋值显式收窄（运行时等价）。
- [x] #4 assistant-stream 流式组装子集移植（24 文件，typecheck 通过 + 4 个流式测试：文本增量单调增长、多 part、部分 JSON 工具参数增量解析、error chunk→incomplete）
  - 落点 `packages/assistant/src/stream/`，目录结构与上游一致（相对 import 原样），含：AssistantStream/Chunk 协议、modules(text/tool-call/assistant-stream 控制器)、accumulators(chunk→AssistantMessage + TimingTracker)、object/tool 子集、json(partial-json/fix-json) + stream utils(merge/path)。
  - 砍掉：wire 序列化(data-stream/ui-message/transport/PlainText)、HTTP Response helper、resumable/redis、客户端工具执行(ToolExecutionStream/schema-utils)、object 响应、provider-message 转换。
  - 新增外部依赖：`nanoid`、`secure-json-parse`。tool-types 仅保留 `ToolModelContentPart`/`ToolModelOutputFunction`（不引 zod）。
- [x] #5 runtime 类型 + message-repository 移植（含分支）
  - `src/types/`（message/attachment/quote/directive/trigger/index）+ `src/utils/id.ts` + `src/runtime/utils/`（auto-status / thread-message-like / message-repository）。
  - **分支完整保留**（决策要求 v1 即含）：addOrUpdateMessage/getBranches/switchToBranch/deleteMessage(relink)/resetHead/export-import。
  - `assistant-stream` 的 import 改写为包内相对 `../stream`、`../../stream/utils`。
  - 6 个分支测试通过：线性追加、重新生成产生兄弟分支、切换分支、删除 relink 子节点、export/import 往返保持分支与 head、ThreadMessageLike 转换（string→text part、空文本剔除、非 assistant 角色拒绝 status）。
- [~] #6 运行时核心（进行中，分两子步）：
  - **子步 A 已完成 — 契约层 + 依赖边**（typecheck 通过）：
    - `src/runtime/interfaces/`（thread/composer/thread-list/assistant-runtime-core 4 个契约）
    - `src/model-context/`（types/tool/registry/registry-handles）；为此给 stream 加了**最小结构化 `Tool` 类型**（不引 zod）
    - `src/adapters/`（speech/voice/feedback）
    - `src/runtime/utils/`（chat-model-adapter / external-store-message）
    - `src/runtime/queue/`（message-queue / external-thread-queue-adapter）+ `src/store/scopes/queue-item` + `src/utils/text`
    - 2 个 message-queue 测试：空闲即跑 / 忙时缓冲 / notifyIdle 推进 / remove 不触发
  - **子步 B 已完成 — base + api 运行时核心类**（typecheck 通过）：
    - `src/runtime/base/`：base-thread-runtime-core（消息仓库+分支+语音+订阅）、base-composer-runtime-core（文本/附件/听写/发送）、default-thread-composer、default-edit-composer、base-assistant；+ `adapters/attachment`、`utils/composite-context-provider`。
    - `src/runtime/api/`：paths、bindings、ThreadRuntime/MessageRuntime/MessagePartRuntime/ComposerRuntime/AttachmentRuntime/ThreadListRuntime/ThreadListItemRuntime/AssistantRuntime（基于 subscribable 的 memoize 绑定）。
    - 4 个运行时集成测试：append→messages、composer.send→append、分支切换、订阅通知。
- ✅ **#6 完成**。
- [x] #7 external-store 运行时 + 适配器（typecheck 通过）：`src/runtimes/external-store/`（adapter / runtime-core / thread-runtime-core(继承 BaseThreadRuntimeCore) / thread-list-runtime-core / shared-options / message-converter）+ `src/runtimes/tool-invocations/ToolInvocationTracker`（**接口忠实最小 stub**，因不跑客户端工具且该路径 opt-in 默认关闭）。
  - 5 个集成测试：convertMessage 消息映射、能力推导(cancel/switchToBranch/edit/reload)、append→onNew、isRunning 透传+乐观占位、缺 messages 报错。这是接 IPC 后端的桥。
- ✅ **#7 完成**。整包当前：tsc exit 0，vitest **24/24**（tap 3 + stream 4 + message-repo 6 + queue 2 + runtime-core 4 + external-store 5）。
- **架构瘦身决策（已确认）**：放弃移植 store 框架(@assistant-ui/store ~2035) + core/react(~9109) + primitives(~7649) ≈2.4万行。改为基于已移植 `runtime/api` 自建精瘦 React 层。assistant-ui 的 styled 组件作视觉参考、适配到我们 hooks。
- [x] #8 精瘦 React 运行时绑定（typecheck 通过）：`src/react/`（useExternalStoreRuntime / AssistantRuntimeProvider / MessageRuntimeProvider / context / useSubscribable / hooks: useThread·useThreadRuntime·useThreadComposer·useMessage·useMessageRuntimeByIndex）。导出 `@gameaistudio/assistant/react`。
  - 4 个 api 集成测试：thread 状态映射、setAdapter 后刷新+订阅通知、按 index 取 MessageRuntime、composer.send→onNew。
- ✅ **#8 完成**。整包当前：tsc exit 0，vitest **28/28**。
- [x] **Phase 0 (#1) 完成**（electron-vite build 通过）：
  - renderer 接入 **Tailwind v4**（`@tailwindcss/vite` 插件，加在 root + renderer devDep；root electron.vite.config.ts 用它故 root 也要装）。
  - `src/index.css`：shadcn 双主题 token（oklch）+ 状态色(success/warning/danger/info) + 5 角色 accent + `@theme inline` 映射 + base layer。
  - `src/lib/utils.ts` `cn()`（clsx+tailwind-merge）；`src/lib/theme.tsx` ThemeProvider(light/dark, localStorage, 切 `.dark` class)。
  - electron.vite.config renderer 加 `tailwindcss()` 插件 + `@gameaistudio/assistant` 子路径别名(react/stream/tap)。renderer 依赖加 `@gameaistudio/assistant`。
  - main.tsx 接入 index.css + ThemeProvider（暂保留 styles.css 让旧 app 不破）。
  - 验证：`electron-vite build` 成功（renderer 2101 模块，Tailwind 编译 41.67kB CSS）；全仓 **156 测试通过**。
- [x] **#9 完成**（renderer typecheck + electron-vite build 通过）：`renderer/src/components/`
  - `ui/button.tsx`（shadcn cva Button）
  - `chat/message.tsx`（user/assistant/system 气泡 + 角色头像 + 流式打字光标/typing dots）、`chat/composer.tsx`（textarea+发送/停止，Enter 发送，capabilities.cancel 才显示停止）、`chat/thread.tsx`（viewport + ResizeObserver 粘底自动滚动 + MessageByIndex 按 index 订阅 + 空态 ThreadWelcome）、`chat/chat-demo.tsx`（内存流式 echo bot，验证端到端）。
  - main.tsx 加 `#chat-demo` 预览开关（`pnpm dev` + URL `#chat-demo` 可见新聊天界面，默认仍旧 App）。
  - 验证：renderer tsc exit 0；`electron-vite build` 成功（2169 模块，Tailwind 生成聊天类 CSS 55.95kB）；全仓 156 测试通过。
  - **里程碑：第一个能跑、看得见的 ChatGPT 风格聊天 UI，端到端贯通（流式回显）。**
- [x] **#10 完成**（renderer typecheck + build + 156 测试通过）：用 **streamdown**（Vercel 流式 markdown，内置 shiki 代码高亮 + 优雅处理不完整 markdown）。
  - `chat/markdown.tsx`（MarkdownText 包装 Streamdown，shikiTheme=[github-light,github-dark] 跟随主题，Tailwind 类定制 prose 样式）。
  - message.tsx：assistant 走 MarkdownText，user/system 保持 plain pre-wrap。
  - index.css 加 `@source "../node_modules/streamdown/dist/index.js"` 让 Tailwind 扫描 streamdown 类。
  - demo 回复带 markdown+代码块展示。
  - 注：streamdown 带 shiki(按语言 code-split 懒加载) + mermaid(图表，懒加载)；主包增至 ~3.25MB，语言/图表块按需加载。Electron 本地可接受；若要瘦身可关 mermaid。
- [x] **#13 完成**（renderer typecheck + 160 测试通过）：`renderer/src/chat/`
  - `agent-adapter.ts`：`agentMessageToThreadMessageLike`（agent→assistant，system 满足单 text 不变量）+ `appendMessageText` + `useAgentChatRuntime`（包 useExternalStoreRuntime，onNew→onSend）。
  - `agent-chat.tsx`：`AgentChat`（薄封装 = adapter hook + AssistantRuntimeProvider + Thread）——可挂载的 GameAIStudio 聊天，state/发送留给 host（用 `window.studio.runAgentTurn`），**现有 IPC 契约不动**。
  - 4 个转换测试（含喂给真实 fromThreadMessageLike 验证合法性）。
- [x] **#11 完成（吸收）**：精瘦路线下 #9 自建 shadcn 组件 + #10 streamdown 已替代 vendor assistant-ui styled 组件。
- [x] **#15 双主舞台布局 + #14 按角色子会话 完成**（renderer typecheck + electron-vite build + 160 测试通过）：
  - `renderer/src/studio.tsx`（`StudioApp`）——全新双主舞台：左项目列表(+新建/设置/主题切换)、中(项目头+**角色 Tab** + `AgentChat`)、右(预览 iframe + 构建/Git/状态 Tab，可折叠)。诊断(CLI/环境/Godot 运行时)收进**设置弹层**。新建/文件预览用 Dialog。保留全部 IPC handler（runAgentTurn/workflow/preview/build/git/delete/install），实时订阅 onRunEvent/onPreviewEvent。
  - `components/ui/`（dialog/tabs/badge）。
  - **#14**：`AgentChat` 按 `key={project:agent}` 挂载——每(项目×角色)独立 runtime/thread，角色 Tab 切换即切子会话。
  - main.tsx：StudioApp 设为默认；`#legacy`→旧密集面板、`#chat-demo`→流式 echo demo。
- ✅ **UI 重构主体完成（#1–#11、#13–#15）**：生产级 ChatGPT 风格双主舞台界面，运行时全自有、流式 markdown 代码高亮、双主题、按角色子会话，接 GameAIStudio 真实后端。
## 8. 收尾 + 对比审查（vs 旧 app.tsx）

**根因修复（关键）**：旧 `styles.css` 含无 layer 的 `button/input/*` 全局规则，在 Tailwind v4 里**优先级高于 `@layer` 工具类**，导致新 UI 文字/颜色被覆盖（截图里 Tab 看不见字）。修法：styles.css 移入 app.tsx，main.tsx **懒加载** legacy/demo，使 styles.css 只在 `#legacy`/`#chat-demo` 时加载，**默认 StudioApp 全程只用 Tailwind**。

**功能完善（本轮新增）**：
- 发送后**乐观显示用户消息**（不再等 Agent 回完）。
- **活动任务进度条**（角色 Tab 下方显示运行中 run 的当前 step + 取消）。
- **图片附件**（Composer 加图片按钮 + 缩略图 chips + 移除；接 SimpleImageAttachmentAdapter；onNew 提取 → AgentAttachmentInput → runAgentTurn）。修了缩略图 objectURL 内存泄漏（useMemo+revoke）。
- 通知可关闭。

**对比审查结论 — 已覆盖（持平或更好）**：项目 CRUD、角色 Tab(更优:每角色独立子会话)、会话(更优:markdown/高亮/流式/自动滚动)、Composer(文本+图片+CLI 选择)、团队工作流、预览启停+iframe、构建(校验/导出/zip)、Git(状态/提交/还原/历史)、CLI/环境/Godot 诊断(设置弹层)、+ 主题切换、右栏折叠、乐观消息、任务进度（均为新增）。

**剩余次要差距（已记录，不阻塞）**：
- 消息内文件变更点击预览（转换时丢了 fileChanges，可后续用自定义 part 承载）。
- 详细 run 历史/step 输出（现仅显示当前 step）。
- autoPreview 开关（现硬编码 true）、Git 任意 hash 还原输入、Web 构建检查/manifest、Agent 上下文/日志预览按钮、创建时 autoRunWorkflow+preflight。
- **#12 后端逐字流式**（运行时+UI 已就绪，仅差后端推送）。

## 9. 剩余：#12 后端真流式

纯后端增强，独立谨慎做：process-runner 流式 stdout → agent-service 转发分片 → ipc 新通道 onAgentStream → preload 暴露 → shared 加类型/StudioApi → studio.tsx/agent-adapter 把分片累加进在途 assistant 消息。运行时与 UI 已支持流式（见 `#chat-demo`），只差后端逐字推送。
