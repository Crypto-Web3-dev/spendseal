# SpendSeal — 提交材料文案包（直接粘贴用）

> 用法：黑客松项目页各字段从下面对应小节复制。占位符 `<...>` 处在提交当天替换。
> 口径铁律：不出现「首创/first」字样；差异只讲组合与强制层级；诚实边界如实写（已是加分项）。

---

## 1. 项目名 / 标语 / 一句话

- **Name:** SpendSeal
- **Tagline:** *A sealed spending allowance for your AI agent.*
- **One-liner (EN):** SpendSeal gives an AI agent team one shared on-chain budget pool: each agent card draws from it under its own daily cap, sellers quote with EIP-712 signed invoices, and a Monad smart contract enforces every payment — so a leaked agent key can lose at most its own card's allowance.
- **一句话（ZH）：** SpendSeal 给 AI Agent 团队一个共享的链上「消费护照池」：多张卡共享同一个池子，每张卡有独立日额度与独立账本，付款必须两层都过；卖家用 EIP-712 签名发票报价，合约逐笔验规矩——Agent 密钥泄露，最多损失一张卡的额度。

## 2. 列表页短简介（约 280 字符）

AI agents can pay now — but nobody sets their rules. SpendSeal is a team budget pool on Monad: USDC sits in one shared vault, each agent card draws from it under its own daily cap and its own ledger, every payment must clear both layers, each quote is a signed invoice, over-cap spends need a human approval, and the owner can revoke everything with one signature. Live demo: a Claude agent buys screenshots per-call, a second agent burns the pool down, gets phished, gets its key "leaked" — and the worst case stays 0.10 USDC.

## 3. 完整介绍（项目页正文，EN）

### The problem

Agents are starting to spend money on behalf of users — buying API calls, data, compute. The tooling for that is a wallet with an API key attached: if the agent is prompt-injected, compromised, or simply wrong, the loss is whatever the wallet holds. Recent research (I-HITL, Cornell Tech / Yale, Oct 2026) showed 9 of 10 frontier models will read their owner's email verification codes to bypass a wallet's daily limit when the approval channel is reachable from the agent's own tools. Limits that the agent can reach are not limits.

### What SpendSeal does

SpendSeal replaces "the agent's wallet" with a **budget pool**: a smart-contract vault (`PoolVault`, live on Monad testnet) that holds the money and enforces the rules *inside the payment path*:

- USDC is deposited into one shared pool; the agent's own address holds **only gas** — there is no route for it to pay USDC except through the vault's checks.
- The pool is shared, the accounts are separate. Pool balance, per-payment cap and a pool-level UTC daily cap belong to the pool; every agent gets a **card** with its own daily cap and its own ledger. A payment must clear **both layers** — a card cannot eat another card's allowance, but the team's total spend has one common ceiling.
- Cards are ledgers, not wallets: USDC only ever leaves the pool, never a card. Revoking the pool stops every card at once.
- Over-cap is not "impossible", it is "not the machine's call": the agent can file an **on-chain approval request**, and only the owner can approve that one payment. The agent has the request; the owner has the key.
- Every payment is validated on-chain, in a fixed order: passport exists → not revoked → not expired → payee is whitelisted → within per-payment cap → within the daily cap (UTC day, lazy rollover) → sufficient balance.
- Sellers charge over HTTP 402 with an **EIP-712 signed invoice** (signer must equal the payee; the domain binds the invoice to this vault on this chain). The buyer's bridge verifies the signature *before* any transaction exists — a tampered or forged invoice never reaches the chain.
- After paying, the buyer retries with the transaction hash; the seller verifies the vault's `PaymentExecuted` event (payee / amount / invoice-bound ref) and consumes the invoice's nonce exactly once before delivering.
- Blocked payments can optionally be **recorded on-chain** (`PaymentRejected` events, per-passport toggle) — an audit trail of what the agent tried to do.
- The owner gets a one-page console: pool balance, per-card ledgers, payment feed, rejection audit, pending approvals, whitelist management — and a red **kill switch**. Revoking is irreversible and never locks the owner's funds; withdrawals always work.

### The agent's surface — deliberately tiny

