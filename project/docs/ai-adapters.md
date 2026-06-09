# AI CLI Adapter 架构调整 — 流程

> 把单一 `CliService` 重构为 per-adapter 全生命周期架构。原则：**从 4 个真实 CLI 提炼契约**（不为想象的 11 个设计）、**facade 渐进迁移**（不破现有 IPC/测试）、**流式+取消从第一天进契约**（接上前端已就绪的流式 UI）、**RuntimeEnvironment 注入式**（adapter 不碰 process.env/os，可单测）、**capabilities 回流 UI**（Composer 按能力 gate 图片）。

## 现状基线（重构前）
- `packages/main/src/services/cli-service.ts`（369 行）：`CliSpec` 表 + 共享发现/安装/诊断，4 个 CLI（codex/claude/kscc/kimi）。
- `buildAgentCommand` 已走 **stdin**（prompt 不走 argv）✅。
- health 仅 `--version`——**claude `--version` OK 但 `--print` 401 漏检**（要修的具体 bug）。
- 路径已较集中在 `resource-paths.ts`（GAMEAISTUDIO_HOME/RESOURCE_ROOT、`app.getPath`）。散落的是 `process.platform`（多已参数化）、`process.env`（凭据/npm/PATH）。
- 调用链：ipc → agent-turn-orchestrator/agent-service → cli-service.buildAgentCommand → process-runner。
- main 测试覆盖良好（cli-service.test / agent-service.test / process-runner.test…），重构必须保持全绿。

## 目标结构
```
packages/main/src/ai/
  runtime-environment.ts      # 注入式环境（平台/env/路径/npm bin/shell/isPackaged）
  adapter-contract.ts         # Adapter 接口 + AgentTurnRequest/Result/TurnChunk + capabilities + health
  adapter-registry.ts         # 注册 + 路由（AgentRole→Policy→Adapter）
  run/process-runner.ts       # 复用现有 process-runner（流式 stdout）
  adapters/
    codex-local/  claude-local/  kscc-local/  kimi-local/   # 第一批：迁移现有 4 个
    （后续）gemini-local / cursor-local / cursor-cloud / opencode-local / openclaw-gateway / acpx-local / pi-local
```

## 契约接缝（最先钉死）
```ts
type RunModel = "local" | "cloud" | "gateway";

type AgentTurnRequest = {
  prompt: string;
  contextPath?: string;        // .gameaistudio/agent-context.md 等项目内协议常量
  workingDir: string;
  images: { name: string; mimeType: string; dataUrl: string }[];
  signal: AbortSignal;          // 取消
};

type TurnChunk =
  | { type: "text-delta"; text: string }
  | { type: "step"; title: string }
  | { type: "error"; error: string }
  | { type: "final"; content: string; exitCode: number | null };

type AdapterHealth = {
  installed: boolean;
  authed: boolean | "unknown";   // 不只 --version
  headlessOk: boolean | "unknown"; // claude --print 401 在这里暴露
  imagesOk?: boolean | "unknown";
  writable?: boolean | "unknown";
};

type AdapterCapabilities = {
  runModel: RunModel;
  supportsImages: boolean;
  imageInputMode: "file-flag" | "prompt-path-reference" | "base64" | "unsupported";
  supportsStream: boolean;
  supportsResume: boolean;
  headless: boolean;
};

interface AiAdapter {
  id: string;
  label: string;
  capabilities: AdapterCapabilities;
  discover(env: RuntimeEnvironment): Promise<{ executablePath?: string; found: boolean }>;
  health(env: RuntimeEnvironment): Promise<AdapterHealth>;     // 分层 smoke test
  install?(env: RuntimeEnvironment): Promise<GodotRunResult>;
  runTurn(req: AgentTurnRequest, env: RuntimeEnvironment): AsyncIterable<TurnChunk>; // 流!
}
```
> 本地 adapter 第一版 `runTurn` 可只 yield 一个 `final`，但形状先定成流——#12 后端逐字流式就是它的自然产物。契约**不假设** `executablePath`/`spawn`（留给 cloud/gateway）。

## RuntimeEnvironment（注入式）
```ts
interface RuntimeEnvironment {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  homeDir: string; documentsDir: string; appDataDir: string; localAppDataDir: string;
  programFilesDirs: string[]; pathEntries: string[];
  npmGlobalBin(): Promise<string | undefined>;
  isPackaged: boolean; resourceRoot: string; userDataRoot: string;
}
```
默认实现读 `process.*`/`app.getPath`/resource-paths；测试注入 fake。adapter/服务一律只问它。

## 顺序（每步 typecheck + 全测试绿才进下一步）
1. **RuntimeEnvironment** 抽取 + 注入（纯重构，零行为变化，去硬编码）。
2. **AdapterContract** 类型接缝（含流式/取消/capabilities/分层 health）。
3. **迁移 4 个本地 CLI** 为 adapter，`CliService` 当 facade（IPC/测试不破）；加分层 health → **修 claude --print 401**。
4. **capabilities + 富 health** 流到 bootstrap；Composer 按 `supportsImages` gate 图片。
5. （后续）cloud/gateway + 其余 adapter。

