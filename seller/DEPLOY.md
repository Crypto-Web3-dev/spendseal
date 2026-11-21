# 卖家 API 部署

## 定案（2026-11-21）：方案 A — 演示机本地跑 + Cloudflare 快速隧道

Fly.io 注册时触发 high-risk 验证、要求绑卡，Kevin 当场放弃 Fly（账号未绑卡、无费用产生）。Hugging Face Spaces 备选已评估但未采用。最终：**卖家跑在演示笔记本上**，Claude Desktop 同机走 `localhost:8787` 为演示主线（2026-11-21 Kevin 拍板，方案 ②）。隧道降级为可选备用且实测建不起来：Kevin 本机 DNS（10.255.255.254，疑似 WSL 解析器）解析不了 cloudflared 的 argotunnel SRV 记录、api.cloudflare.com:443 亦不通（cloudflared 预检 hard fail）——根源在网络 DNS，非脚本问题；换网络可再试。一键脚本 `start-seller-tunnel.sh` 保留（卖家照常启动，隧道部分失败不影响本地），使用说明见 `A-README.md`。

---

以下 Fly/Render 内容保留作存档（部署包已验证、随时可重启这条路线）：

# 卖家 API 上云部署（Fly.io / Render 备选，存档）

状态：**部署包已就绪并本地验证**——Dockerfile、fly.toml、render.yaml 齐全；已用「纯环境变量、无 .env 文件」的方式冷启动并跑通完整 e2e（云端形态与本地代码路径完全一致）。剩下唯一需要 Kevin 的是云平台账号（注册/绑卡/登录只能本人完成），其余命令照抄即可。

## 为什么选 Fly.io

卖家是**有状态的单进程服务**（发票与 nonce 消费记录在内存里）＋需要常驻无头 Chromium。Serverless（Vercel/Workers）会出现跨实例状态不一致与浏览器受限问题，故不用；Docker 容器平台是正确形态。Fly.io 香港区（hkg）离广州现场最近；Render 是等价备选。

## Fly.io 部署（约 10 分钟）

```bash
# 1) 装 CLI 并登录（Kevin 本人操作一次）
curl -L https://fly.io/install.sh | sh
fly auth login

# 2) 在 seller 目录里创建应用（用仓库里的 fly.toml，不要覆盖）
cd ~/workspace/spendseal/seller
fly launch --copy-config --no-deploy   # app 名被占用就改 fly.toml 里的 app 名

# 3) 注入密钥（值来自仓库根 .env，不要写进任何文件提交）
fly secrets set \
  VAULT_ADDRESS=0x88817cf2ef5afa8497f6a95deb04fa7ce8f47cf1 \
  SELLER_ADDRESS=<.env 的 SELLER_ADDRESS> \
  SELLER_PRIVATE_KEY=<.env 的 SELLER_PRIVATE_KEY> \
  ATTACKER_ADDRESS=<.env 的 ATTACKER_ADDRESS> \
  MONAD_RPC_URL=https://testnet-rpc.monad.xyz

# 4) 部署
fly deploy

# 5) 验收（应返回 ok:true 和价格 50000）
curl https://<你的-app>.fly.dev/health
curl "https://<你的-app>.fly.dev/api/screenshot?url=https://example.com"   # 应返回 402 + 签名发票
```

关键约束（已写进 fly.toml，勿改）：**只能跑 1 台机器**（`min_machines_running = 1`、不要开 autoscale 到多台）——发票内存态，多实例会互相不认账。内存给 1GB 是为 Chromium。

## Render 备选

Render 控制台 → New → Blueprint → 选本仓库 → 它会读 `render.yaml`；在控制台补填标了 `sync: false` 的四个环境变量即可。同样保持 `numInstances: 1`。

## 部署后要改的两个地方

1. **MCP 桥**：Claude Desktop 配置里把 `SELLER_API_BASE` 改成云端地址（如 `https://spendseal-seller.fly.dev`），本地彩排与现场演示就都走云端卖家，不再依赖本机进程。
2. **演示目标页**：云端卖家截 `http://localhost:8787/demo-page` 会失效（那是它自己的本机）。上云后兜底目标页改用云端自身的 `https://<app>.fly.dev/demo-page`，或直接截公网页面。

## 仍未做（如实）

- 本机没有 Docker，镜像构建未在本机实跑；已验证等价的 env-only 冷启动 + 全量 e2e。首次 `fly deploy` 时若镜像构建报错（多半是 Chrome 依赖），按报错补 apt 包即可，`npx puppeteer browsers install chrome --install-deps` 是 Puppeteer 官方流程。
- 无自定义域名/HTTPS 证书配置（平台默认域名自带 HTTPS，够演示用）。
