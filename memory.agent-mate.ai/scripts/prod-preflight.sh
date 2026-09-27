#!/usr/bin/env bash
# prod-preflight.sh —— 生产机（野草云4）**只读预检**：收集现状，不改任何东西（Sprint 5 `#10` 的第 0 步）
#
# 用法（在你的**本机**执行，脚本经 stdin 送到生产机）：
#   ssh <生产机> 'bash -s' < memory.agent-mate.ai/scripts/prod-preflight.sh
#
# ⚠️ 纪律：本脚本**只读** —— 不安装、不创建、不改配置、不读任何密文（env / key / 凭据一律不碰）。
#    输出里若有公网 IP / 域名，回传前请自行打码（仓内有 `make secret-check` 兜底，双向谨慎更好）。

set -u

say() { printf '\n=== %s ===\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1 && echo 'OK' || echo 'NO'; }

say '身份与主机'
printf '当前用户: %s (uid=%s)\n' "$(id -un 2>/dev/null || echo '?')" "$(id -u 2>/dev/null || echo '?')"
printf '架构: %s\n' "$(uname -m)"
printf '内核: %s\n' "$(uname -r)"
if [ -r /etc/os-release ]; then
  grep -E '^(PRETTY_NAME|VERSION_ID)=' /etc/os-release | sed 's/^/  /'
fi

say '资源'
printf 'CPU 核数: %s\n' "$(nproc 2>/dev/null || echo '?')"
( free -h 2>/dev/null || vm_stat 2>/dev/null ) | head -3 | sed 's/^/  /'
df -h / /var /opt 2>/dev/null | sed 's/^/  /'

say 'Docker'
if command -v docker >/dev/null 2>&1; then
  docker --version 2>&1 | sed 's/^/  /'
  ( docker compose version 2>&1 || docker-compose --version 2>&1 ) | head -1 | sed 's/^/  /'
  docker info --format '{{.ServerVersion}} · 驱动={{.Driver}} · 根目录={{.DockerRootDir}}' 2>&1 | head -1 | sed 's/^/  /'
else
  printf '  docker: 未安装\n'
fi

say '运行中的容器（前 10）'
if command -v docker >/dev/null 2>&1; then
  docker ps --format '  {{.Names}} | {{.Image}} | {{.Status}}' 2>&1 | head -10
  printf '  容器总数: %s\n' "$(docker ps -aq 2>/dev/null | wc -l | tr -d ' ')"
fi

say '已有镜像（前 10）'
if command -v docker >/dev/null 2>&1; then
  docker images --format '  {{.Repository}}:{{.Tag}} | {{.Size}}' 2>&1 | head -10
fi

say '已有 docker 卷'
if command -v docker >/dev/null 2>&1; then
  docker volume ls --format '  {{.Name}} | {{.Driver}}' 2>&1 | head -10
fi

say '生产目录'
for d in /opt/ai-memory /data /srv/portal /var/backups/ai-memory; do
  if [ -d "$d" ]; then
    printf '  %s 存在（%s 项）\n' "$d" "$(ls -A "$d" 2>/dev/null | wc -l | tr -d ' ')"
  else
    printf '  %s 不存在\n' "$d"
  fi
done
if [ -d /data/users ]; then
  printf '  /data/users 下的用户目录数: %s\n' "$(ls -A /data/users 2>/dev/null | wc -l | tr -d ' ')"
fi

say 'cloudflared（隧道）'
if command -v cloudflared >/dev/null 2>&1; then
  cloudflared --version 2>&1 | head -1 | sed 's/^/  /'
else
  printf '  cloudflared: 未安装\n'
fi
systemctl is-enabled cloudflared 2>&1 | sed 's/^/  开机自启: /'
systemctl is-active cloudflared 2>&1 | sed 's/^/  当前状态: /'

say '常用工具'
for c in sqlite3 ossutil git curl make tar gzip; do printf '%s:%s  ' "$c" "$(have "$c")"; done
printf '\n'

say 'OSS 配置（只看是否存在，不读内容）'
if [ -r "$HOME/.ossutilconfig" ]; then
  printf '  ~/.ossutilconfig 存在 · 权限 %s\n' "$(stat -c '%a' "$HOME/.ossutilconfig" 2>/dev/null || stat -f '%Lp' "$HOME/.ossutilconfig" 2>/dev/null || echo '?')"
else
  printf '  ~/.ossutilconfig 不存在（备份外迁要在本机配一份）\n'
fi

say '完成'
printf '（以上全部为只读采集。把这份输出贴回来即可 —— 我会据此给出第一个动手步骤。）\n'
