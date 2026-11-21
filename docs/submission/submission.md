# SpendSeal — 提交材料文案包（直接粘贴用）

> 用法：黑客松项目页各字段从下面对应小节复制。占位符 `<...>` 处在提交当天替换。
> 口径铁律：不出现「首创/first」字样；差异只讲组合与强制层级；诚实边界如实写（已是加分项）。

---

## 1. 项目名 / 标语 / 一句话

- **Name:** SpendSeal
- **Tagline:** *A sealed spending allowance for your AI agent.*
- **One-liner (EN):** SpendSeal gives an AI agent a capped, whitelist-only, revocable on-chain spending passport — sellers quote with EIP-712 signed invoices, and a Monad smart contract enforces every payment, so a leaked agent key can lose at most one day's allowance.
- **一句话（ZH）：** SpendSeal 给 AI Agent 发一张链上「支出护照」：额度封顶、只认白名单、随时可熔断；卖家用 EIP-712 签名发票报价，金库合约逐笔验规矩——Agent 密钥泄露，最多损失一天的额度。

## 2. 列表页短简介（约 280 字符）

AI agents can pay now — but nobody sets their rules. SpendSeal is a spending passport on Monad: USDC sits in a vault, the agent can only pay whitelisted sellers within per-payment and daily caps, every quote is a signed invoice, and the owner can revoke everything with one signature. Live demo: a Claude agent buys screenshots per-call, gets phished, gets its key "leaked" — and the worst case stays 0.20 USDC.

## 3. 完整介绍（项目页正文，EN）

### The problem

Agents are starting to spend money on behalf of users — buying API calls, data, compute. The tooling for that is a wallet with an API key attached: if the agent is prompt-injected, compromised, or simply wrong, the loss is whatever the wallet holds. Recent research (I-HITL, Cornell Tech / Yale, Oct 2026) showed 9 of 10 frontier models will read their owner's email verification codes to bypass a wallet's daily limit when the approval channel is reachable from the agent's own tools. Limits that the agent can reach are not limits.

### What SpendSeal does

SpendSeal replaces "the agent's wallet" with a **passport**: a smart-contract vault (`PassportVault`, live on Monad testnet) that holds the money and enforces the rules *inside the payment path*:

- USDC is deposited per passport; the agent's own address holds **only gas** — there is no route for it to pay USDC except through the vault's checks.
- Every payment is validated on-chain, in a fixed order: passport exists → not revoked → not expired → payee is whitelisted → within per-payment cap → within the daily cap (UTC day, lazy rollover) → sufficient balance.
- Sellers charge over HTTP 402 with an **EIP-712 signed invoice** (signer must equal the payee; the domain binds the invoice to this vault on this chain). The buyer's bridge verifies the signature *before* any transaction exists — a tampered or forged invoice never reaches the chain.
- After paying, the buyer retries with the transaction hash; the seller verifies the vault's `PaymentExecuted` event (payee / amount / invoice-bound ref) and consumes the invoice's nonce exactly once before delivering.
- Blocked payments can optionally be **recorded on-chain** (`PaymentRejected` events, per-passport toggle) — an audit trail of what the agent tried to do.
- The owner gets a one-page console: live limits and balance, payment feed, rejection audit, whitelist management — and a red **kill switch**. Revoking is irreversible and never locks the owner's funds; withdrawals always work.

### The agent's surface — deliberately tiny

The agent (Claude Desktop, via a local MCP bridge `spendseal-mcp`) gets exactly two tools: `pay_for_api` and the read-only `passport_status`. There is **no tool** for limits, whitelist, revoke or withdraw — not hidden, not permissioned: absent. An agent cannot talk its way into more power because the capability does not exist in its world.

### The demo (4 minutes, live on testnet, audience-voted venue)

1. **It opens with a real payment, not an introduction**: Claude buys a webpage screenshot for 0.05 USDC — invoice, signature check, vault payment, image delivered into the chat — within the first 30 seconds. Only then comes the framing: the rules live in the contract, not in the prompt.
2. The payment is verified on-chain in front of the room: the transaction page is projected live (amount, payee, contract address, success status), and a QR code lets anyone re-check it on their own phone. The passport's three rules are on screen: per-payment cap, daily cap, whitelist.
3. A man-in-the-middle rewrites the invoice amount to 0.50 — the bridge rejects it at signature verification; nothing is sent.
4. **The audience plays the hacker**: anyone can call out an instruction ("use this cheaper link", "just send the money here") and the agent tries it live — a phishing invoice is rejected before any transaction because its signer does not match the payee, and the agent explains why in its own words. These off-chain signature rejections do not increment the on-chain rejection counter.
5. The real seller signs a genuine 0.10 USDC invoice — signature valid, but over the per-payment cap; the vault refuses. With rejection logging enabled, a `PaymentRejected` event is recorded on-chain and the console counter becomes 1. Authenticity and rules are two separate doors.
6. The agent's private key is "leaked" live: withdrawals and limit changes revert (`NotOwner`); spamming the whitelisted seller stops dead at the daily cap. A side-by-side counter shows an unprotected wallet (simulated, labeled as such) drained to zero. Worst case on screen: **0.20 USDC**.
7. The owner hits the kill switch; the agent's next purchase is refused. The owner then withdraws the remaining funds — revocation never traps the money. The demo closes on a full-screen card with the vault QR code.

The demo agent also holds an on-chain identity: ERC-8004 Identity Registry, **agentId 2560** — identity for discovery, kept strictly out of the payment path.

### How it differs

