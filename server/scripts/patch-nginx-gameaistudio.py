from pathlib import Path

path = Path("/etc/nginx/sites-available/leaderboard")
include_line = "    include /etc/nginx/snippets/gameaistudio-static.conf;"
targets = {
    "server_name 101.33.218.121;",
    "server_name www.legoumarket.cloud;",
}

content = path.read_text(encoding="utf-8")
if "gameaistudio-static.conf" not in content:
    lines = content.splitlines()
    output = []
    for line in lines:
        output.append(line)
        if line.strip() in targets:
            output.append(include_line)
    path.write_text("\n".join(output) + "\n", encoding="utf-8")
