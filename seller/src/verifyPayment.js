import { createPublicClient, http, parseEventLogs } from "viem";
import { config } from "./config.js";

// Payment verification, per interface spec v1.3 §2.2 (steps 1–2 here;
// steps 3–4 — nonce consumption — live in server.js where invoices are stored).

export const paymentExecutedAbi = [
  {
    type: "event",
    name: "PaymentExecuted",
    inputs: [
      { name: "passportId", type: "uint256", indexed: true },
      { name: "payee", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "ref", type: "bytes32", indexed: true },
      { name: "spentTodayAfter", type: "uint256", indexed: false },
    ],
  },
];

export const publicClient = createPublicClient({
  transport: http(config.rpcUrl),
});

const eq = (a, b) => a?.toLowerCase() === b?.toLowerCase();

/** Verify that txHash proves payment for this exact invoice. */
export async function verifyPayment(txHash, invoice) {
  let receipt;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  } catch {
    return { ok: false, reason: "tx_not_found" };
  }
  if (receipt.status !== "success") return { ok: false, reason: "tx_reverted" };

  const events = parseEventLogs({
    abi: paymentExecutedAbi,
    logs: receipt.logs.filter((l) => eq(l.address, config.vault)),
  });
  if (events.length === 0) return { ok: false, reason: "no_payment_event" };

  const byRef = events.find((e) => e.args.ref === invoice.ref);
  if (!byRef) return { ok: false, reason: "ref_mismatch" };
  if (!eq(byRef.args.payee, invoice.payTo)) return { ok: false, reason: "payee_mismatch" };
  if (byRef.args.amount < BigInt(invoice.amountUnits))
    return { ok: false, reason: "amount_too_low" };
  return { ok: true, event: byRef };
}
