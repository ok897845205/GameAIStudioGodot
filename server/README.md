# GameAIStudio 最小可用更新服务器

这个目录用于生成和暂存可以直接上传到服务器的静态更新资源。目标服务器域名为：

```text
https://www.legoumarket.cloud
```

推荐服务器目录：

```text
/var/www/gameaistudio/
  update.json
  releases/
    GameAIStudio-Setup-x.x.x.exe
```

对外访问地址：

```text
https://www.legoumarket.cloud/gameaistudio/update.json
https://www.legoumarket.cloud/gameaistudio/releases/GameAIStudio-Setup-x.x.x.exe
```

## 本地生成更新资源

在 `project/` 目录执行：

```powershell
pnpm release:update
```

默认行为是发布下一个 patch 版本，例如 `0.1.0 -> 0.1.1`，这是可选更新，并会自动上传到 `tencent-clawdbot:/var/www/gameaistudio/`。

其他命令：

```powershell
pnpm release:update:patch
pnpm release:update:minor
pnpm release:update:major
pnpm release:update:version -- 1.2.3
```

更新日志说明：

- 短说明：`pnpm release:update -- --notes "修复本地 CLI 调用失败，优化更新弹层。"`
- 多行说明：在 `project/release-notes.md` 中编写，发布脚本会自动读取。
- 指定文件：`pnpm release:update -- --notes-file release-notes.md`

这些内容会写入 `update.json` 的 `releaseNotes` 字段，并在软件关于弹层的“更新日志”区域展示。

规则：

- `patch`：迭代版本，可选更新。
- `minor`：小版本，强制更新。
- `major`：大版本，强制更新。
- 精确版本：按当前版本和目标版本的差异判断；只变 patch 时可选，变 minor/major 时强制。

生成结果：

```text
server/gameaistudio/update.json
server/gameaistudio/releases/GameAIStudio-Setup-x.x.x.exe
server/gameaistudio/releases/GameAIStudio-Setup.exe
```

`GameAIStudio-Setup.exe` 是固定下载地址使用的安装包文件名，便于传播；带版本号的安装包用于更新清单，便于定位和回滚。

`releases/` 中的安装包和生成的 `update.json` 默认被 Git 忽略，避免把大文件和每次发布状态误提交。

## 上传到服务器

可以使用 VS Code Remote SSH，也可以用命令上传：

```powershell
scp -i C:\Users\KSG\.ssh\leezs.pem -r .\server\gameaistudio\* ubuntu@101.33.218.121:/var/www/gameaistudio/
```

正常情况下不需要手动上传，`pnpm release:update*` 命令会自动上传。只想生成本地文件时可以执行：

```powershell
pnpm release:update:local
```

上传后用浏览器检查：

```text
https://www.legoumarket.cloud/gameaistudio/update.json
https://www.legoumarket.cloud/gameaistudio/releases/GameAIStudio-Setup.exe
```

## Nginx

`nginx/gameaistudio.conf` 是最小可用 Nginx 示例。首次部署时可以放到：

```text
/etc/nginx/sites-available/gameaistudio.conf
```

然后创建软链接到：

```text
/etc/nginx/sites-enabled/gameaistudio.conf
```

检查并重载：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

正式环境需要使用 HTTPS，建议通过 certbot 为 `www.legoumarket.cloud` 配置证书。

如果服务器已经有自己的 `www.legoumarket.cloud` 站点，可以把 `nginx/gameaistudio-static-snippet.conf` include 到现有 `server` 块里，这样不会覆盖原来的 `/api/` 等服务。
