import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Load the repo-root .env (shared with contracts work) without extra deps.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const env = {};
try {
  for (const line of readFileSync(resolve(root, ".env"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
} catch { /* fall through to process.env */ }

const get = (k, dflt) => process.env[k] ?? env[k] ?? dflt;

export const config = {
  // Cloud platforms inject PORT; SELLER_PORT stays the local-dev override.
  port: Number(process.env.PORT ?? get("SELLER_PORT", "8787")),
  rpcUrl: get("MONAD_RPC_URL", "https://testnet-rpc.monad.xyz"),
  chainId: 10143,
  vault: get("VAULT_ADDRESS"),
  usdc: get("USDC_TESTNET", "0x534b2f3A21130d7a60830c2Df862319e593943A3"),
  sellerAddress: get("SELLER_ADDRESS"),
  sellerPrivateKey: get("SELLER_PRIVATE_KEY"),
  attackerAddress: get("ATTACKER_ADDRESS"),
  priceUnits: 50_000n, // 0.05 USDC per screenshot (spec §2.1)
  invoiceTtlSeconds: 300,
};

if (!config.vault || !config.sellerPrivateKey || !config.sellerAddress) {
  throw new Error("Missing VAULT_ADDRESS / SELLER_PRIVATE_KEY / SELLER_ADDRESS (repo-root .env)");
}
