# GameAIStudio

GameAIStudio 是一个重新编写的桌面端 AI 游戏创造平台，面向普通用户使用。用户选择 2D 或 3D 后，用一句话描述游戏想法，软件会从内置模板创建 Godot 项目，调度本机 AI CLI Agent 协作生成内容，预览 Web 构建结果，并导出可运行的 Web zip。

桌面应用代码位于 `project/` 目录。

## 快速开始

```powershell
cd project
pnpm install
pnpm dev
```

常用开发命令：

```powershell
cd project
pnpm typecheck
pnpm test
pnpm build
pnpm dist:win
pnpm release:update
```

`pnpm dev` 会以开发模式启动 Electron 桌面应用。`pnpm build` 会把应用编译输出到 `project/out/`。`pnpm dist:win` 会生成 Windows NSIS 安装包，路径为 `project/dist/GameAIStudio-Setup-<version>.exe`。

`pnpm dist:win` 默认使用离线打包模式：Electron 使用本地 `node_modules/electron/dist`，Windows 签名跳过在线时间戳，避免打包时因为 GitHub 或时间戳服务器 TLS 抖动失败。如果首次打包缺少 electron-builder 的 NSIS/winCodeSign 缓存，可以先执行一次：

```powershell
cd project
pnpm dist:win:online
```

## 软件更新流程

GameAIStudio 使用自定义更新清单，不在应用代码里写死安装包下载地址。

1. 打包后的应用首次启动时，会读取随 asar 一起打包的 `project/.env`。
2. 如果 `%APPDATA%\GameAIStudio\update.env` 存在，则优先使用用户目录里的配置。
3. 应用会下载 `GAMEAISTUDIO_UPDATE_MANIFEST_URL` 指向的 JSON 更新清单。
4. 更新清单会告诉应用最新版本号、更新说明、安装包地址、SHA-256，以及可选的下一份 `nextEnv`。
5. 迭代版本更新，例如 `1.4.3 -> 1.4.4`，由用户在关于弹层里手动更新。
6. 小版本或大版本更新，例如 `1.4.3 -> 1.5.0` 或 `2.0.0`，会被视为强制更新。
7. 应用下载安装包后会校验 SHA-256，校验通过后启动安装程序，并在安装结束后重启应用。

内置 `.env` 示例：

```env
GAMEAISTUDIO_UPDATE_MANIFEST_URL=https://your-update-host.example.com/gameaistudio/update.json
GAMEAISTUDIO_UPDATE_CHANNEL=stable
GAMEAISTUDIO_UPDATE_ALLOW_INSECURE=false
```

发布脚本 `release.env` 示例：

```env
GAMEAISTUDIO_RELEASE_BASE_URL=https://your-update-host.example.com/gameaistudio
GAMEAISTUDIO_RELEASE_SSH_HOST=your-ssh-host
GAMEAISTUDIO_RELEASE_REMOTE_DIR=/var/www/gameaistudio
```

服务器地址只放在配置里，不写死在应用代码或发布脚本中。`project/.env` 会被打包进应用，`project/release.env` 只供发布脚本读取，不会打进安装包。如需 IP + 端口直连的 HTTP 更新源，必须显式配置 `GAMEAISTUDIO_UPDATE_ALLOW_INSECURE=true`；正式公开发布建议使用 HTTPS 域名更新源。

更新清单示例：

```json
{
  "latestVersion": "1.5.0",
  "minSupportedVersion": "1.4.0",
  "releaseNotes": "修复本地 CLI 调用，增强项目日志。",
  "packages": [
    {
      "platform": "win32",
      "arch": "x64",
      "url": "https://cdn.example.com/GameAIStudio-Setup-1.5.0.exe",
      "sha256": "<installer-sha256>",
      "size": 180000000
    }
  ]
}
```

## 当前 MVP

- 使用 Electron、Vite、React 构建 Windows 桌面端外壳。
- 内置 Godot 2D 和 3D 模板，可复制到用户的 GameAIStudio 工作目录。
- 内置 Godot 运行时诊断、项目打开、Web 导出、预览和 zip 打包能力。
- 在桌面 UI 中展示 Git 和 Node.js 环境诊断。
- 支持 Codex、Claude、KSCC、Kimi 的本地 CLI 发现和安装诊断。
- 提供制作人、策划、程序、美术、QA 的 Agent 工作流，支持 Codex 风格对话、图片附件、流式输出、取消运行和文件变更摘要。
- 使用 Git 管理项目版本：新项目会尝试自动初始化仓库，UI 最多显示最近五次提交，用户可以提交版本，也可以还原到任意有效提交。
- 支持在应用内预览项目说明、Agent 上下文、Agent 日志、变更文件和图片附件。
- 支持删除已创建游戏项目，删除前会二次确认，并同时删除本地生成的 Godot 项目目录。
- 每个项目会维护本地 AI 上下文文件：`GAMEAISTUDIO.md`、`.gameaistudio/agent-context.md`、`.gameaistudio/agent-journal.md`。
- 支持 Web 导出检查、`gameaistudio-export.json` 清单生成，以及 Windows 安全的 Web zip 文件名。
- 关于弹层支持应用内检查更新，读取内置 `.env` 和用户目录 `update.env`，下载 JSON 更新清单，校验 SHA-256，支持可选迭代更新和强制小版本、大版本更新。

## 发布检查

```powershell
cd project
pnpm verify:release
```

发布检查会运行类型检查、测试、2D/3D Web zip 冒烟测试和 Windows 安装包打包。Windows 打包成功后会生成 `project/dist/GameAIStudio-Setup-<version>.exe`。

## 发布更新

最小可用更新服务器资源位于 `server/` 目录。更新服务根地址由 `project/release.env` 中的 `GAMEAISTUDIO_RELEASE_BASE_URL`、`project/.env` 中的 `GAMEAISTUDIO_UPDATE_MANIFEST_URL`，或命令行参数 `--server-url` 决定。

在 `project/` 目录执行：

```powershell
pnpm release:update
```

默认会发布下一个 patch 版本，例如 `0.1.0 -> 0.1.1`，这是可选更新，并会自动上传到服务器。其他命令：

```powershell
pnpm release:update:patch
pnpm release:update:minor
pnpm release:update:major
pnpm release:update:version -- 1.2.3
```

更新前可以配置更新日志。短说明可以直接传参数：

```powershell
pnpm release:update -- --notes "修复本地 CLI 调用失败，优化更新弹层。"
```

多行更新日志可以写入 `project/release-notes.md`，发布脚本会自动读取；也可以显式指定文件：

```powershell
pnpm release:update -- --notes-file release-notes.md
```

生成的 `update.json` 会写入 `releaseNotes`，软件关于弹层里的“更新日志”区域会展示这段内容。可以参考 `project/release-notes.example.md`。

规则：

- `patch`：迭代版本，可选更新。
- `minor`：小版本，强制更新。
- `major`：大版本，强制更新。
- 精确版本：按版本差异判断；只变 patch 时可选，变 minor/major 时强制。

命令会更新 `project/package.json` 版本号，执行 Windows 打包，复制安装包到 `server/gameaistudio/releases/`，生成 `server/gameaistudio/update.json`，并上传到 `GAMEAISTUDIO_RELEASE_SSH_HOST:GAMEAISTUDIO_RELEASE_REMOTE_DIR`。

固定下载链接：

```text
${GAMEAISTUDIO_RELEASE_BASE_URL}/releases/GameAIStudio-Setup.exe
```

固定下载包不带版本号，便于对外传播；更新清单里的安装包仍使用带版本号的文件名，便于定位和回滚。
