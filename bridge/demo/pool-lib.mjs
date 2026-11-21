// Shared helpers for the POOL demo scripts (SpendSeal team budget pool).
// Targets PoolVault (POOL_VAULT_ADDRESS in repo-root .env), NOT the single-agent
// PassportVault. Owner/agent stage scripts — never shipped to the agent itself.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, formatUnits, verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { vaultAbi } from "../src/vault.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const env = {};
for (const line of readFileSync(resolve(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

export const POOL = env.POOL_VAULT_ADDRESS;
export const ADDR = {
  pool: POOL,
  usdc: "0x534b2f3A21130d7a60830c2Df862319e593943A3",
  owner: env.OWNER_ADDRESS,
  agentA: env.AGENT_ADDRESS,
  agentB: env.AGENT2_ADDRESS,
  seller: env.SELLER_ADDRESS,
};

const chain = {
  id: 10143, name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
};
// The public RPC intermittently times out (ETIMEDOUT on connect) and rate-limits
// bursts. viem's defaults (3 tries, ~150ms) are far too impatient for a live
// demo, where a transient network blip must not abort the act on stage.
const transport = http(chain.rpcUrls.default.http[0], {
  retryCount: 8,
  retryDelay: 700,
  timeout: 30_000,
});
export const pub = createPublicClient({ chain, transport });
const mkWallet = (key) => createWalletClient({ account: privateKeyToAccount(key), chain, transport });
export const ownerWallet = mkWallet(env.OWNER_PRIVATE_KEY);
export const agentAWallet = mkWallet(env.AGENT_PRIVATE_KEY);
export const agentBWallet = mkWallet(env.AGENT2_PRIVATE_KEY);
export const usdc = (u) => `${formatUnits(u, 6)} USDC`;
export const SELLER_BASE = process.env.SELLER_API_BASE ?? "http://localhost:8787";

// PoolVault ABI = PassportVault ABI + pool additions (cards + approvals).
export const poolAbi = [
  ...vaultAbi,
  { type: "function", name: "getCard", stateMutability: "view",
    inputs: [{ name: "passportId", type: "uint256" }, { name: "agent", type: "address" }],
    outputs: [{ name: "active", type: "bool" }, { name: "dailyCap", type: "uint256" }, { name: "spentToday", type: "uint256" }] },
  { type: "function", name: "checkPayFor", stateMutability: "view",
    inputs: [{ name: "passportId", type: "uint256" }, { name: "agent", type: "address" }, { name: "payee", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "ok", type: "bool" }, { name: "code", type: "uint8" }, { name: "reason", type: "string" }] },
  { type: "function", name: "requestApproval", stateMutability: "nonpayable",
    inputs: [{ name: "passportId", type: "uint256" }, { name: "payee", type: "address" }, { name: "amount", type: "uint256" }, { name: "ref", type: "bytes32" }],
    outputs: [{ name: "requestId", type: "uint256" }] },
  { type: "function", name: "getRequest", stateMutability: "view",
    inputs: [{ name: "passportId", type: "uint256" }, { name: "requestId", type: "uint256" }],
    outputs: [{ name: "", type: "tuple", components: [
      { name: "agent", type: "address" }, { name: "payee", type: "address" },
      { name: "amount", type: "uint256" }, { name: "ref", type: "bytes32" }, { name: "state", type: "uint8" }] }] },
  { type: "function", name: "nextRequestId", stateMutability: "view",
    inputs: [{ name: "passportId", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "event", name: "ApprovalRequested",
    inputs: [{ name: "passportId", type: "uint256", indexed: true }, { name: "requestId", type: "uint256", indexed: true },
             { name: "agent", type: "address", indexed: true }, { name: "payee", type: "address" },
             { name: "amount", type: "uint256" }, { name: "ref", type: "bytes32" }] },
  { type: "event", name: "ApprovalExecuted",
    inputs: [{ name: "passportId", type: "uint256", indexed: true }, { name: "requestId", type: "uint256", indexed: true }] },
];

export async function getPool(id) {
  return pub.readContract({ address: POOL, abi: poolAbi, functionName: "getPassport", args: [BigInt(id)] });
}
export async function getCard(id, agent) {
  const [active, dailyCap, spentToday] = await pub.readContract({
    address: POOL, abi: poolAbi, functionName: "getCard", args: [BigInt(id), agent],
  });
  return { active, dailyCap, spentToday };
}

// Same EIP-712 verification the bridge performs (spec v1.3 §2.3), with the
// expected vault pinned to the POOL address.
const invoiceTypes = {
  Invoice: [
    { name: "vault", type: "address" }, { name: "token", type: "address" },
    { name: "payTo", type: "address" }, { name: "amountUnits", type: "uint256" },
    { name: "nonce", type: "bytes32" }, { name: "expiresAt", type: "uint64" },
  ],
};
export async function verifyPoolInvoice(invoice) {
  if (!invoice || typeof invoice !== "object") return { ok: false, code: "invoice_malformed" };
  if (invoice.vault?.toLowerCase() !== POOL.toLowerCase())
    return { ok: false, code: "invoice_signature_invalid", detail: "vault mismatch (invoice not for this pool)" };
  if (invoice.token?.toLowerCase() !== ADDR.usdc.toLowerCase())
    return { ok: false, code: "invoice_signature_invalid", detail: "token mismatch" };
  if (invoice.expiresAt < Math.floor(Date.now() / 1000)) return { ok: false, code: "invoice_expired" };
  const valid = await verifyTypedData({
    address: invoice.payTo,
    domain: { name: "NadGate Invoice", version: "1", chainId: 10143, verifyingContract: invoice.vault },
    types: invoiceTypes, primaryType: "Invoice",
    message: {
      vault: invoice.vault, token: invoice.token, payTo: invoice.payTo,
      amountUnits: BigInt(invoice.amountUnits), nonce: invoice.nonce, expiresAt: BigInt(invoice.expiresAt),
    },
    signature: invoice.signature,
  }).catch(() => false);
  return valid ? { ok: true } : { ok: false, code: "invoice_signature_invalid" };
}

// One full seller round-trip for a given wallet: 402 → verify → tryPay → claim.
// Returns { txHash, bytes } or throws with a readable message.
const PAY_REASON = {
  2: "已熔断", 3: "已过期", 4: "收款方不在白名单", 5: "超单笔上限",
  6: "池子总日限已满", 7: "池余额不足", 9: "卡子额度已满", 10: "不是本池的卡",
};

// tryPay does NOT revert on a business-rule failure — the tx succeeds and
// returns (false, code), optionally emitting PaymentRejected. So a successful
// receipt does NOT mean the payment went through; we must decode the return
// value. Getting this wrong makes a refusal look like a delivery failure.
export async function buyWithWallet(wallet, id, url) {
  const first = await fetch(url);
  if (first.status !== 402) throw new Error(`卖家返回 HTTP ${first.status}，不是 402`);
  const invoice = await first.json();
  const sig = await verifyPoolInvoice(invoice);
  if (!sig.ok) throw new Error(`发票验签失败：${sig.code} ${sig.detail ?? ""}`);
  const amount = BigInt(invoice.amountUnits);
  const hash = await wallet.writeContract({
    address: POOL, abi: poolAbi, functionName: "tryPay",
    args: [BigInt(id), invoice.payTo, amount, invoice.ref],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`付款交易失败：${hash}`);

  // Decode the vault's verdict rather than inferring it from delivery.
  const [me] = await wallet.getAddresses();
  const ret = await pub.call({
    to: POOL, abi: poolAbi, functionName: "checkPayFor",
    args: [BigInt(id), me, invoice.payTo, amount],
  }).catch(() => null);

  const paid = await fetch(url, { headers: { "X-PAYMENT-TX": hash } });
  if (!paid.ok) {
    // The seller refused to deliver, which is the correct behaviour when the
    // vault did not actually pay. Report the vault's reason, not a fake
    // "paid but delivery failed".
    const code = ret ? Number(ret[1]) : null;
    throw Object.assign(
      new Error(`链上拒绝付款${code !== null && code !== 0 ? `（${code} ${PAY_REASON[code] ?? "规则拦截"}）` : ""}：tx ${hash.slice(0, 18)}…，卖家未交货（HTTP ${paid.status}）`),
      { rejected: true, code, txHash: hash },
    );
  }
  const buf = Buffer.from(await paid.arrayBuffer());
  return { txHash: hash, bytes: buf, amount };
}
