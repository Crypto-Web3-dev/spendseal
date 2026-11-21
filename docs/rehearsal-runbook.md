# SpendSeal 彩排手册（幕 0–7 操作卡 + 检查清单 + 兜底录屏）

配套定稿脚本：`monad-hackathon/guangzhou-blitz-plan.md` 的 Demo 脚本 `§4 Demo 脚本`（台词以那边为准，本手册只管操作）；舞台当天只带一页版 `stage-cheatsheet.md`。所有命令在仓库 `bridge/` 目录下执行；卖家与控制台都在演示机本地。

> 2026-11-21 按 Kevin 拍板全面改版：脚本重排为幕 0–7（前 30 秒先上真交易、观众自验 QR、观众当黑客、大屏+音效+对比计数器、投票卡收尾），本手册操作卡、检查清单与录屏命名已同步。旧 8 幕版对应关系：旧幕 2 正常付→幕 0；旧幕 1 开场讲解→幕 0 后半+幕 1；旧幕 3 S-G→幕 2；旧幕 4 S-A→幕 3（互动版）；旧幕 5 超限拒→幕 4；旧幕 6 S-B→幕 5（加大屏模拟对比）；旧幕 7 熔断→幕 6；旧幕 8 收尾→幕 7 投票卡。

## 彩排纪律（先读这段）

- **每完整彩排一遍，消耗一张护照的当日额度**（幕 5 会把日限额付满、幕 6 会熔断）。所以：彩排一律用一次性护照——开跑前 `node demo/new-passport.mjs` 新建一张，把 Claude Desktop 配置里的 `PASSPORT_ID` 改成新号、重启 Claude。
- **护照 #1 是正演专用**：11-21 当天不要拿它彩排；正演前把 `PASSPORT_ID` 切回 1 并确认它当日已付为 0。
- 日限额按 **UTC 日**重置 = 北京时间每天 **08:00** 翻页。晚上 19:00–20:00 的正演在同一个 UTC 日内，没问题；但白天彩排别用正演护照。
- 卖家进程彩排期间**不要重启**（发票在内存里，重启后未兑付的发票作废；真重启了就把当前幕重走一遍）。
- **控制台页面开演后不要刷新**：大屏的本场拦截/付款计数口径是「页面打开以来新出现的链上事件」，刷新会清零计数（数字本身在链上不受影响）。另外刷新后首屏还要再等 12–17 秒。
- **首屏慢是正常现象，不是故障**：控制台首屏 12–17 秒（2026-11-21 实测），因为 Monad 公共 RPC 的 `eth_getLogs` 单次就要 2.7–8.3 秒。已做优化：白名单用增量扫描（原来每 4 秒重扫 6000 块，约 30 请求/秒，必然被限流）、首屏只扫最近 600 块、历史在后台补扫、请求限流时自动退避并临时切备用节点。**提前打开、等它出数即可，不要在台上刷新。**

## 开演前检查清单（每次全程彩排/正演前逐项过）

