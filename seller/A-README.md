# SpendSeal 卖家 — 本地主线版（方案 A 定案）

**正式演示不需要公网、不需要隧道。** Claude Desktop、MCP 桥、卖家都在同一台演示机上，桥配置 `SELLER_API_BASE=http://localhost:8787` 即可完成全部演示。隧道只是「让其他设备也能访问」的备用件（见文末），修不好不影响演示。

## 启动卖家（每次演示）

```bash
cd seller
node src/server.js        # 或 bash start-seller-tunnel.sh 只起卖家也行，隧道失败不影响本地
```

首次先装依赖：`npm install`。环境变量已在 `seller.env` 里备好，启动脚本会自动读；手动启动时先 `set -a; . ./seller.env; set +a`。

自检：浏览器打开 http://localhost:8787/health 应返回 `{"ok":true,...}`。

## 桥的配置

Claude Desktop 配置里保持：
- `SELLER_API_BASE` = `http://localhost:8787`
- `PASSPORT_ID` = `1`（演示护照）

## 备用：Cloudflare 快速隧道（可选，已知有坑）

`bash start-seller-tunnel.sh` 会同时尝试开隧道并打印公网地址。已知问题（2026-11-21 实测）：Kevin 本机 DNS（10.255.255.254，疑似 WSL 解析器）无法解析 cloudflared 需要的 argotunnel SRV 记录，且 api.cloudflare.com:443 不通，隧道在该网络下建不起来——根源在网络 DNS，不在脚本。若换到其他网络（如现场 Wi-Fi、手机热点）可以再试，成了就是赚的，不成不影响主线。

## 注意

- `seller.env` 含卖家测试私钥（测试网演示密钥），别外传这个包。
- 卖家发票状态在内存里：重启卖家后，旧发票作废，重新走购买流程即可。
