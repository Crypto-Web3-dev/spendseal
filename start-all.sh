#!/usr/bin/env bash
# SpendSeal 一键启动：卖家 + 控制台，并打印 Windows 浏览器该用的地址。
# 用法：bash start-all.sh [护照号]   （默认 1）
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PASSPORT="${1:-1}"

# 1) 卖家（付费截图 API，端口 8787）
if curl -sf -m 2 http://localhost:8787/health >/dev/null 2>&1; then
  echo "[卖家] 已在运行（http://localhost:8787）"
else
  (cd "$ROOT/seller" && node src/server.js > /tmp/spendseal-seller.log 2>&1) &
  echo "[卖家] 已启动，日志 /tmp/spendseal-seller.log"
fi

# 2) 控制台（静态单页，端口 8080）
if curl -sf -m 2 http://localhost:8080/ >/dev/null 2>&1; then
  echo "[控制台] 已在运行（http://localhost:8080）"
else
  (cd "$ROOT/web" && python3 -m http.server 8080 > /tmp/spendseal-console.log 2>&1) &
  echo "[控制台] 已启动，日志 /tmp/spendseal-console.log"
fi

# 给两个服务一点起的时间
sleep 2

# 3) 打印 Windows 浏览器要用的地址（WSL2 的 localhost 转发本机不可靠）
WSL_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo ""
echo "=================================================="
echo " 卖家健康检查 : http://localhost:8787/health"
echo " 控制台(本机) : http://localhost:8080/?passport=${PASSPORT}"
[ -n "${WSL_IP:-}" ] && echo " 控制台(Win浏览器): http://${WSL_IP}:8080/?passport=${PASSPORT}"
echo "=================================================="
echo "注意："
echo " - 控制台首屏要 12-17 秒出数据（公共 RPC 慢），别以为坏了"
echo " - 非 #1/#2 护照用 ?passport=<号> 打开（页面按钮只有 #1/#2）"
echo " - 按 Ctrl+C 不会自动停掉后台服务；停服务用 pkill -f 'src/server.js|http.server 8080'"
