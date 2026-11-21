// Shared helpers for the demo/rehearsal scripts. Reads the repo-root .env
// directly (owner key included — these are OWNER/agent stage scripts,
// never shipped to the agent itself).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { vaultAbi } from "../src/vault.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const env = {};
for (const line of readFileSync(resolve(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

export const ADDR = {
  vault: env.VAULT_ADDRESS,
  usdc: "0x534b2f3A21130d7a60830c2Df862319e593943A3",
  owner: env.OWNER_ADDRESS,
  agent: env.AGENT_ADDRESS,
  seller: env.SELLER_ADDRESS,
  attacker: env.ATTACKER_ADDRESS,
};
const chain = {
  id: 10143, name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
};
export const pub = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) });
export const ownerWallet = createWalletClient({
  account: privateKeyToAccount(env.OWNER_PRIVATE_KEY), chain,
  transport: http(chain.rpcUrls.default.http[0]),
});
export const agentWallet = createWalletClient({
  account: privateKeyToAccount(env.AGENT_PRIVATE_KEY), chain,
  transport: http(chain.rpcUrls.default.http[0]),
});
export { vaultAbi };
export const usdc = (u) => `${formatUnits(u, 6)} USDC`;
export const SELLER_BASE = process.env.SELLER_API_BASE ?? "http://localhost:8787";

export async function getPassport(id) {
  return pub.readContract({ address: ADDR.vault, abi: vaultAbi, functionName: "getPassport", args: [BigInt(id)] });
}
export async function checkPay(id, payee, amount) {
  const [ok, code, reason] = await pub.readContract({
    address: ADDR.vault, abi: vaultAbi, functionName: "checkPay",
    args: [BigInt(id), payee, amount],
  });
  return { ok, code, reason };
}
export async function agentTryPay(id, payee, amount, ref) {
  const hash = await agentWallet.writeContract({
    address: ADDR.vault, abi: vaultAbi, functionName: "tryPay",
    args: [BigInt(id), payee, amount, ref],
  });
  await pub.waitForTransactionReceipt({ hash });
  return hash;
}