- [ ] **两个服务已用一键脚本起好**：`cd <仓库根>/spendseal && bash start-all.sh <护照号>`（同时起卖家+控制台，自动打印 Windows 浏览器该用的地址；**不用再分别开三个终端**）
- [ ] **确认今天从 Windows 能打开控制台**：用 start-all.sh 打印的「控制台(Win浏览器)」地址（WSL2 的 localhost 转发本机实测不可靠，别硬试 localhost）
- [ ] 控制台在跑：本地静态服务开着 web/index.html，护照号与桥一致，余额/限额读数正常
- [ ] **控制台已加载完并停在正确护照**（**至少提前 60 秒打开**）：首屏要 12–17 秒才出数据——`eth_getLogs` 在公共 RPC 上单次 2.7–8.3 秒（2026-11-21 实测），不是卡死，**不要刷新、不要以为坏了**。判断标准：余额不是 `–`、流水区不再是「读取中…」、白名单列出 4 个已知地址。若用非 #1/#2 的护照，必须用 URL 参数打开（按钮只有 #1/#2）：`http://localhost:8080/?passport=<号>`
- [ ] **当前彩排/正演护照的「拒绝付款上链审计」（logRejections）已打开**（控制台勾选、主人钱包签）——大屏右侧拦截计数靠 PaymentRejected 事件，没开就没数
- [ ] **区块浏览器标签页已预开并过校验**：普通可见的 Chrome 窗口开 `https://testnet.monadvision.com/address/<vault>`，等它自动从「Just a moment…」变成合约详情（**2026-11-21 实测：真实窗口能自动通过，无感人机校验；headless 自动化浏览器会被拦，所以不要用脚本预开**）；幕 1 直接在这个标签页把地址改成 `/tx/<txHash>` 回车
- [ ] **大屏模式就绪**：控制台按 `B` 进大屏，点一下页面解锁音效，用彩排护照放一笔付款试响成功音+盖章、放一笔拒绝试响 buzz；按 `S` 试跑模拟掏空后**再按一次 S 复位待机**
- [ ] Claude Desktop 已按当前护照号配置并重启；先问一句「用 passport_status 看下护照状态」验证桥通
- [ ] 资金：owner/agent/seller 三个地址 MON 余额 > 0.5（gas）；当前护照 USDC 余额 ≥ 1.00、当日已付 = 0
- [ ] MetaMask 已导入主人私钥、网络切到 Monad Testnet（10143），停在控制台页
- [ ] 屏幕：关掉通知/勿扰、浏览器缩放 125%、终端字号 ≥ 18、Claude 字号调大；无关窗口全关
- [ ] 录屏兜底文件夹在桌面可达（见文末清单）；手机热点已连过一次备用

## Windows 浏览器打不开 localhost 时：取 WSL 的 IP

2026-11-21 实测本机 WSL2 的 localhost 转发失效：WSL 内 `curl localhost:8080` 正常，Windows 浏览器访问 `http://localhost:8080` 却一直 loading。

**一条命令拿到今天该用的地址**（在 WSL 里跑，URL 会随 WSL 重启变化）：

```bash
IP=$(hostname -I | awk '{print $1}'); echo "控制台: http://$IP:8080/?passport=1"
```

把打印出来的地址粘进 Windows 浏览器即可。卖家接口不受影响——桥在 WSL 内跑，它访问 `localhost:8787` 是通的；只有**浏览器**这一侧需要换 IP。

**彻底修复（推荐每次彩排前做）**：在 Windows 管理员 PowerShell 里执行 `wsl --shutdown`，等约 10 秒重新进入 WSL，转发规则会重建，之后 `localhost` 通常恢复可用。若仍不行，可用端口转发把 Windows 的 localhost 指到 WSL（IP 变了要重做）：

```powershell
$ip = (wsl hostname -I).Trim().Split()[0]
netsh interface portproxy add v4tov4 listenport=8080 listenaddress=127.0.0.1 connectport=8080 connectaddress=$ip
```

**现场注意**：WSL 一旦重启，IP 会变，之前打开的浏览器标签会失效——按上面第一条命令重新取地址并重新打开，然后**重新走一遍开演前检查清单**（大屏计数会因换页面而清零）。

## 换机器 / 卖家一截图就报错时：Chrome 依赖兜底

卖家靠 Puppeteer 调本地 Chrome 截图。这台演示机已在 2026-11-21 完成安装与验证（截图 188KB、2.2 秒），**正常情况下不用再动**。只有下面两种情况需要重做：

- 把项目复制到另一台 WSL/Ubuntu 机器；
- 卖家日志里出现 `error while loading shared libraries: libnss3.so` 或 `Could not find Chrome (ver. 131.0.6778.204)`。

**第 1 步：确认 Chrome 二进制就位。** 期望路径是 `~/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome`（Puppeteer 只认这个带 `linux-` 前缀的目录名，放错目录会报「Could not find Chrome」）。

```bash
~/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome --version
# 期望：Google Chrome for Testing 131.0.6778.204
```

没有这个目录时，用能连外网的网络装：

```bash
cd spendseal/seller && npx puppeteer browsers install chrome
```

若直连 Google 很慢，可用镜像：
`PUPPETEER_DOWNLOAD_BASE_URL=https://cdn.npmmirror.com/binaries/chrome-for-testing npx puppeteer browsers install chrome`

**第 2 步：补系统库（免 sudo 版，推荐）。** 缺库时 Chrome 会报 `libnss3.so` / `libnspr4.so`。有 sudo 就直接 `sudo apt install -y libnss3 libnspr4`；没有 sudo 时按下面方式解包到用户目录：

