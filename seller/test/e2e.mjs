// End-to-end test against the REAL Monad testnet vault:
//   1) invoice issued (402) and its EIP-712 signature verifies (signer == payTo)
//   2) tampered invoice fails verification (S-G shape)
//   3) phishing invoice (evil route) fails verification (S-A shape)
//   4) agent pays through PassportVault with the invoice ref
//   5) retry with X-PAYMENT-TX returns a real PNG screenshot
//   6) replaying the same tx is rejected (nonce consumed, S-C shape)
// Costs 0.05 test USDC from passport #1. Run: npm run test:e2e
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { verifyInvoice } from "../src/invoice.js";
import { config } from "../src/config.js";

const BASE = `http://localhost:${config.port}`;
// Screenshot target: the seller's own /demo-page (always loadable, incl. on
// networks where outbound proxy quirks break Chromium). Swap to any public
// URL when running on an unrestricted network — the flow is identical.
const TARGET = `${BASE}/demo-page`;

const env = {};
for (const line of readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const vaultAbi = [
  { type: "function", name: "pay", stateMutability: "nonpayable",
    inputs: [
      { name: "passportId", type: "uint256" }, { name: "payee", type: "address" },
      { name: "amount", type: "uint256" }, { name: "ref", type: "bytes32" },
    ], outputs: [] },
];

function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; throw new Error(msg); }
  console.log("ok -", msg);
}

const server = spawn("node", ["src/server.js"], { cwd: new URL("..", import.meta.url).pathname, stdio: "pipe" });
try {
  // wait for health
  for (let i = 0; i < 30; i++) {
    try { const r = await fetch(`${BASE}/health`); if (r.ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }

  // 1) invoice + signature
  const r1 = await fetch(`${BASE}/api/screenshot?url=${encodeURIComponent(TARGET)}`);
  assert(r1.status === 402, `invoice issued with HTTP 402 (got ${r1.status})`);
  const invoice = await r1.json();
  const v1 = await verifyInvoice(invoice, { expectedVault: config.vault, expectedToken: config.usdc });
  assert(v1.ok, "invoice signature verifies, signer == payTo");

  // 2) tampered amount fails
  const tampered = { ...invoice, amountUnits: "500000" };
  const v2 = await verifyInvoice(tampered, { expectedVault: config.vault });
  assert(!v2.ok, `tampered invoice rejected (${v2.reason})`);

  // 3) phishing invoice fails (payTo is attacker; signature is seller's)
  const rEvil = await fetch(`${BASE}/api/evil-screenshot?url=${encodeURIComponent(TARGET)}`);
  const evil = await rEvil.json();
  const v3 = await verifyInvoice(evil, { expectedVault: config.vault });
  assert(!v3.ok, `phishing invoice rejected (${v3.reason})`);

  // 4) real payment through the vault (passport #1)
  const agent = privateKeyToAccount(env.AGENT_PRIVATE_KEY);
  const wallet = createWalletClient({ account: agent, transport: http(config.rpcUrl) });
  const txHash = await wallet.writeContract({
    address: config.vault, abi: vaultAbi, functionName: "pay",
    args: [1n, config.sellerAddress, BigInt(invoice.amountUnits), invoice.ref],
    chain: { id: config.chainId, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [config.rpcUrl] } } },
  });
  console.log("payment tx:", txHash);

  // 5) retry with proof -> PNG
  const r2 = await fetch(`${BASE}/api/screenshot?url=${encodeURIComponent(TARGET)}`, {
    headers: { "x-payment-tx": txHash },
  });
  assert(r2.status === 200, `paid retry returns 200 (got ${r2.status})`);
  assert((r2.headers.get("content-type") || "").includes("image/png"), "content-type is image/png");
  const png = Buffer.from(await r2.arrayBuffer());
  assert(png.length > 3000 && png.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])), `real PNG received (${png.length} bytes)`);
  writeFileSync(new URL("./shot.png", import.meta.url), png);
  console.log("screenshot saved to test/shot.png");

  // 6) replay rejected
  const r3 = await fetch(`${BASE}/api/screenshot?url=${encodeURIComponent(TARGET)}`, {
    headers: { "x-payment-tx": txHash },
  });
  const replay = await r3.json();
  assert(r3.status === 402 && replay.reason === "nonce_already_consumed", `replay rejected (${replay.reason})`);

  console.log("\nE2E ALL GREEN");
} finally {
  server.kill("SIGTERM");
}
