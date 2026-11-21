# 测试网钱包（公开地址存档）

私钥只存于仓库根 `.env`（已 gitignore），本文件只记地址。四套均为测试网一次性密钥，**禁止用于主网**。

| 角色 | 地址 | 用途 |
|---|---|---|
| owner | 0xF58214785825c8FaEBb89A61c666fFFC60677Ea1 | 主人：建护照/改限额/熔断/提款 |
| agent | 0x69637d5Da344Decbee8Be1bfFA043c886b7f6F20 | Agent 会话钱包：只有它能 pay/tryPay |
| seller | 0xC451a5183A5eCd4F96F7C65BFDA63A89c8ECbA06 | 卖家收款 = 发票签名者（signer == payTo） |
| attacker | 0x0e4F7c8014aB01514e8E48Eb12CD36F55c5e7515 | S-A 钓鱼收款方 / S-B 攻击脚本 |

演示资金面：USDC 全部存金库按护照记账；agent 地址只持有付 gas 的 MON（资金隔离论证的事实基础）。
