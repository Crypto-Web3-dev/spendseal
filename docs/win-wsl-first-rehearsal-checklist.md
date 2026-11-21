# Win + WSL 首彩排清单：先把 wsl.exe 链路验通

> 背景：Win 版 Claude Desktop 经 `wsl.exe` 拉起 WSL 里 MCP 桥这条链，在纯 Linux 环境无法实测，
> 是第一次真机彩排的头号验证目标。顺序是：**Claude 外冒烟 → 进 Claude → 最后才换彩排护照**。
> 速查卡（stage-cheatsheet.md）只写了机器分工，本页补它没写的诊断步骤。

## 0. 先对齐四个现场事实（任一不符，先改再往下走）

- WSL 发行版实际名称（示例用的是 `Ubuntu`）
- WSL 用户名与仓库真实路径（示例里的 `/home/你的WSL用户名/spendseal/` 是占位符）
- 演示机 Claude Desktop 是否为 MSIX 打包安装（见第 2 步）
- WSL 内是否已装 Node（`wsl node --version` 能出版本号才算）

## 1. Claude 外冒烟（不进 Claude，先排除桥本身的问题）

1. 在 PowerShell 直接跑示例配置里的那条命令（把发行版名、路径改成真实值）：
   `wsl.exe -d Ubuntu -- node /home/你的WSL用户名/spendseal/bridge/src/index.js`
2. 通过标准：**静默等待 stdin，不秒退、不报错**。桥是 stdio 服务，没有 HTTP 健康端点可 curl。
3. 秒退或报错时，先查两处，别先动 Claude 配置：
   - WSL 内 Node：`wsl node --version`
   - `.env` 位置：桥从仓库根（`spendseal/.env`，即 `bridge/src/config.js` 的 `../..`）回退读取
     `VAULT_ADDRESS` 与 `AGENT_PRIVATE_KEY`，缺任一直接抛错不启动。
     注意：`.env` 必须落在 **WSL 内**的仓库根，只放在 Windows 侧读不到。

## 2. 进 Claude（工具出现才算通）

1. 配置文件最稳妥的打开方式：Claude Desktop 设置 → Developer → Edit Config，
   它会创建/打开当前安装实际读的那份。
2. 直接改文件时留心：MSIX 打包安装在 LocalCache 下另有一份同名
   `claude_desktop_config.json`，改错份会表现为“改了没生效”。
3. 改配置后必须**完全退出重开 Claude Desktop**，只关窗口不够。
4. 工具不出现时，先看 `%APPDATA%\Claude\logs` 下的 mcp 日志，再把报错原文发回。
5. 通过标准：`passport_status` 能读出护照状态，这条链就通了。

## 3. 最后才换彩排护照（护照纪律）

- 先用 `bridge/demo/new-passport.mjs` 新建彩排护照，再把配置里的 `PASSPORT_ID` 改成新号、重启 Claude。
- 护照 #1 只留 11-21 正演：新金库上的 #1 余额 1.00、累计支出 0、今日已付 0，白名单与拒绝审计已就绪。
- 日限额按 UTC 日、北京时间 08:00 翻页：白天彩排的额度会带到当晚正演同一 UTC 日，正演当天白天不要再用 #1 彩排消耗。

## 卡住时发回什么

卡住那一步的编号 + 报错原文（或 mcp 日志行）+ 上面第 0 步的四个现场事实，才能对着代码修，不用重述整条链路。