The agent (Claude Desktop, via a local MCP bridge `spendseal-mcp`) gets exactly two tools: `pay_for_api` and the read-only `passport_status`. There is **no tool** for limits, whitelist, revoke or withdraw — not hidden, not permissioned: absent. An agent cannot talk its way into more power because the capability does not exist in its world.

### The demo (3 minutes, live on testnet, audience-voted venue)

The setup on screen is the pool console: **one pool of 1.00 USDC, two agent cards**, card A capped at 0.10/day, card B at 0.15/day, pool daily cap 0.20.

1. **It opens with a real payment, not an introduction**: Claude (card A) buys a webpage screenshot for 0.05 USDC — invoice, signature check, vault payment, image delivered into the chat. The console moves in the same second: pool spent 0.05, card A ledger 0.05. Every coin is booked to the card that spent it.
2. Card B runs a batch job and buys three more (0.15). The per-card bars climb; the pool bar hits its 0.20 ceiling.
3. **Card A tries to buy again and is refused** — `over_daily_limit`, rejection recorded on-chain and visible in the audit feed. The line that lands: *card A still has half its own allowance left; it was refused because the pool is empty. That is the rule of a shared pool — nobody gets to take the team down with them.*
4. **Over-cap needs a human**: card A files an on-chain approval request; the owner approves it from the console; only that one payment goes through, and it is still booked to card A. *Over-cap is not impossible — it is not the machine's call.*
5. The owner hits the kill switch: every card stops at once; the owner then withdraws the remaining balance — revocation never traps the money.

Signature-level attacks run on the same rail and never reach the chain: a rewritten invoice amount fails signature verification; a phishing invoice fails because its signer is not the payee; a validly signed over-cap invoice is refused by the contract. Those three cost zero gas and leave zero on-chain trace.

The demo agent also holds an on-chain identity: ERC-8004 Identity Registry, **agentId 2560** — identity for discovery, kept strictly out of the payment path.

### How it differs

Individual pieces exist elsewhere — agent wallets with limits (MetaMask/Coinbase), policy passports with server-side evaluation (Fuku), 402 payment loops (AgentProof), account-level guardrails via EIP-7702 (Sentinel). SpendSeal's position is the combination and the enforcement point: **a shared budget pool with per-card ledgers + seller-signed invoices + event-based seller verification in one working buyer-seller loop, with every check executed inside the contract and no server anywhere in the decision path.** A server can go down or turn hostile; it still cannot approve a payment the contract would reject. And the second layer is what makes it a team tool rather than a personal one: the pool's cap and each card's cap are different questions, asked by the same code at the same instant.

### Tech stack

