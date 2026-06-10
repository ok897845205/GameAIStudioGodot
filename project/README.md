# GameAIStudio 桌面端

本目录包含 GameAIStudio 的全新桌面端应用。它是一个 AI 辅助游戏创造平台，可以创建 Godot 项目，运行本机 AI CLI Agent，预览 Web 导出结果，并打包成可游玩的 Web zip。

## 本地运行

首次运行前安装依赖：

```powershell
pnpm install
```

以开发模式启动 Electron 桌面应用：

```powershell
pnpm dev
```

只编译应用，不生成安装包：

```powershell
pnpm build
```

生成 Windows 安装包：

```powershell
pnpm dist:win
```

安装包输出路径：

```text
dist/GameAIStudio-Setup-<version>.exe
```

## 常用命令

```powershell
pnpm install
pnpm dev
pnpm test
pnpm typecheck
pnpm build
pnpm smoke:templates
pnpm smoke:webzip
pnpm dist:win
pnpm verify:release
pnpm release:update
```

`pnpm verify:release` 是发布检查命令，会运行类型检查、测试、Web zip 冒烟流程和 Windows 安装包打包。

## 运行目录

- 内置 Godot 引擎：`engine/`
- 内置 Godot 模板：`gameaistudio_template/`
- 用户游戏项目：`%USERPROFILE%\Documents\GameAIStudio\projects`
- 工作室状态文件：`%USERPROFILE%\Documents\GameAIStudio\studio-state.json`
- 应用维护日志：`%USERPROFILE%\Documents\GameAIStudio\logs\app.log`
- 更新安装包缓存：`%APPDATA%\GameAIStudio\updates\<version>\`
- 用户更新配置：`%APPDATA%\GameAIStudio\update.env`

开发时可以设置 `GAMEAISTUDIO_HOME` 覆盖用户数据目录。
测试资源解析时，可以设置 `GAMEAISTUDIO_RESOURCE_ROOT` 指向包含 `engine/` 和 `gameaistudio_template/` 的目录。

## 软件更新

GameAIStudio 使用自定义 JSON 更新清单。打包后的应用会在 asar 内包含一份内置 `.env`，用于提供首次更新服务器地址。后续版本可以通过服务端返回的 `nextEnv`，把新的更新配置写入 Electron `userData` 目录中的 `update.env`。

### 更新配置读取优先级

应用按以下顺序读取更新配置：

```text
1. %APPDATA%\GameAIStudio\update.env
2. 打包应用内置的 .env
3. 进程环境变量或默认值
```

内置 `.env` 示例：

```env
GAMEAISTUDIO_UPDATE_MANIFEST_URL=https://updates.example.com/gameaistudio/update.json
GAMEAISTUDIO_UPDATE_CHANNEL=stable
```

`project/.env` 会被包含进安装包。正式发布前，需要把 `GAMEAISTUDIO_UPDATE_MANIFEST_URL` 填成真实可访问的更新清单地址。

### 版本策略

版本号格式：

```text
major.minor.patch
大版本.小版本.迭代版本
```

更新策略：

- `1.4.3 -> 1.4.4`：迭代版本更新，用户可以在关于弹层里手动更新。
- `1.4.3 -> 1.5.0`：小版本更新，强制更新。
- `1.4.3 -> 2.0.0`：大版本更新，强制更新。
- `force: true` 或 `minSupportedVersion` 高于当前版本时，也会强制更新。

当存在强制更新时，应用会打开关于弹层，并阻止继续创建游戏、运行团队工作流和发送 Agent 对话，直到用户完成更新。

### 更新清单

服务器返回 JSON：

```json
{
  "appId": "com.gameaistudio.desktop",
  "channel": "stable",
  "latestVersion": "1.5.0",
  "minSupportedVersion": "1.4.0",
  "releaseDate": "2026-06-10T12:00:00+08:00",
  "releaseNotes": "修复本地 CLI 调用，增强项目日志。",
  "packages": [
    {
      "platform": "win32",
      "arch": "x64",
      "url": "https://cdn.example.com/GameAIStudio-Setup-1.5.0.exe",
      "sha256": "<installer-sha256>",
      "size": 180000000
    }
  ],
  "nextEnv": {
    "content": "GAMEAISTUDIO_UPDATE_MANIFEST_URL=https://updates.example.com/gameaistudio/update.json\nGAMEAISTUDIO_UPDATE_CHANNEL=stable\n",
    "sha256": "<next-env-sha256>",
    "effective": "nextLaunch"
  }
}
```

必填字段：

- `latestVersion`
- `packages[].platform`
- `packages[].arch`
- `packages[].url`
- `packages[].sha256`

打包后的正式应用只接受 HTTPS 更新清单地址和 HTTPS 安装包地址。开发模式下允许使用 localhost HTTP，方便本地测试。

### 发布更新步骤

1. 设置或确认 `project/.env` 中的 `GAMEAISTUDIO_UPDATE_MANIFEST_URL`。
2. 选择发布版本命令：

```powershell
pnpm release:update
pnpm release:update:patch
pnpm release:update:minor
pnpm release:update:major
pnpm release:update:version -- 1.2.3
```

版本规则：

- `pnpm release:update` 默认等同于 `patch`，例如 `0.1.0 -> 0.1.1`，可选更新。
- `pnpm release:update:patch` 发布迭代版本，可选更新。
- `pnpm release:update:minor` 发布小版本，强制更新。
- `pnpm release:update:major` 发布大版本，强制更新。
- `pnpm release:update:version -- 1.2.3` 发布精确版本；只变 patch 时可选，变 minor/major 时强制。

3. 配置更新日志。短说明可以直接传参数：

```powershell
pnpm release:update -- --notes "修复本地 CLI 调用失败，优化更新弹层。"
```

多行更新日志可以写入 `release-notes.md`，发布脚本会自动读取：

```markdown
# GameAIStudio 0.1.1 更新日志