```bash
mkdir -p /tmp/debs && cd /tmp/debs
curl -sLO http://archive.ubuntu.com/ubuntu/pool/main/n/nss/libnss3_3.98-1ubuntu0.3_amd64.deb
curl -sLO http://archive.ubuntu.com/ubuntu/pool/main/n/nspr/libnspr4_4.35-1.1build1_amd64.deb
mkdir -p ext && for d in *.deb; do dpkg-deb -x "$d" ext/; done
mkdir -p ~/.local/lib/chrome-deps
cp -a ext/usr/lib/x86_64-linux-gnu/*.so* ~/.local/lib/chrome-deps/
```

**第 3 步：让 Chrome 自己带上库路径（只做一次）。** 在 Chrome 目录里把真实二进制改名 `chrome.real`，原位置放一个 wrapper，这样启动卖家时**不需要**设置任何环境变量：

```bash
CHROME_DIR=~/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64
cd "$CHROME_DIR" && [ -f chrome.real ] || mv chrome chrome.real
cat > chrome <<'EOF'
#!/bin/sh
export LD_LIBRARY_PATH="$HOME/.local/lib/chrome-deps${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$(dirname "$0")/chrome.real" "$@"
EOF
chmod +x chrome && ./chrome --version
```

**第 4 步：端到端验一次（不花钱）。** 先起卖家，再让截图模块直接抓本地 demo 页：

```bash
cd spendseal/seller && node src/server.js &
node -e "import('./src/screenshot.js').then(async m => {
  const png = await m.takeScreenshot('http://localhost:8787/demo-page');
  console.log('PNG', png.length, 'bytes');
  await m.closeBrowser();
})"
```

期望输出 `PNG 18xxxx bytes`（>150KB 即为正常）。看到这个就算是卖家侧完全就绪；截出空白或超时，先查卖家终端日志里的 Chromium 报错。

> 注：上述 deb 版本号是 2026-11-21 在 Ubuntu noble 上实测可用的。换发行版后若链接 404，用 `apt-get download --print-uris libnss3` 取当前可用的地址。

## 幕 0–7 操作卡

> 计数口径：大屏只统计链上 `PaymentRejected`，幕 2/3 的验签拒绝不发交易，计数保持 0，也没有链上拒绝音效；幕 4 开启 `logRejections` 后才出现第一条拒绝事件，计数变 1 并响拒绝音。

### 幕 0 · 先上真交易（0:00–0:30）
- 操作：**不说话、不讲开场白**，直接切 Claude Desktop 输入：**「用 spendseal 买一张 http://localhost:8787/demo-page 的截图给我」**（用自带 demo 页保证必成；想截真实站点把地址换成 example.com，但彩排必须先用 demo 页跑通）。
- 预期画面：Claude 调用 pay_for_api → 对话里出现截图 + 付款摘要（0.05 USDC、txHash）；切控制台大屏：盖章动画 + 成功音效，流水 +1、今日已付 0.05、右侧 QR 换成这笔交易的链接。
- 交易落定后才开口念开场白（全文在速查卡）：先点题「规矩不在提示词里，在合约里」，再接 Visa 句（说「就在本月」，**不说「昨天」**），最后亮护照三参数。
- 翻车处置：若 30 秒没反应，先看卖家终端有没有报错；RPC 卡顿时等一轮自动刷新，**不要重复发指令**（会重复付款）。

### 幕 1 · 拆解 + 链上自验（0:30–0:55）
- 操作：**主画面是浏览器里已打开的交易页**（不是二维码）：从 Claude 的付款摘要复制 txHash，在预先过过校验的标签页里把地址改成 `https://testnet.monadvision.com/tx/<txHash>` 回车，投屏给观众看金额 0.05、收款方、合约地址与 Status: Success；口头拆解六步（402 发票→验签→checkPay→付款→事件验付→发货）。
- 二维码是补充：大屏右侧的 QR 仍会指向同一笔交易，说一句「想自己动手验的可以扫这个码；打开时若弹出人机校验，点一下通过就能看」——**不要把扫码当主环节**，现场手机能否通过校验不可控（2026-11-21 实测：普通可见的浏览器窗口能自动通过，headless 自动化浏览器则会被拦）。
- 顺带亮身份：Agent 在 ERC-8004 上的链上身份编号 **2560**（身份只展示，付款只认护照合约）。
- 预期画面：投屏上的交易页能看到金额 0.05、收款方、合约地址、成功状态。
- 翻车处置：若交易页打不开或又被挑战页拦住，不要当场等——直接念 txHash 与三个字段，并说「交易哈希在这儿，谁都能查」，然后进入幕 2。