Individual pieces exist elsewhere — agent wallets with limits (MetaMask/Coinbase), policy passports with server-side evaluation (Fuku), 402 payment loops (AgentProof), account-level guardrails via EIP-7702 (Sentinel). SpendSeal's position is the combination and the enforcement point: **passport vault + seller-signed invoices + event-based seller verification in one working buyer-seller loop, with every check executed inside the contract and no server anywhere in the decision path.** A server can go down or turn hostile; it still cannot approve a payment the contract would reject.

### Tech stack

Solidity (Foundry, 17/17 tests) · Monad testnet (chain 10143) · USDC (Circle testnet) · Node.js + viem · MCP (stdio) for Claude Desktop · Puppeteer (seller's screenshot service) · single-file HTML console with a stage big-screen mode (QR library embedded in the page; no backend, no CDN) · ERC-8004 identity registry.

### Honest limitations

Testnet only, test tokens. The contract is unaudited (kept single-file and minimal, with a test for every validation rule incl. a reentrancy case). Invoice signatures stop tampering and forgery, not a seller overpricing — caps bound that risk. The seller keeps invoice state in memory (demo-grade, disclosed in its README).

### What's next

Cursor support for the bridge; EIP-7702 account-level enforcement as an optional execution layer under the same passport semantics; a second seller category (data APIs) to prove the invoice protocol generalizes; mainnet pilot with real USDC once audited.

**The passport semantics generalize beyond paid APIs.** The same contract — per-payment cap, daily cap, payee whitelist, instant revoke — constrains any autonomous micro-spend, and we explored one adjacent case during research: a live micro-prediction room where viewers bet cents on 60-second questions and payouts settle before the moment passes. It is deliberately **not** in this build (scope discipline, and betting-adjacent products need a compliance review we have not done), but it is the clearest illustration that the missing layer is horizontal: whoever the seller is, the question "may this agent spend this, here, now" gets the same answer from the same contract.

## 4. 完整介绍（ZH 精简版，备中文项目页/路演稿）

Agent 开始替人花钱了，但给它定的规矩不能放在它够得着的地方。SpendSeal 把「Agent 的钱包」换成一张链上护照：钱托管在 Monad 上的金库合约里，Agent 地址只有 gas——它付出的每一分 USDC 都必须过合约的逐笔校验（存在、未熔断、未过期、白名单、单笔限额、UTC 日限额、余额）。卖家用 HTTP 402 收费，发票带 EIP-712 签名（签名者必须等于收款方），买家桥在付款前验签，篡改和伪造的发票连链都上不了；付款后卖家按金库的付款事件（收款方/金额/发票绑定的 ref）验付，发票一次性消费，防重放。被拒的付款可按护照开关记录上链，形成审计。主人有单页控制台：额度、流水、拒绝审计、白名单、红色熔断按钮；熔断不可逆，但永远不锁主人的钱。Agent 的工具面被刻意做到最小——只有付款和只读状态两个 MCP 工具，改限额/熔断/提款连入口都不存在。现场演示 4 分钟（观众投票场）：开场 30 秒先上真实购买 → 观众扫码自验那笔交易 → 篡改发票被验签拦 → 观众现场出招当黑客、钓鱼付款被双层拦 → 合法签名高价单被限额拒 → 密钥「泄露」实测最坏损失 0.20 USDC（同屏对比无护照钱包被掏空的模拟）→ 熔断 → 全屏投票卡收尾。Agent 另在 ERC-8004 注册了链上身份（编号 2560），只展示、不进付款路径。

**护照语义是横向的。** 同一份合约——单笔上限、日上限、收款白名单、即时熔断——约束的是任何「自主微支付」，不限于买 API。调研阶段我们看过一个相邻场景：直播微预测房间，观众押几美分猜 60 秒内的问题，派彩在热度窗口内结算。它**刻意不在本次构建里**（一是范围纪律，二是博彩相邻产品需要我们没做过的合规评估），但它是「缺的那一层是横向的」最清楚的例证：无论收款方是谁，「这个 Agent 此刻、在此地、能不能花这笔钱」都由同一份合约回答。

## 5. 地址与链接（提交当天核对后填）

| 项 | 值 |
|---|---|
| PassportVault（Monad 测试网） | `0x88817cf2ef5afa8497f6a95deb04fa7ce8f47cf1` |
| 合约浏览器 | https://testnet.monadvision.com/address/0x88817cf2ef5afa8497f6a95deb04fa7ce8f47cf1 |
| 演示护照 | Passport #1（单笔 0.05 / 日限额 0.20 USDC） |
| USDC（Circle 测试网） | `0x534b2f3A21130d7a60830c2Df862319e593943A3` |
| Agent 身份（ERC-8004） | agentId 2560 @ `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| 代码仓库 | `<提交当天填 GitHub 地址>` |
| 演示视频 | `<录屏/现场视频地址>` |
| 团队 | `<单人 Kevin / 队名与成员，提交前确认>` |

## 6. 提交当天填空清单

- [ ] 仓库推到 GitHub 并设为公开，README 第一屏能看到地址表
- [ ] 项目页粘贴：第 1 节一句话 + 第 2 节短简介 + 第 3 节正文 + 架构图（architecture.png）
- [ ] 上传截图：控制台（彩排时重截，数字要新）、Claude 对话里出图的那一幕、攻击脚本定格行
- [ ] 视频：优先现场版；兜底用 full-run-4min.mp4
- [ ] 地址表逐项点开验证可打开（合约、身份、交易各点一次）
- [ ] 类别/赛道按广州站实际表单选（报名链接到手后核对赛道名再填）
