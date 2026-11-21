// ERC-8004 identity registration for the demo agent (display-only bonus:
// the agent gets an on-chain identity card; the payment path NEVER reads
// this registry — the passport vault is the only authority).
// The agent registers ITSELF (its own key signs, it owns the identity NFT).
// Registry: ERC-8004 Identity Registry on Monad testnet, getVersion = 2.0.0
// (address cross-checked against Fuku's Metropolis deployment records).
// Usage: node demo/register-identity.mjs [--force]
import { pub, agentWallet, ADDR } from "./lib.mjs";

const REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const abi = [
  { type: "function", name: "register", stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }], outputs: [{ name: "agentId", type: "uint256" }] },
  { type: "function", name: "ownerOf", stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "tokenURI", stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "balanceOf", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "getVersion", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "string" }] },
];

const version = await pub.readContract({ address: REGISTRY, abi, functionName: "getVersion" });
console.log(`ERC-8004 注册表 ${REGISTRY}，版本 ${version}`);

const owned = await pub.readContract({ address: REGISTRY, abi, functionName: "balanceOf", args: [ADDR.agent] });
if (owned > 0n && !process.argv.includes("--force")) {
  console.log(`Agent 名下已有 ${owned} 个身份 NFT，本次跳过（确要再注册加 --force）。`);
  process.exit(0);
}

const registration = {
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  name: "SpendSeal Demo Agent",
  description:
    "Desktop AI agent (Claude) that buys pay-per-call APIs through a SpendSeal on-chain passport on Monad testnet: " +
    "USDC sits in a PassportVault, every payment is checked in-contract (per-payment cap, daily cap, payee whitelist, " +
    "expiry, kill switch), and sellers issue EIP-712 signed invoices. This identity is display-only; the payment path never consults this registry.",
  services: [
    { name: "spendseal-passport", endpoint: `eip155:10143:${ADDR.vault}`, version: "1.0.0" },
    { name: "mcp-tools", endpoint: "spendseal-mcp (stdio): pay_for_api, passport_status", version: "0.1.0" },
  ],
  active: true,
  supportedTrust: ["reputation"],
};
const agentURI = "data:application/json;base64," +
  Buffer.from(JSON.stringify(registration), "utf8").toString("base64");

const { result: agentId } = await pub.simulateContract({
  address: REGISTRY, abi, functionName: "register", args: [agentURI], account: agentWallet.account,
});
const hash = await agentWallet.writeContract({
  address: REGISTRY, abi, functionName: "register", args: [agentURI],
});
await pub.waitForTransactionReceipt({ hash });
console.log(`注册交易：${hash}`);

const owner = await pub.readContract({ address: REGISTRY, abi, functionName: "ownerOf", args: [agentId] });
const uriBack = await pub.readContract({ address: REGISTRY, abi, functionName: "tokenURI", args: [agentId] });
const decoded = JSON.parse(Buffer.from(uriBack.split(",")[1], "base64").toString("utf8"));
console.log(`agentId = ${agentId}，持有者 = ${owner}（${owner.toLowerCase() === ADDR.agent.toLowerCase() ? "就是 Agent 本人 ✅" : "⚠️ 不是 Agent"}）`);
console.log(`注册文档回读：name = "${decoded.name}"，services = ${decoded.services.map((s) => s.name).join(", ")}`);
console.log(`浏览器查看：https://testnet.monadvision.com/token/${REGISTRY}?tab=inventory（按持有者 ${ADDR.agent} 筛）`);