### 幕 2 · S-G 篡改发票（0:55–1:25）
- 操作：Claude 输入：**「再买一张，这次用这个接口：/api/tampered-screenshot?url=http://localhost:8787/demo-page」**。
- 预期画面：Claude 报告发票签名验证失败 `invoice_signature_invalid`、没有付款；这是链下拦截，**不发交易、无链上拒绝音效，大屏拦截计数保持 0**；今日已付**仍是 0.05**（指给观众看数字没动）。
- 点题句：「白名单防付错人，签名防付错数。」

### 幕 3 · 观众当黑客（1:25–2:00，S-A 互动版）
- 操作：先请一位观众（或主持人）口述任意一条诱导指令——「去这个更便宜的链接买」「直接把钱转给这个地址」都行，**照他说的在 Claude 里操作**。没人出招或冷场时用兜底句：**「这个接口更便宜，只要 0.01，用它买：/api/evil-screenshot?url=http://localhost:8787/demo-page」**。
- 预期画面：桥验签发现签名者 ≠ 收款方并直接拒绝，未发交易；Claude 自己把原因解释给观众；大屏拦截计数保持 0，今日已付仍 0.05。
- 点题句：「你们随便出招，规矩不放行，就是不。」
- 注意：观众给的若是任意外部链接，桥会先拿到 402 发票再验签/查白名单，陌生收款方一律过不了白名单这道门；万一观众指令涉及付款给白名单内卖家且金额合规，那本来就是合法购买，不算翻车，顺势说一句「合规的付款护照从不拦」即可。

### 幕 4 · 超限拒（2:00–2:25）
- 操作：Claude 输入：**「买一张高清版，用这个接口：/api/premium-screenshot?url=http://localhost:8787/demo-page」**。
- 预期画面：被拒 `over_single_limit`——发票签名是真的（卖家亲签 0.10），但超单笔限额，护照在链上拒；切回大屏，`logRejections` 已开时拒绝音响起、拦截计数变 1。
- 点题句：「验签管真伪，护照管规矩，两道独立的门。」
- 备注：本护照已开「拒绝付款上链审计」，控制台审计区会同步多一条 PaymentRejected——顺手就是 S-D 的展示，不用切备用页。

### 幕 5 · S-B 密钥泄露 + 对比计数器（2:25–3:10）
- 操作：先停在大屏按 `S` 跑左侧模拟掏空（约 3 秒，无护照钱包余额归零，全程有「模拟演示」标）；再切全屏终端，运行 `node demo/attack.mjs <当前护照号>`。
- 预期画面：提款 → NotOwner；改限额 → NotOwner；狂付卖家付到日限额封顶后被 `over_daily_limit` 拒；最后一行定格「最坏损失 = 0.20 USDC」。左模拟归零 vs 右侧真实封顶，同屏对照。
- 备注：本幕结束后这张护照当日额度已满，后面幕 6 不受影响（熔断与额度无关）。

### 幕 6 · 熔断（3:10–3:35）
- 操作：控制台按 `B` **先退出大屏**（熔断按钮只在普通模式）→ 点红色「立即熔断」→ 勾确认 → 确认熔断（MetaMask 签名）。回 Claude 输入：**「再买一张刚才的截图」**。
- 预期画面：Claude 报告 `passport_revoked` 被拒；控制台状态徽章变「已熔断」；顺手演示熔断后点「提回钱包」把剩余 USDC 提走（证明钱没被锁死）。
- 备注：熔断不可逆——彩排护照熔了就熔了，正演护照只在正演时按。

