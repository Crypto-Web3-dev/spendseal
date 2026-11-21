import { createPublicClient, createWalletClient, http, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";

export const vaultAbi = [
  { type: "function", name: "getPassport", stateMutability: "view",
    inputs: [{ name: "passportId", type: "uint256" }],
    outputs: [{ name: "", type: "tuple", components: [
      { name: "owner", type: "address" }, { name: "agent", type: "address" },
      { name: "singleLimit", type: "uint256" }, { name: "dailyLimit", type: "uint256" },
      { name: "spentToday", type: "uint256" }, { name: "currentDay", type: "uint64" },
      { name: "spentTotal", type: "uint256" }, { name: "expiry", type: "uint64" },
      { name: "revoked", type: "bool" }, { name: "logRejections", type: "bool" },
      { name: "balance", type: "uint256" },
    ] }] },
  { type: "function", name: "remainingAllowance", stateMutability: "view",
    inputs: [{ name: "passportId", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "checkPay", stateMutability: "view",
    inputs: [
      { name: "passportId", type: "uint256" }, { name: "payee", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [
      { name: "ok", type: "bool" }, { name: "code", type: "uint8" },
      { name: "reason", type: "string" },
    ] },
  { type: "function", name: "tryPay", stateMutability: "nonpayable",
    inputs: [
      { name: "passportId", type: "uint256" }, { name: "payee", type: "address" },
      { name: "amount", type: "uint256" }, { name: "ref", type: "bytes32" },
    ],
    outputs: [{ name: "ok", type: "bool" }, { name: "reasonCode", type: "uint8" }] },
];

const chain = {
  id: config.chainId, name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
};

export const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
const agent = privateKeyToAccount(config.agentPrivateKey);
export const walletClient = createWalletClient({ account: agent, chain, transport: http(config.rpcUrl) });
export const agentAddress = agent.address;

export const REASON_BY_CODE = {
  1: "passport_not_found", 2: "passport_revoked", 3: "passport_expired",
  4: "payee_not_whitelisted", 5: "over_single_limit", 6: "over_daily_limit",
  7: "insufficient_balance", 8: "invalid_ref",
};

export const HINT_BY_CODE = {
  passport_not_found: "护照不存在，请让用户确认护照编号。",
  passport_revoked: "护照已被主人熔断，任何付款都会被拒；请让用户新建护照。",
  passport_expired: "护照已过期，请让用户续期或新建护照。",
  payee_not_whitelisted: "收款方不在护照白名单内；如需付款，请让用户在控制台把该地址加入白名单。",
  over_single_limit: "报价超过护照单笔限额；请让用户在控制台提高单笔限额，或放弃本次购买。",
  over_daily_limit: "今日额度已用尽（UTC 次日自动恢复）；请让用户提高日限额或明天再试。",
  insufficient_balance: "护照余额不足；请让用户在控制台存入 USDC。",
  invalid_ref: "卖家发票缺少有效的付款引用（ref），已按规则拒绝付款。",
  invoice_signature_invalid: "发票签名验证失败：发票可能被篡改或伪造，已拒绝付款且未发出任何交易。请不要重试同一发票。",
  invoice_expired: "发票已过期，请重新获取报价。",
  price_too_high: "报价高于本次允许的最高价（max_amount_units），已放弃购买。",
};

export async function readPassport() {
  const p = await publicClient.readContract({
    address: config.vault, abi: vaultAbi, functionName: "getPassport",
    args: [config.passportId],
  });
  const remaining = await publicClient.readContract({
    address: config.vault, abi: vaultAbi, functionName: "remainingAllowance",
    args: [config.passportId],
  });
  return { passport: p, remaining };
}

export function passportSnapshot(p) {
  const usdc = (u) => `${formatUnits(u, 6)} USDC`;
  return {
    passportId: String(config.passportId),
    owner: p.owner, agent: p.agent,
    singleLimit: usdc(p.singleLimit), dailyLimit: usdc(p.dailyLimit),
    spentToday: usdc(p.spentToday), spentTotal: usdc(p.spentTotal),
    balance: usdc(p.balance),
    expiry: p.expiry === 0n ? "never" : new Date(Number(p.expiry) * 1000).toISOString(),
    revoked: p.revoked, logRejections: p.logRejections,
    singleLimitUnits: p.singleLimit.toString(),
    dailyLimitUnits: p.dailyLimit.toString(),
    spentTodayUnits: p.spentToday.toString(),
  };
}

export async function checkPay(payee, amount) {
  const [ok, code, reason] = await publicClient.readContract({
    address: config.vault, abi: vaultAbi, functionName: "checkPay",
    args: [config.passportId, payee, amount],
  });
  return { ok, code, reason };
}

/** Simulate tryPay to learn its verdict without spending gas. */
export async function simulateTryPay(payee, amount, ref) {
  const { result } = await publicClient.simulateContract({
    address: config.vault, abi: vaultAbi, functionName: "tryPay",
    args: [config.passportId, payee, amount, ref],
    account: agent,
  });
  return result; // [ok, reasonCode]
}

export async function sendTryPay(payee, amount, ref) {
  const hash = await walletClient.writeContract({
    address: config.vault, abi: vaultAbi, functionName: "tryPay",
    args: [config.passportId, payee, amount, ref],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
