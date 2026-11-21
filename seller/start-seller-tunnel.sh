#!/usr/bin/env bash
# SpendSeal demo launcher (Plan A): seller on this machine + Cloudflare
# quick tunnel for a public https URL. No accounts, no card.
# Prereqs: node >= 20, cloudflared in PATH (single binary, cloudflare.com/downloads)
set -euo pipefail
cd "$(dirname "$0")"

if [ -f seller.env ]; then set -a; . ./seller.env; set +a; fi
command -v cloudflared >/dev/null || { echo "缺 cloudflared：到 https://github.com/cloudflare/cloudflared/releases 下载对应系统的单文件，改名 cloudflared 放进 PATH"; exit 1; }
[ -d node_modules ] || npm install --no-audit --no-fund

node src/server.js & SELLER_PID=$!
TUNNEL_PID=""
cleanup() { kill "$SELLER_PID" "$TUNNEL_PID" 2>/dev/null || true; }
trap cleanup EXIT

for i in $(seq 1 30); do
  curl -sf http://localhost:8787/health >/dev/null && break
  sleep 0.5
done
echo "卖家已在本机启动：http://localhost:8787"

# --protocol http2: force TCP transport. The default QUIC (UDP 7844) gets
# dropped by many CN/carrier networks, which showed up as tunnels dying
# within a minute of starting (edge flips to Error 1033).
cloudflared tunnel --protocol http2 --url http://localhost:8787 > tunnel.log 2>&1 &
TUNNEL_PID=$!
URL=""
for i in $(seq 1 40); do
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' tunnel.log | head -1 || true)
  [ -n "$URL" ] && break
  sleep 0.5
done
if [ -z "$URL" ]; then echo "隧道没起来，看 tunnel.log 排查"; exit 1; fi

echo ""
echo "=================================================="
echo " 公网地址（发给分析师验收 / 填进桥的 SELLER_API_BASE）："
echo "   $URL"
echo " 本机直连（Claude Desktop 在同一台机器时优先用这个）："
echo "   http://localhost:8787"
echo " Ctrl+C 结束（卖家与隧道会一起关）"
echo "=================================================="
wait
