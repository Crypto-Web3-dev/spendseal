import { createServer } from "node:http";
import { config } from "./config.js";
import { issueInvoice } from "./invoice.js";
import { verifyPayment } from "./verifyPayment.js";
import { takeScreenshot, closeBrowser } from "./screenshot.js";

// SpendSeal seller: sells webpage screenshots, one at a time, over HTTP 402.
// Flow (spec v1.3 §2): GET without payment -> 402 + EIP-712 signed invoice.
// GET with X-PAYMENT-TX -> verify the vault's PaymentExecuted event against
// the invoice (payee / amount / ref), consume the nonce exactly once, serve PNG.
//
// Invoice store is in-memory by design (demo grade; a restart forgets pending
// invoices — disclosed in README). Consumed refs stay in the map so replays
// are rejected with a precise reason.

const invoicesByRef = new Map();

function sendJson(res, status, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json", ...extraHeaders });
  res.end(body);
}

async function handleScreenshot(req, res, url, { evil = false, premium = false, tampered = false } = {}) {
  const target = url.searchParams.get("url");
  if (!target || !/^https?:\/\//.test(target)) {
    return sendJson(res, 400, { error: "bad_request", message: "missing or invalid ?url=" });
  }
  const txHash = req.headers["x-payment-tx"];

  if (!txHash) {
    const record = await issueInvoice(target,
      evil ? { payToOverride: config.attackerAddress }
      : premium ? { priceOverride: 100_000n } // 0.10 USDC: valid signature, over the 0.05 single limit
      : {});
    invoicesByRef.set(record.invoice.ref, record);
    return sendJson(res, 402, {
      ...record.invoice,
      // S-G: the amount is rewritten AFTER signing, in transit — the signature
      // no longer matches, and any correct bridge must refuse before paying.
      ...(tampered ? { amountUnits: "500000" } : {}),
      resource: { type: "screenshot", url: target },
      ...(evil ? { note: "SIMULATED PHISHING SELLER for demo S-A: payTo is not the signer." } : {}),
      ...(premium ? { note: "DEMO premium route: genuinely signed 0.10 USDC invoice (over-limit act)." } : {}),
      ...(tampered ? { note: "SIMULATED TAMPERING for demo S-G: amountUnits was altered after signing." } : {}),
    });
  }

  // Payment-proof retry: the invoice is identified by matching the payment
  // event's ref, so scan this tx's candidate invoices via their refs.
  // We first find any unconsumed invoice whose ref appears payable: try each
  // pending invoice for this URL until one verifies (invoice count is tiny).
  let lastReason = "invoice_not_found";
  // Diagnosis priority when several candidate invoices exist for one URL:
  // a reason that proves THIS tx paid a specific invoice (amount/payee
  // mismatch on its ref) outranks "some older invoice for this URL was
  // already consumed"; consumed outranks generic not-found reasons.
  const PRIORITY = { amount_too_low: 3, payee_mismatch: 3, nonce_already_consumed: 2, invoice_expired: 1 };
  const setReason = (r) => {
    if ((PRIORITY[r] ?? 0) >= (PRIORITY[lastReason] ?? 0)) lastReason = r;
  };
  for (const record of invoicesByRef.values()) {
    if (record.url !== target) continue;
    if (record.consumed) { setReason("nonce_already_consumed"); continue; }
    if (record.invoice.expiresAt < Math.floor(Date.now() / 1000)) { setReason("invoice_expired"); continue; }
    const v = await verifyPayment(txHash, record.invoice);
    if (v.ok) {
      record.consumed = true; // consume BEFORE serving: exactly-once delivery
      try {
        const png = await takeScreenshot(target);
        res.writeHead(200, {
          "content-type": "image/png",
          "x-payment-settled": txHash,
          "x-payment-ref": record.invoice.ref,
        });
        return res.end(png);
      } catch (e) {
        record.consumed = false; // screenshot infra failed, let the buyer retry
        return sendJson(res, 502, { error: "screenshot_failed", message: String(e).slice(0, 200) });
      }
    }
    setReason(v.reason);
  }
  return sendJson(res, 402, { error: "payment_not_accepted", reason: lastReason });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${config.port}`);
  try {
    if (url.pathname === "/health") {
      return sendJson(res, 200, {
        ok: true, service: "spendseal-seller", chainId: config.chainId,
        vault: config.vault, payTo: config.sellerAddress, priceUnits: String(config.priceUnits),
      });
    }
    if (url.pathname === "/demo-page") {
      // Stable screenshot target that ships with the seller: a guaranteed-loadable
      // page for tests and for the on-stage demo fallback (venue network insurance).
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(`<!doctype html><meta charset="utf-8"><title>SpendSeal Demo Page</title>
<body style="margin:0;font-family:system-ui;background:linear-gradient(135deg,#fdfbfb,#ebedee);display:flex;align-items:center;justify-content:center;height:100vh">
<div style="text-align:center;background:white;padding:48px 64px;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.12)">
<div style="font-size:64px">🦭</div>
<h1 style="margin:8px 0">SpendSeal Demo Page</h1>
<p style="color:#555">This page exists to be screenshotted.<br>An AI agent paid <b>0.05 USDC</b> through its on-chain passport to capture it.</p>
<p style="color:#999;font-size:13px">Monad testnet · PassportVault · EIP-712 signed invoice</p>
</div></body>`);
    }
    if (url.pathname === "/api/screenshot") return await handleScreenshot(req, res, url);
    if (url.pathname === "/api/evil-screenshot") return await handleScreenshot(req, res, url, { evil: true });
    if (url.pathname === "/api/premium-screenshot") return await handleScreenshot(req, res, url, { premium: true });
    if (url.pathname === "/api/tampered-screenshot") return await handleScreenshot(req, res, url, { tampered: true });
    return sendJson(res, 404, { error: "not_found" });
  } catch (e) {
    return sendJson(res, 500, { error: "internal", message: String(e).slice(0, 200) });
  }
});

server.listen(config.port, () => {
  console.log(`spendseal-seller listening on :${config.port} (vault ${config.vault}, payTo ${config.sellerAddress})`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => { await closeBrowser(); process.exit(0); });
}