- 修复本地 AI CLI 调用时的路径和权限问题。
- 优化软件更新检查和安装包下载流程。
- 增强项目日志，方便定位 Agent 执行失败原因。
```

也可以显式指定文件：

```powershell
pnpm release:update -- --notes-file release-notes.md
```

脚本会把更新日志写入 `update.json` 的 `releaseNotes`，软件关于弹层里的“更新日志”区域会展示这段内容。示例文件见 `release-notes.example.md`。

4. 命令会自动更新 `package.json` 中的 `version`，执行 Windows 打包，复制安装包到 `../server/gameaistudio/releases/`，生成 `../server/gameaistudio/update.json`，并上传到服务器 `/var/www/gameaistudio/`。
5. 如果只想检查发布计划，不写文件也不打包，可以执行：

```powershell
pnpm release:update -- --dry-run
```

6. 如需完整发布检查，也可以单独运行：

```powershell
pnpm verify:release
```

7. 用浏览器检查：

```text
https://www.legoumarket.cloud/gameaistudio/update.json
https://www.legoumarket.cloud/gameaistudio/releases/GameAIStudio-Setup.exe
```

8. 打开旧版本应用的关于弹层，点击 `检查更新`。

固定下载包 `GameAIStudio-Setup.exe` 不带版本号，便于对外传播；更新清单里的安装包可以继续使用 `GameAIStudio-Setup-x.x.x.exe`，便于定位和回滚。

如果服务器返回 `nextEnv`，应用会校验它的 SHA-256，并写入 `%APPDATA%\GameAIStudio\update.env`。下次启动时，应用会优先读取用户目录里的更新配置，再读取内置 `.env`。

所有更新检查、清单下载、`nextEnv` 写入、安装包下载、哈希校验和安装器启动都会记录到 `logs/app.log`。

## 发布打包

`pnpm dist:win` 会生成命名清晰的 NSIS 安装包，路径为 `dist/GameAIStudio-Setup-<version>.exe`。打包流程会使用生成好的 GameAIStudio 应用图标，把 `engine/` 和干净的 `gameaistudio_template/` 复制进 Electron `resources/`，并排除旧的 `.godot`、`build`、`dist` 输出目录。

`pnpm smoke:templates` 会使用与应用相同的清理规则复制内置 2D/3D 模板，通过内置 Godot 控制台校验模板，并验证 Web 导出文件。

`pnpm smoke:webzip` 会继续执行导出清单生成和 Web zip 打包流程，覆盖 2D 和 3D 模板。

## 当前应用能力

- 可从内置模板创建 2D 或 3D Godot 项目，并可默认在创建后立即启动团队工作流。
- 复制干净的 Godot 模板源码到新项目，排除历史模板运行产生的 `.godot`、`build`、`dist` 产物。
- 在复制模板前校验所选模板的 `project.godot` 和 Web 导出预设。
- 创建并生成游戏前，会检查本地 AI CLI 可用性、所选 Godot 模板可用性，以及 Web 预览和导出准备状态。
- 展示 Git 和 Node.js 的系统环境健康状态，支持刷新诊断，并提供清晰的缺失工具提示。
- 展示内置 Godot 运行时健康状态，包括引擎目录、GUI/控制台可执行文件、版本探测，以及 2D/3D 模板的 Web 导出预设。
- 可从桌面 UI 使用内置 Godot GUI 可执行文件打开当前项目。
- 可从系统 PATH 发现 Codex、Claude、KSCC、Kimi。
- 展示本地 CLI 健康诊断，包括命令发现、安装管理器可用性、npm 全局 PATH 提示和常见凭据环境变量，并使用发现到的安装管理器执行一键安装。
- 可在项目目录内以指定角色运行选中的本地 CLI Agent。
- 每次 Agent 回合前都会准备 `.gameaistudio/agent-context.md`，内容包含项目文件图谱、最近对话、角色上下文、交付状态和响应契约。Agent CLI 提示词会引用该文件，不再把完整上下文塞进命令行参数。
- Agent 回合结束后会追加 `.gameaistudio/agent-journal.md`，并把最近日志尾部注入下一次 Agent 上下文，让制作人、策划、程序、美术、QA 能通过项目本地状态交接。
- 创建项目时会初始化 `GAMEAISTUDIO.md`、`.gameaistudio/agent-context.md` 和 `.gameaistudio/agent-journal.md`，并在项目状态面板提供快捷入口，可在二级弹层中预览这些文件。
- 支持在应用内预览文本文件、图片、变更文件和 Agent 图片附件，同时把预览路径限制在所选项目目录内。
- 桌面打开路径失败时会在 UI 中提示，不会静默忽略缺失的 zip、清单、Agent 上下文或日志文件。
- 保持生成的 Godot 项目中的 `.gameaistudio/project.json` 与最新预览和导出元数据同步，同时不覆盖 `GAMEAISTUDIO.md` Agent 笔记。
- 运行五角色团队工作流：制作人、策划、程序、美术、QA。每个角色会优先使用默认本地 CLI，创建和构建前会预览路由，必要时回退到已安装工具，然后执行 Web 导出、Web 构建产物检查、Web zip 打包和预览刷新。
- 每次团队工作流后都会追加系统摘要，让对话区展示导出、产物检查、zip、预览和后续状态。
- 持久化 Agent 运行记录，把运行状态和输出流式推送到桌面 UI，并支持取消正在运行的本地 CLI。
- 提供 Codex 风格的项目对话区，支持图片附件。附件图片会保存到项目中，并在本地 AI CLI 提示词中引用，方便具备视觉能力的 CLI 使用。
- 捕获每个 Agent 对 Godot 项目文件的变更，并在对话和运行时间线中展示。
- 使用 Git 管理项目版本：新项目会初始化 `.gitignore` 和初始提交，已有项目可以启用 Git、查看分支和 HEAD、查看变更文件、查看最多五次最近提交、提交版本，以及从右侧 Git 面板还原任意有效提交。
- 可从桌面 UI 删除已创建的游戏项目，删除前会提示生成的本地 Godot 目录也会一起删除。
- 监听 Godot 项目文件变化，并在源码或资源变更后刷新 Web 预览。
- 预览事件后会重新加载内嵌预览页面，并使用 no-cache 响应头减少迭代时的旧 Web 构建缓存。
- 本地预览 HTTP 请求会被限制在生成的 Web 构建目录内。
- 如果 Web 构建目录或 `index.html` 缺失，预览启动会给出清晰错误。
- 单个 Agent 回合修改了预览相关 Godot 文件后，可以自动启动或刷新 Web 预览。
- 初始自动预览导出失败时会明确提示，不会启动陈旧或缺失的预览构建。
- Web zip 导出经过校验、Godot Web 导出、Web 产物检查和 zip 打包流程，并在 UI 中展示运行步骤。
- 使用 Windows 安全的文件名导出 Web zip，普通项目名即使包含标点也能正常打包。
- 把最新 Web zip 展示为构建交付物，并提供快捷操作打开 zip、导出目录或每个 zip 内包含的 `gameaistudio-export.json` 清单。
- 持久化并展示最新 Web 构建产物检查结果，让用户看到导出是否包含必需的 HTML、wasm 和 pck 文件。
- 通过本地预览服务器提供 `build/web/index.html`。
- 使用 Godot Web 导出并把 `build/web` 打包成 zip。
- 可在关于弹层检查软件更新，读取内置 `.env` 或用户目录 `update.env`，下载 JSON 更新清单，校验安装包 SHA-256，支持可选迭代更新，并在小版本或大版本更新时强制用户先更新再继续创建游戏。