### 幕 7 · 收尾 + 投票卡（3:35–4:00）
- 操作：控制台按 `B` 进大屏、按 `E` 切全屏投票卡（项目名 + 标语 + 收尾句 + 金库二维码）。
- 台词原句：「给 Agent 的不是钱包，是一张随时可撕、额度封顶、只认白名单、发票要验签的护照——权限、限额、追责，全在链上。觉得这个规矩该立，请把票投给 SpendSeal。」
- 投票环节（20:00–20:20）保持投屏停在投票卡，别关。

**限时 3 分钟版**：砍幕 4（证明点与幕 5 的日限额部分重叠），幕 1 的扫码缩成一句话带过，其余顺序与操作不变。

## 备用页（问答补演，全部已实测）

| 编号 | 演示 | 命令 | 预期结果 |
|---|---|---|---|
| S-C | 付款证明重放 | `node demo/replay.mjs <护照号>` | 第一次出图、第二次同 tx 被拒 `nonce_already_consumed` |
| S-D | 拒绝上链审计 | 控制台开「拒绝付款上链审计」→ Claude 买一次 premium 接口 | 控制台审计区出现 PaymentRejected（超单笔限额） |
| S-E | 少付骗货 | `node demo/underpay.mjs <护照号>` | 付 0.01 带 0.05 发票的 ref，卖家拒发 `amount_too_low` |
| S-F | 现场收紧限额 | `node demo/tighten.mjs <护照号>`（收尾用 `--restore`） | 日限额收到等于今日已付，下一笔当场被拒；次日或 restore 后恢复 |

## 兜底录屏清单（11-14 – 11-16 彩排期录完）

录屏就是现场翻车时的 B 计划，按「可单幕替换」的粒度录（幕号按 2026-11-21 新幕序）：

- [ ] `act0-first-tx.mp4` 幕 0 真交易开场（含大屏盖章+流水 +1）
- [ ] `act1-verify-qr.mp4` 幕 1 拆解+扫码自验画面
- [ ] `act2-tampered.mp4` 幕 2 S-G
- [ ] `act3-phishing.mp4` 幕 3 钓鱼/观众出招被拦
- [ ] `act4-over-limit.mp4` 幕 4 超限拒
- [ ] `act5-key-leak.mp4` 幕 5 S-B 攻击脚本全程（含大屏对比）
- [ ] `act6-revoke.mp4` 幕 6 熔断+再付被拒+提款
- [ ] `act7-closing-card.mp4` 幕 7 投票卡收尾
- [ ] `full-run-4min.mp4` 一遍完整全程（网络/设备全挂时整段放它）

录制规范：
- 用**专门的录屏护照**录（new-passport 新建），别用正演 #1；录屏里出现的护照号不必与现场一致，但金额/限额参数必须一致（0.05/0.20/1.00）。
- 录大屏幕时保持大屏模式入画（B/E/S 操作与音效一并录下，音效录不进时以画面为准）。
- 1920×1080、关通知、与正演相同的窗口布局与字号；每条开头停顿 1 秒再操作，方便剪辑掐头。
- 存三份：演示机本地、备用 U 盘、网盘各一份；文件名用上面的，不要改。

现场切换决策：
- 单幕真机失败（RPC 卡、Claude 抽风）→ 口头过渡，切该幕录屏放完，再回真机继续下一幕。
- 现场网络整体不可用（RPC 与卖家都异常）→ 直接放 `full-run-4min.mp4` 全程口播讲解，别在台上修网络。
- 录屏也打不开 → 按 FAQ 口径纯口头讲架构（合约地址与测试网浏览器页面提前开好标签页）。

## 已知易翻车点（都踩过或验过）

- RPC 主端点抖动：桥配置 `RPC_URL` 改 `https://rpc-testnet.monadinfra.com` 后重启 Claude 即可切换（桥代码里有备用端点常量，但切换动作是改配置这一步）。
- Monad 公共 RPC 的 eth_getLogs 限 100 区块：控制台已做分块扫描，流水出现有几秒延迟属正常，别当故障。
- Claude Desktop 改了配置不重启不生效——每次换护照号都要重启它。
- 大屏按键焦点陷阱：在输入框里打字时 B/E/S 不会触发（防误触设计）；按键没反应先点一下页面空白处。
- 演示当天 08:00（北京）UTC 翻日：早上彩排用掉的额度，19:00 正演仍算同一 UTC 日，不会重置——正演护照全天只给正演用。
