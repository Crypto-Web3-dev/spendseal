import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Config comes from the MCP host's env (Claude Desktop config sets it).
// For local development we fall back to the repo-root .env.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fileEnv = {};
try {
  for (const line of readFileSync(resolve(root, ".env"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) fileEnv[m[1]] = m[2].trim();
  }
} catch { /* env-only mode */ }

const get = (k, dflt) => process.env[k] ?? fileEnv[k] ?? dflt;

export const config = {
  rpcUrl: get("RPC_URL", get("MONAD_RPC_URL", "https://testnet-rpc.monad.xyz")),
  rpcUrlBackup: get("RPC_URL_BACKUP", "https://rpc-testnet.monadinfra.com"),
  chainId: 10143,
  vault: get("VAULT_ADDRESS"),
  passportId: BigInt(get("PASSPORT_ID", "1")),
  agentPrivateKey: get("AGENT_PRIVATE_KEY"),
  usdc: get("USDC_ADDRESS", get("USDC_TESTNET", "0x534b2f3A21130d7a60830c2Df862319e593943A3")),
  sellerApiBase: get("SELLER_API_BASE", "http://localhost:8787"),
};

if (!config.vault || !config.agentPrivateKey) {
  throw new Error("spendseal-mcp: VAULT_ADDRESS and AGENT_PRIVATE_KEY are required");
}
