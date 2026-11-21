// Acceptance for the two new stage routes on the seller:
//   /api/premium-screenshot  — validly signed 0.10 invoice; bridge signature
//                              check PASSES, passport preflight must refuse
//                              with over_single_limit (passport #2: cap 0.05)
//   /api/tampered-screenshot — amount rewritten after signing; the bridge's
//                              signature check must FAIL (invoice_signature_invalid)
// Spawns the seller itself. Run: node test/demo-routes.mjs
import { spawn } from "node:child_process";
process.env.PASSPORT_ID = "2";
const { verifyInvoice } = await import("../src/invoice.js");
const { checkPay, readPassport } = await import("../src/vault.js");

const DEMO = "http://localhost:8787/demo-page";
let failures = 0;
const assert = (c, m) => { console.log((c ? "ok - " : "FAIL - ") + m); if (!c) failures++; };

const seller = spawn("node", ["src/server.js"], {
  cwd: new URL("../../seller", import.meta.url).pathname, stdio: "pipe",
});
try {
  for (let i = 0; i < 30; i++) {
    try { const r = await fetch("http://localhost:8787/health"); if (r.ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  const premium = await (await fetch(`http://localhost:8787/api/premium-screenshot?url=${encodeURIComponent(DEMO)}`)).json();
  assert(premium.amountUnits === "100000", `premium invoice is 0.10 USDC (got ${premium.amountUnits})`);
  const sigP = await verifyInvoice(premium);
  assert(sigP.ok, "premium invoice signature is VALID (this act is about rules, not forgery)");
  const pre = await checkPay(premium.payTo, BigInt(premium.amountUnits));
  assert(!pre.ok && pre.reason === "over_single_limit", `passport refuses premium: ${pre.reason}`);

  const tampered = await (await fetch(`http://localhost:8787/api/tampered-screenshot?url=${encodeURIComponent(DEMO)}`)).json();
  assert(tampered.amountUnits === "500000", `tampered invoice shows 0.50 USDC (got ${tampered.amountUnits})`);
  const sigT = await verifyInvoice(tampered);
  assert(!sigT.ok && sigT.code === "invoice_signature_invalid", "tampered invoice fails bridge signature check");

  const { passport } = await readPassport();
  assert(passport.spentToday === 50000n, `passport #2 untouched by both acts (spentToday still 0.05 from the bridge test, got ${passport.spentToday})`);
} finally {
  seller.kill("SIGTERM");
}
console.log(failures === 0 ? "\nDEMO ROUTES ALL GREEN" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