Solidity (Foundry, 27 tests across `PoolVault` and `PassportVault`) · Monad testnet (chain 10143) · USDC (Circle testnet) · Node.js + viem · MCP (stdio) for Claude Desktop · Puppeteer (seller's screenshot service) · single-file HTML console with a stage big-screen mode (QR library embedded in the page; no backend, no CDN) · ERC-8004 identity registry.

### Honest limitations

Testnet only, test tokens. The contract is unaudited (kept single-file and minimal, with a test for every validation rule incl. a reentrancy case). Invoice signatures stop tampering and forgery, not a seller overpricing — caps bound that risk. The seller keeps invoice state in memory (demo-grade, disclosed in its README). The approval flow is owner-only by design and has no timeout/auto-expiry yet: a request that is never answered simply stays pending, which is safe but leaves clutter — the next revision should expire stale requests on-chain.

### What's next

Cursor support for the bridge; per-card spend analytics and budget-rollover policies on top of the pool; EIP-7702 account-level enforcement as an optional execution layer under the same passport semantics; a second seller category (data APIs) to prove the invoice protocol generalizes; mainnet pilot with real USDC once audited.

**The passport semantics generalize beyond paid APIs.** The same contract — per-payment cap, daily cap, payee whitelist, instant revoke, and now a shared pool with per-card ledgers — constrains any autonomous micro-spend, and we explored one adjacent case during research: a live micro-prediction room where viewers bet cents on 60-second questions and payouts settle before the moment passes. It is deliberately **not** in this build (scope discipline, and betting-adjacent products need a compliance review we have not done), but it is the clearest illustration that the missing layer is horizontal: whoever the seller is, the question "may this agent spend this, here, now" gets the same answer from the same contract.

## 4. 完整介绍（ZH 精简版，备中文项目页/路演稿）

Agent 开始替人花钱了，但给它定的规矩不能放在它够得着的地方。SpendSeal 把「Agent 的钱包」换成一张链上护照：钱托管在 Monad 上的合约池里，Agent 地址只有 gas——它付出的每一分 USDC 都必须过合约的逐笔校验（存在、未熔断、未过期、白名单、单笔限额、UTC 日限额、余额）。今天部署的是团队版：**一个共享池子下挂多张 Agent 卡**，池余额/单笔上限/全池日限属于池子，每张卡有自己的日额度和自己的账本，一笔付款必须两层都过——卡 A 吃不到卡 B 的额度，全队总支出却有共同的顶。卡只是账本不是钱包：USDC 只从池子转出，从不经过卡。超额不是不行，是**不能由机器自己决定**：可以发起链上待批申请，只有主人批准那一笔才放行。卖家用 HTTP 402 收费，发票带 EIP-712 签名（签名者必须等于收款方），买家桥在付款前验签，篡改和伪造的发票连链都上不了；付款后卖家按金库的付款事件（收款方/金额/发票绑定的 ref）验付，发票一次性消费，防重放。被拒的付款可按开关记录上链，形成审计。主人有单页控制台：池余额、每张卡的独立分账、待批申请、流水、拒绝审计、白名单、红色熔断按钮；熔断不可逆，但永远不锁主人的钱。Agent 的工具面被刻意做到最小——只有付款和只读状态两个 MCP 工具，改限额/熔断/提款连入口都不存在。现场演示 3 分钟（观众投票场）：池子页立题 → A 正常买 0.05 → B 批量买 0.15 把池子打满 → A 再买被拒、但 A 自己的额度还剩一半 → 发起待批申请、主人批准后放行 → 一键熔断收尾。Agent 另在 ERC-8004 注册了链上身份（编号 2560），只展示、不进付款路径。

**护照语义是横向的。** 同一份合约——单笔上限、日上限、收款白名单、即时熔断——约束的是任何「自主微支付」，不限于买 API。调研阶段我们看过一个相邻场景：直播微预测房间，观众押几美分猜 60 秒内的问题，派彩在热度窗口内结算。它**刻意不在本次构建里**（一是范围纪律，二是博彩相邻产品需要我们没做过的合规评估），但它是「缺的那一层是横向的」最清楚的例证：无论收款方是谁，「这个 Agent 此刻、在此地、能不能花这笔钱」都由同一份合约回答。

## 5. 地址与链接（提交当天核对后填）

| 项 | 值 |
|---|---|
| PoolVault（Monad 测试网，本次演示） | `0xc3cd8c06377401574f8825443f60a18ac748963c` |
| 合约浏览器 | https://testnet.monadvision.com/address/0xc3cd8c06377401574f8825443f60a18ac748963c |
| 演示池 | Pool #1（余额 1.00 / 单笔 0.05 / 全池日限 0.20 USDC；卡 A 0.10，卡 B 0.15） |
| USDC（Circle 测试网） | `0x534b2f3A21130d7a60830c2Df862319e593943A3` |
| Agent 身份（ERC-8004） | agentId 2560 @ `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| 代码仓库 | https://github.com/crypto-web3-dev/spendseal |
| 演示视频 | `<录屏/现场视频地址>` |
| 团队 | `<单人 Kevin / 队名与成员，提交前确认>` |

## 6. 提交当天填空清单

- [ ] 仓库推到 GitHub 并设为公开，README 第一屏能看到地址表
- [ ] 项目页粘贴：第 1 节一句话 + 第 2 节短简介 + 第 3 节正文 + 架构图（architecture.png）
- [ ] 上传截图（16:9 横屏，第一张为封面）：`slides/00-cover-light.png` → `slides/01-A-light.png` → `slides/03-D-light.png`；控制台池子页 `web/pool.html` 另截一张备用（数字要新）
- [ ] 视频：优先现场版；兜底用仓库里的录屏
- [ ] 地址表逐项点开验证可打开（池子合约、身份、交易各点一次）
- [ ] 类别/赛道按广州站实际表单选（报名链接到手后核对赛道名再填）
