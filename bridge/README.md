# spendseal-mcp — the MCP bridge for Claude Desktop

Connects a desktop AI agent to its SpendSeal passport on Monad testnet.

## Tools (exactly two — this is the security boundary)

| Tool | What it does |
|---|---|
| `pay_for_api` | Buys a pay-per-call API response: fetches the 402 quote → **verifies the seller's EIP-712 invoice signature** → pre-flights against the on-chain passport (`checkPay`) → pays via the vault → retries with the payment proof → returns the result (images come back as MCP image content). A PNG result is also saved to `demo/last-screenshot.png` (best-effort only — a write failure is logged and never fails the paid call), so it can be viewed on screen when the MCP client does not display images (e.g. Claude Code in WSL). |
| `passport_status` | Read-only: limits, spent today, balance, revoked flag |

**There is no tool for changing limits, editing the whitelist, revoking, or withdrawing.** Those actions exist only as owner-wallet signatures in the console. An agent — even a compromised or prompt-injected one — cannot raise its own limits, because the capability is absent, not merely discouraged. (This mirrors the I-HITL finding: agents bypass spending caps when the approval channel is reachable from the agent's own tools.)

Every rejection is returned as a structured error (`code`, human-readable `message`, invoice snapshot, passport snapshot, optional `onChainRecord`, and a `hint`) so the agent can explain to its user exactly why a payment did not happen. When the passport has rejection logging enabled, blocked payments are also recorded on-chain via `tryPay` before the error is returned.

## Setup (Claude Desktop)

1. `npm install` in this directory.
2. Start the seller (`cd ../seller && npm start`) or point `SELLER_API_BASE` at its cloud deployment.
3. Merge `claude_desktop_config.example.json` into your `claude_desktop_config.json`, filling in the absolute path and the agent key from the repo-root `.env`, then restart Claude Desktop.
4. Ask Claude: “用 spendseal 买一张 http://localhost:8787/demo-page 的截图” — or check status first with `passport_status`.

Config via env: `VAULT_ADDRESS`, `PASSPORT_ID`, `AGENT_PRIVATE_KEY`, `RPC_URL` (+ `RPC_URL_BACKUP`, currently informational), `SELLER_API_BASE`, `USDC_ADDRESS`. For local development the bridge falls back to the repo-root `.env`.

## Test

```bash
npm run test:client   # real MCP client over stdio: tool list, status,
                      # phishing rejection, price-cap abort, real purchase
                      # (spends 0.05 test USDC from passport #2)
```
