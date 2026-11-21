import { randomBytes } from "node:crypto";
import {
  keccak256,
  recoverTypedDataAddress,
  verifyTypedData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";

// EIP-712 invoice signing, per interface spec v1.3 §2.3.
// Domain binds the invoice to one vault on one chain; the struct covers every
// field a middleman might tamper with. Rule: signer MUST equal payTo.

export const invoiceTypes = {
  Invoice: [
    { name: "vault", type: "address" },
    { name: "token", type: "address" },
    { name: "payTo", type: "address" },
    { name: "amountUnits", type: "uint256" },
    { name: "nonce", type: "bytes32" },
    { name: "expiresAt", type: "uint64" },
  ],
};

export function invoiceDomain(vault) {
  return {
    name: "NadGate Invoice",
    version: "1",
    chainId: config.chainId,
    verifyingContract: vault,
  };
}

const sellerAccount = privateKeyToAccount(config.sellerPrivateKey);

/**
 * Issue a fresh invoice for `url`. `payToOverride` exists ONLY for the /evil
 * phishing-simulation route: it produces an invoice whose payTo is the attacker
 * while the signature still comes from the real seller key — the exact forgery
 * shape the bridge must reject (signer != payTo, and payTo not whitelisted).
 */
export async function issueInvoice(url, { payToOverride, priceOverride } = {}) {
  const nonce = ("0x" + randomBytes(32).toString("hex"));
  const ref = keccak256(nonce);
  const expiresAt = Math.floor(Date.now() / 1000) + config.invoiceTtlSeconds;
  const payTo = payToOverride ?? config.sellerAddress;
  const message = {
    vault: config.vault,
    token: config.usdc,
    payTo,
    // evil route is "cheaper"; priceOverride powers the premium (over-limit) route
    amountUnits: payToOverride ? 10_000n : (priceOverride ?? config.priceUnits),
    nonce,
    expiresAt: BigInt(expiresAt),
  };
  const signature = await sellerAccount.signTypedData({
    domain: invoiceDomain(config.vault),
    types: invoiceTypes,
    primaryType: "Invoice",
    message,
  });
  const invoice = {
    scheme: "monad-passport-vault",
    chainId: config.chainId,
    amountUnits: message.amountUnits.toString(),
    token: config.usdc,
    tokenDecimals: 6,
    payTo,
    vault: config.vault,
    nonce,
    ref,
    expiresAt,
    signature,
  };
  return { invoice, url, consumed: false };
}

/**
 * Bridge-side verification (same logic spendseal-mcp will run before paying):
 * signature recovers to payTo, and context fields match expectations.
 * Exported here so the e2e test exercises the exact algorithm.
 */
export async function verifyInvoice(invoice, { expectedVault, expectedToken } = {}) {
  if (invoice.chainId !== config.chainId) return { ok: false, reason: "wrong_chain" };
  if (expectedVault && invoice.vault.toLowerCase() !== expectedVault.toLowerCase())
    return { ok: false, reason: "wrong_vault" };
  if (expectedToken && invoice.token.toLowerCase() !== expectedToken.toLowerCase())
    return { ok: false, reason: "wrong_token" };
  if (invoice.expiresAt < Math.floor(Date.now() / 1000))
    return { ok: false, reason: "invoice_expired" };
  const message = {
    vault: invoice.vault,
    token: invoice.token,
    payTo: invoice.payTo,
    amountUnits: BigInt(invoice.amountUnits),
    nonce: invoice.nonce,
    expiresAt: BigInt(invoice.expiresAt),
  };
  const valid = await verifyTypedData({
    address: invoice.payTo,
    domain: invoiceDomain(invoice.vault),
    types: invoiceTypes,
    primaryType: "Invoice",
    message,
    signature: invoice.signature,
  }).catch(() => false);
  if (!valid) {
    // Distinguish "signed by someone else" from garbage, for clearer agent errors.
    const recovered = await recoverTypedDataAddress({
      domain: invoiceDomain(invoice.vault),
      types: invoiceTypes,
      primaryType: "Invoice",
      message,
      signature: invoice.signature,
    }).catch(() => null);
    return { ok: false, reason: "invoice_signature_invalid", recovered };
  }
  return { ok: true };
}
