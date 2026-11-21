# 部署记录 — Monad 测试网（chain 10143）

> **当前演示合约只有一个：PoolVault `0xc3cd8c06377401574f8825443f60a18ac748963c`。**
> 下面「2026-11-21 部署」一节是同一批的早期版本（单 Agent 版 PassportVault），
> 已退役，仅作历史记录；任何对外材料、演示与地址表都不再引用它。

## 2026-11-21 部署（真实 Circle 测试网 USDC）— 已退役

| 项 | 值 |
|---|---|
| PassportVault（已退役，勿引用） | `0x88817cf2ef5afa8497f6a95deb04fa7ce8f47cf1` |
| 部署交易 | `0xbd450291a56596562d1a8cdef5a2cae64abc5082a022415e68b32eeeaf13b9e0` |
| 部署人 | `0xF582…7Ea1` |
| USDC（Circle 测试网） | `0x534b2f3A21130d7a60830c2Df862319e593943A3` |
| RPC | `https://testnet-rpc.monad.xyz` |

## 当前链上状态

`nextPassportId()` = 2，即已创建 1 张护照。

护照 #1：

| 字段 | 值 |
|---|---|
| owner | `0xF58214785825c8FaEBb89A61c666fFFC60677Ea1` ✔ 与 `.env` `OWNER_ADDRESS` 一致 |
| agent | `0x69637d5Da344Decbee8Be1bfFA043c886b7f6F20` ✔ 与 `.env` `AGENT_ADDRESS` 一致 |
| singleLimit | 50,000（0.05 USDC） |
| dailyLimit | 200,000（0.20 USDC） |
| spentToday | 0（`currentDay` = 20778） |
| spentTotal | 0 |
| balance | 1,000,000（1.00 USDC） |
| revoked | false |
| logRejections | true |
| remainingAllowance(1) | 50,000（0.05 USDC） |

角色与 `.env` 一一对应，`tryPay` 的 `msg.sender == p.agent` 校验可通过。

链上实测（2026-11-21）：`isPayee(1, seller)` = `true`，`checkPay(1, seller, 50000)` = `(true, 0, "ok")`——白名单、限额、余额、审计开关均已就绪，正演可直接使用护照 #1。

## PoolVault — 团队预算池（2026-11-21 部署）

`PassportVault` 守一个 Agent；`PoolVault` 守一个团队：一个共享池子（共享余额 / 单笔上限 /
池级日上限）下挂多张 Agent「卡」，每张卡有独立日额度与独立账本。一笔付款必须两层都过；
卡撞到上限时可以发起链上审批请求，只有主人批准才放行那一笔。

| 项 | 值 |
|---|---|
| PoolVault | `0xc3cd8c06377401574f8825443f60a18ac748963c` |
| 部署交易 | `0xab74ca168abb2de7262bb80ae3eac70250464d83246222918f02f8302f2ccfe1` |
| USDC（Circle 测试网） | `0x534b2f3A21130d7a60830c2Df862319e593943A3` |

池子 #1 链上实测（2026-11-21）：

| 字段 | 值 |
|---|---|
| balance | 1,000,000（1.00 USDC） |
| singleLimit | 50,000（0.05 USDC） |
| dailyLimit | 200,000（0.20 USDC） |
| revoked / logRejections | false / true |
| 卡 A `0x6963…6F20` | 日额度 100,000（0.10 USDC），已花 0 |
| 卡 B `0x4498…dfB3` | 日额度 150,000（0.15 USDC），已花 0 |

池子演示用新页面 `web/pool.html`（地址已写死），原控制台 `web/index.html` 保持指向
`PassportVault` 作兜底。`.env` 的 `VAULT_ADDRESS` 指向池子，桥与卖家因此自动跟随。

## 附带核验：P256 预编译

2026-11-21 实测：向 `0x100` 发送合法 secp256r1 签名做 eth_call，返回 1 —— **Monad 测试网 P256VERIFY 预编译存在**。
即 Sentinel 的说法成立、Olien 2026-09-10 的「缺席」记录已过时（或仅针对当时状态）。Plan A 不受影响（Passkey 已砍），赛后路线图可重新评估 Passkey 批准。

## 附带登记：ERC-8004 Agent 身份（只展示、不进付款路径）

- 注册表：ERC-8004 Identity Registry `0x8004A818BFB912233c491871b3d84c89A494BD9e`（Monad 测试网，链上实测 getVersion = "2.0.0"，与 Fuku 部署记录一致）
- **agentId = 2560**，持有者 = Agent 本人 `0x6963…6F20`（Agent 用自己的密钥自注册）
- 注册 tx `0x7721a89fb8a1dbabf97be149f56cf3d5d731add1cdfe2afb91d39cd50c6247de`
- agentURI 为 data URI（注册文档内嵌）：name "SpendSeal Demo Agent"，services 指向 PassportVault 与 spendseal-mcp；已回读 ownerOf/tokenURI 验证一致
- 脚本：`bridge/demo/register-identity.mjs`（带防重复注册守卫）
- 舞台用法：幕 1 可加一句「我们的 Agent 在 ERC-8004 上有自己的链上身份，编号 2560」；评委追问时强调身份层与付款层分离——付款只认 PassportVault 合约规则，注册表不参与校验