## 进度
- [x] **1 RuntimeEnvironment**（纯重构，160 测试全绿，tsc 0）：`ai/runtime-environment.ts`（注入式接口 + createRuntimeEnvironment 懒解析 app-free + 4 个纯 which/path 助手的 canonical 家）。cli-service 注入 RuntimeEnvironment，用 env.which/npmGlobalBin/env/platform，消除与 environment-service 重复的 findExecutable；助手从 cli-service re-export 保测试。
- [x] **2 AdapterContract**（typecheck 0，collectTurn 3 测试）：`ai/adapter-contract.ts`（AiAdapter + AgentTurnRequest + 流式 TurnChunk + AbortSignal + 分层 AdapterHealth + AdapterCapabilities + collectTurn 流→一次性辅助）。
- [x] **3 迁移 4 adapter + facade + 分层 health**（169 测试全绿，tsc 0）：
  - `ai/adapters/local-cli-adapter.ts`（createLocalCliAdapter 工厂：discover[which+npm bin 回退] / health[version+credential+headless 探测] / install / **runTurn 流式**[onStdout→text-delta + final，async-queue 桥]，runner 可注入）。
  - `ai/adapters/{codex,claude,kscc,kimi}-local.ts`（各自 config：command/promptArgs/install/credentials/capabilities/headlessProbe）。
  - `ai/adapter-registry.ts`（4 adapter，runner 可注入）。
  - `CliService` 重构为 **facade** 委托 registry：CliTool/buildAgentCommand 输出**字节不变**，并暴露 `runTurn` 作为 AgentService 的流式入口。promptArgs 与旧 promptStdinArgs 一致。
  - **修 claude --print 401**：adapter.health 的 headless 探测检 AUTH_FAILURE 正则，--version 通过但 --print 401 时 headlessOk=false/authed=false。6 个 adapter 单测（注入 fake env+runner）+ 3 contract 测试。
  - 注：environment-service 的重复 findExecutable 待后续迁移。
- [x] **4 capabilities + 富 health → UI + AgentService 流式 runTurn**（typecheck 0，聚焦测试 39 绿）：
  - `CliTool` 扩展 `capabilities` / `health`，`CliService` facade 将 Adapter 分层 health 和 capabilities 投影到 bootstrap/refreshCliTools。
  - UI 的 CLI 卡片展示 runModel、headless、stream、图片输入方式、Auth/Headless 健康状态和对应诊断。
  - Composer 按 `supportsImages` gate 图片附件；发送按钮和后备发送逻辑都会阻止不支持图片的 Adapter。
  - `chooseAgentCli` / 团队工作流改为只自动路由到 `status=available` 的 CLI，避免 `--version` OK 但 headless/auth 失败的 CLI 被继续选中。
  - `AgentService` 不再手拼 `buildAgentCommand + runProcess` 主路径，改由 `CliService.runTurn` 委托 adapter；stdout/stderr delta 会流式写入 Run Step，final 保留 exitCode/duration/cancelled/timedOut 供消息与日志复用。
- [x] **5 cloud/gateway 接缝**（首批 endpoint adapter 骨架，协议细节待各提供方确认）：
  - `ai/adapters/endpoint-adapter.ts`：为 cloud/gateway Adapter 提供 endpoint/env/credential/capabilities/health/runTurn 形状。
  - 注册 `cursor-cloud` 和 `openclaw-gateway` 到 `AdapterRegistry`；registry 现在同时支持 `list()` 全部 Adapter 与 `listLocalCli()` 本地 CLI facade。
  - `CliService` 仍只暴露 4 个本地 CLI，避免未完成 endpoint 协议污染现有 UI/IPC。

## 审查修正（review pass）
- **修：discover 触发真实 API 调用**（关键）。步4 把 `adapter.health()`（含 headless 探测=真实模型调用）接进了 `toCliTool`/`discover`，导致每次启动/刷新对 4 个已安装 CLI 各发一次真实调用（慢/耗 token/限流）。改：`health(env, { probe })`，**discover 走 `{ probe: false }`**（仅 version+credential，零 API）；新增显式 **"测试连接"**（`testCliTool` IPC → `cli:test` → `CliService.testTool` probe:true）按需暴露 401。studio 设置每个已安装 CLI 加"测试"按钮。+2 单测锁定（probe:false 不调模型 / testTool 跑探测）。180 测试全绿，tsc 0，build 0。
- 复核通过：Composer 按 `capabilities.attachments` 门控图片按钮（不支持时置灰+提示）；studio 按当前 CLI `supportsImages` 传 AgentChat + 发送前拦截；agent-service 主路径已走 `cliService.runTurn`（adapter 流式→run step 输出 + AbortController 取消）。
- **#12 chat 逐字流式到 renderer 完成**（180 测试全绿，tsc 0，build 0）：`AgentStreamEvent`（projectId/agentId/messageId/delta/done）；agent-service 早建 `streamingMessageId`，runTurn 流的每个 text-delta 经注入的 `emitStream` 发出（并复用为最终 message id，无闪烁），结束发 done；index.ts 接 `webContents.send("agent:stream")`；preload `onAgentStream`；studio.tsx 订阅后把 delta 累加进在途 agent 消息→AgentChat + streamdown 逐字渲染。+1 agent-service 流式断言测试。顺带修了 tap 冒烟测试的时序 flake（nextTick→flushUntil 轮询）。
- 仍开放：environment-service 重复 findExecutable 待迁；cloud/gateway 协议待接。
