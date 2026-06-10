import os
from pathlib import Path

path = Path("/etc/nginx/sites-available/leaderboard")
include_line = "    include /etc/nginx/snippets/gameaistudio-static.conf;"
target_names = [name.strip() for name in os.environ.get("GAMEAISTUDIO_NGINX_SERVER_NAMES", "").split(",") if name.strip()]
if not target_names:
    raise SystemExit("请先设置 GAMEAISTUDIO_NGINX_SERVER_NAMES，例如：example.com,127.0.0.1")
targets = {f"server_name {name};" for name in target_names}

content = path.read_text(encoding="utf-8")
if "gameaistudio-static.conf" not in content:
    lines = content.splitlines()
    output = []
    for line in lines:
        output.append(line)
        if line.strip() in targets:
            output.append(include_line)
    path.write_text("\n".join(output) + "\n", encoding="utf-8")
