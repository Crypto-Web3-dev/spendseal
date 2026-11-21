# SpendSeal

*A sealed spending allowance for your AI agent.*

给 AI Agent 的不是钱包，而是一张额度封顶、只认白名单、发票要验签、随时可撕的「支出封条」：
卖家用 EIP-712 签名开发票，金库合约逐笔验规矩（单笔限额 / UTC 日限额 / 收款白名单 / 有效期），
超规矩的付款在链上被拒；主人一键熔断，且熔断永远不锁主人的钱。

Built for Monad Blitz Guangzhou (2026-11-21). Design docs: `~/workspace/monad-hackathon/`
(interface spec v1.3, demo script, competitor research).

## Live on Monad testnet (chain 10143)

| Thing | Value |
|---|---|
| PassportVault | `0x88817cf2ef5afa8497f6a95deb04fa7ce8f47cf1` |
| Demo passport | #1 — per-payment cap 0.05 USDC, daily cap 0.20 USDC |
| USDC (Circle testnet) | `0x534b2f3A21130d7a60830c2Df862319e593943A3` |
| Agent identity (ERC-8004) | agentId **2560** @ registry `0x8004A818BFB912233c491871b3d84c89A494BD9e` (display only) |

Materials: hackathon submission copy in `docs/submission/submission.md`, architecture
diagram in `docs/submission/architecture.png`, rehearsal runbook in
`docs/rehearsal-runbook.md`, one-page stage cheat sheet in `docs/stage-cheatsheet.md`,
deployment records in `docs/deployments.md`.

## Layout

| Dir | What |
|---|---|
| `contracts/` | Foundry project: `PassportVault.sol` (the vault) + `MockUSDC.sol` (local testing only). **17/17 tests green.** |
| `seller/` | The paid screenshot API: HTTP 402 + EIP-712-signed invoices + event-based payment verification. (W3) |
| `bridge/` | `spendseal-mcp`: MCP server for Claude Desktop — `pay_for_api` + `passport_status`. No management tools, by design. (W3–W4) |
| `web/` | One-page owner console: passport status, payment feed, kill switch — plus a stage big-screen mode (live transaction QR, sound effects, blocked-payment counter, closing vote card). (W4) |
| `docs/` | `wallets.md` — testnet wallet addresses (public). Private keys live in repo-root `.env` (git-ignored, testnet throwaway only). |

## Security model in 30 seconds

- USDC lives in the vault, accounted per passport. The agent address holds only gas (MON) — it cannot pay a cent of USDC without passing the vault's checks.
- Management (limits, whitelist, revoke, withdraw) is owner-wallet only. The agent has **no** MCP tool for any of it.
- Seller invoices are EIP-712 signed (signer == payee). The bridge verifies the signature before any transaction exists; a tampered invoice never reaches the chain.
- Rejections can optionally be recorded on-chain per passport (`tryPay` + `PaymentRejected` events) for audit.

## Quick start (seller + console)

Prerequisites: Node 20+, Python 3, and `spendseal/.env` configured (see `bridge/README.md` and `seller/README.md` for the required variables — the repo-root `.env` holds testnet-only keys and is git-ignored).

```bash
# Install Node dependencies once
cd bridge && npm install && cd ../seller && npm install && cd ..

# Start seller + console in one command (idempotent; prints the URL to open)
bash start-all.sh 1
```

`start-all.sh` prints two URLs — a `localhost` one and the WSL IP one. On Windows, use the WSL IP URL (WSL2 localhost forwarding is unreliable).

Stop services with:
```bash
pkill -f 'src/server.js|http.server 8080'
```

## Run the contract tests

```bash
cd contracts
forge test   # 17 tests, T1–T17 per interface spec §5
```

## Using an existing deployment (no redeploy needed)

`PassportVault` is **multi-tenant**: one deployment serves any number of independent passports.
Call `createPassport(agent, singleLimit, dailyLimit, expiry)` from your own wallet and you become
that passport's `owner` — balances are accounted per `passportId`, so passports never touch each other's funds.

You only need to deploy your own instance when changing **what the contract is bound to**:

| You want to… | Redeploy? | Why |
|---|---|---|
| Create a passport on the existing deploy | No | Multi-tenant by design |
| Use a different USDC or a different chain | Yes | `IERC20 public immutable usdc` is fixed at construction |
| Change the rules (add checks, new limit model) | Yes | No proxy / no upgrade path — deliberately, so nobody can change the rules after the fact |

`owner` does not have to be an EOA: it can be a contract address (e.g. a Safe multisig), since the
contract only compares `msg.sender` against the stored address.

## Deploy (Monad testnet, chain 10143)

```bash
cd contracts
USDC_ADDRESS=0x534b2f3A21130d7a60830c2Df862319e593943A3 \
forge script script/Deploy.s.sol:Deploy --rpc-url monad_testnet --broadcast --private-key $OWNER_PRIVATE_KEY
```

Omit `USDC_ADDRESS` to deploy a fresh MockUSDC instead (local rehearsal).
Testnet USDC: Circle faucet. Test MON: faucet.monad.xyz.
