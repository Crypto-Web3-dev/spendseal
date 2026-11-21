# spendseal-seller — the paid screenshot API

Sells webpage screenshots one at a time over HTTP 402, per interface spec v1.3 §2.

## Run

```bash
npm install
npm start          # http://localhost:8787  (config from repo-root .env)
npm run test:e2e   # full flow against the real Monad testnet vault (costs 0.05 test USDC per run)
```

## Endpoints

| Route | Behavior |
|---|---|
| `GET /health` | Service + vault + price info |
| `GET /api/screenshot?url=<https://…>` | No `X-PAYMENT-TX` header → **402 + EIP-712 signed invoice**. With a valid payment proof → verifies the vault's `PaymentExecuted` event (payee/amount/ref), consumes the invoice nonce exactly once, returns the PNG screenshot |
| `GET /api/evil-screenshot?url=…` | **Demo S-A phishing simulation**: issues a cheaper invoice whose `payTo` is the attacker address while the signature is the real seller's — any correct bridge rejects it (signer ≠ payTo, payee not whitelisted) |
| `GET /api/tampered-screenshot?url=…` | **Demo S-G tampered-invoice simulation**: seller signs a genuine 0.05 invoice, then the amount is rewritten to 0.50 in transit — the bridge's signature check rejects it before any transaction exists (`invoice_signature_invalid`) |
| `GET /api/premium-screenshot?url=…` | **Demo over-limit case**: a genuine seller-signed invoice for 0.10 USDC — signature is valid, but it exceeds the demo passport's per-payment cap, so the vault rejects it on-chain (`over_single_limit`) |
| `GET /demo-page` | A stable, always-loadable page to screenshot — test target and on-stage fallback if venue network misbehaves |

## Design notes (honest limits)

- Invoice store is **in-memory** (demo grade): a restart forgets pending invoices; consumed refs are kept for the process lifetime so replays get a precise `nonce_already_consumed`.
- Payment verification checks the receipt status and matches the `PaymentExecuted` event from the vault: payee, amount (≥ invoice amount), and the invoice's unique `ref` — one payment buys exactly one screenshot.
- The invoice signature (EIP-712, signer == payTo) stops tampering and forgery in transit; it does **not** stop the seller itself from overpricing — the buyer's on-chain limits cap that risk.
- Screenshot engine: headless Chromium via Puppeteer, 1280×800. If the host exports an egress proxy via env vars, Chromium is told about it explicitly (it ignores env proxies otherwise).
