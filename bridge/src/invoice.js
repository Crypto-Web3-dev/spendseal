import { recoverTypedDataAddress, verifyTypedData } from "viem";
import { config } from "./config.js";

// Bridge-side invoice verification — identical algorithm to the seller's
// (interface spec v1.3 §2.3), kept as a self-contained copy so this package
// can be published standalone. Runs BEFORE any on-chain interaction:
// an invoice that fails here never produces a transaction.

const invoiceTypes = {
  Invoice: [
    { name: "vault", type: "address" },
    { name: "token", type: "address" },
    { name: "payTo", type: "address" },
    { name: "amountUnits", type: "uint256" },
    { name: "nonce", type: "bytes32" },
    { name: "expiresAt", type: "uint64" },
  ],
};

const domainFor = (vault) => ({
  name: "NadGate Invoice",
  version: "1",
  chainId: config.chainId,
  verifyingContract: vault,
});

export async function verifyInvoice(invoice) {
  if (!invoice || typeof invoice !== "object")
    return { ok: false, code: "invoice_malformed" };
  if (invoice.chainId !== config.chainId) return { ok: false, code: "wrong_chain" };
  if (invoice.vault?.toLowerCase() !== config.vault.toLowerCase())
    return { ok: false, code: "invoice_signature_invalid", detail: "vault mismatch" };
  if (invoice.token?.toLowerCase() !== config.usdc.toLowerCase())
    return { ok: false, code: "invoice_signature_invalid", detail: "token mismatch" };
  if (invoice.expiresAt < Math.floor(Date.now() / 1000))
    return { ok: false, code: "invoice_expired" };

  const message = {
    vault: invoice.vault,
    token: invoice.token,
    payTo: invoice.payTo,
    amountUnits: BigInt(invoice.amountUnits),
    nonce: invoice.nonce,
    expiresAt: BigInt(invoice.expiresAt),
  };
  const typed = {
    domain: domainFor(invoice.vault),
    types: invoiceTypes,
    primaryType: "Invoice",
    message,
    signature: invoice.signature,
  };
  const valid = await verifyTypedData({ address: invoice.payTo, ...typed }).catch(() => false);
  if (!valid) {
    const recovered = await recoverTypedDataAddress(typed).catch(() => null);
    return { ok: false, code: "invoice_signature_invalid", detail: `signer=${recovered}` };
  }
  return { ok: true };
}
