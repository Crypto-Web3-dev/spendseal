#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { formatUnits } from "viem";
import { config } from "./config.js";
import { verifyInvoice } from "./invoice.js";
import {
  readPassport, passportSnapshot, checkPay, simulateTryPay, sendTryPay,
  REASON_BY_CODE, HINT_BY_CODE,
} from "./vault.js";

// SpendSeal MCP bridge. The agent gets exactly two tools:
//   pay_for_api      — buy something within the on-chain passport's rules
//   passport_status  — read-only view of the passport
// There is deliberately NO tool for limits, whitelist, revoke or withdraw:
// those are owner-wallet-only actions (see README "tool boundary").

const server = new McpServer({ name: "spendseal-mcp", version: "0.1.0" });

const errResult = (error) => ({
  isError: true,
  content: [{ type: "text", text: JSON.stringify({ ok: false, error }, null, 2) }],
});

function structuredError(code, message, { invoice, passport, onChainRecord = null } = {}) {
  return errResult({
    code, message,
    ...(invoice ? { invoice: {
      amountUnits: invoice.amountUnits, payTo: invoice.payTo, ref: invoice.ref,
    } } : {}),
    ...(passport ? { passport } : {}),
    onChainRecord,
    hint: HINT_BY_CODE[code] ?? "请把上面的原因如实告诉用户。",
  });
}

async function resolvePath(apiPath) {
  const url = new URL(apiPath, config.sellerApiBase);
  return url;
}

server.registerTool(
  "passport_status",
  {
    description:
      "查看我的 SpendSeal 护照状态（只读）：单笔/每日限额、今日已付、余额、是否熔断、白名单外付款会被拒。不花钱、不发交易。",
    inputSchema: {},
  },
  async () => {
    const { passport, remaining } = await readPassport();
    const snap = passportSnapshot(passport);
    const text =
      `护照 #${snap.passportId}（Monad 测试网）\n` +
      `状态：${snap.revoked ? "已熔断（不可付款）" : "有效"}\n` +
      `单笔限额：${snap.singleLimit}｜日限额：${snap.dailyLimit}\n` +
      `今日已付：${snap.spentToday}｜累计已付：${snap.spentTotal}\n` +
      `护照余额：${snap.balance}｜现在最多还能付：${formatUnits(remaining, 6)} USDC\n` +
      `过期时间：${snap.expiry}｜拒绝上链审计：${snap.logRejections ? "开" : "关"}`;
    return { content: [{ type: "text", text }] };
  },
);

server.registerTool(
  "pay_for_api",
  {
    description:
      "调用一个按次收费的 API 并自动付款。流程全自动：拿到 402 报价 → 验证卖家发票签名 → 用链上护照预检 → 在护照规则内付款 → 带付款证明取回结果。" +
      "超限额、白名单外、发票签名无效都会被拒绝，并返回结构化原因（请把原因如实转述给用户，不要自行绕过）。",
    inputSchema: {
      api_path: z.string().describe("卖家接口路径，如 /api/screenshot?url=https://example.com"),
      max_amount_units: z.string().optional()
        .describe("可选：本次可接受的最高价（USDC 6 位单位整数，如 \"50000\" = 0.05 USDC）；报价高于它直接放弃"),
    },
  },
  async ({ api_path, max_amount_units }) => {
    const url = await resolvePath(api_path);

    // 1) first request: expect 402 + invoice
    const first = await fetch(url);
    if (first.status === 200) {
      const buf = Buffer.from(await first.arrayBuffer());
      return { content: [{ type: "text", text: `接口未收费，直接返回 ${buf.length} 字节（${first.headers.get("content-type")}）` }] };
    }
    if (first.status !== 402) {
      return structuredError("seller_error", `卖家接口返回 HTTP ${first.status}，未给出 402 报价。`);
    }
    const invoice = await first.json().catch(() => null);
    if (!invoice) return structuredError("seller_error", "卖家返回的 402 报价不是合法 JSON。");

    // 2) verify the seller's EIP-712 signature BEFORE anything on-chain
    const sig = await verifyInvoice(invoice);
    const { passport } = await readPassport();
    const snap = passportSnapshot(passport);
    if (!sig.ok) {
      return structuredError("invoice_signature_invalid",
        `发票签名验证失败（${sig.detail ?? sig.code}），已拒绝付款，未发出任何交易。`,
        { invoice, passport: snap });
    }
    if (!invoice.ref || /^0x0+$/.test(invoice.ref)) {
      return structuredError("invalid_ref", "发票缺失有效 ref，按规则拒绝付款。", { invoice, passport: snap });
    }
    if (max_amount_units && BigInt(invoice.amountUnits) > BigInt(max_amount_units)) {
      return structuredError("price_too_high",
        `报价 ${formatUnits(BigInt(invoice.amountUnits), 6)} USDC 高于本次最高接受价 ${formatUnits(BigInt(max_amount_units), 6)} USDC，已放弃。`,
        { invoice, passport: snap });
    }

    // 3) on-chain pre-flight + 4) pay (tryPay unifies both spec paths)
    const amount = BigInt(invoice.amountUnits);
    const pre = await checkPay(invoice.payTo, amount);
    if (!pre.ok) {
      let onChainRecord = null;
      if (passport.logRejections) {
        // Record the rejection on-chain for audit, then report it.
        onChainRecord = await sendTryPay(invoice.payTo, amount, invoice.ref);
      }
      return structuredError(pre.reason,
        `护照预检未通过：${pre.reason}。${passport.logRejections ? "本次拒绝已按护照设置记录上链。" : ""}`,
        { invoice, passport: snap, onChainRecord });
    }
    const [willOk, simCode] = await simulateTryPay(invoice.payTo, amount, invoice.ref);
    if (!willOk) {
      const code = REASON_BY_CODE[simCode] ?? "unknown";
      let onChainRecord = null;
      if (passport.logRejections) onChainRecord = await sendTryPay(invoice.payTo, amount, invoice.ref);
      return structuredError(code, `付款在执行前校验失败：${code}。`, { invoice, passport: snap, onChainRecord });
    }
    const txHash = await sendTryPay(invoice.payTo, amount, invoice.ref);

    // 5) retry with the payment proof
    const paid = await fetch(url, { headers: { "x-payment-tx": txHash } });
    if (!paid.ok) {
      const body = await paid.json().catch(() => ({}));
      return structuredError("seller_verification_failed",
        `已付款（tx ${txHash}）但卖家未接受付款证明：${body.reason ?? paid.status}。请把 txHash 给用户处理。`,
        { invoice, passport: snap, onChainRecord: txHash });
    }
    const ctype = paid.headers.get("content-type") || "";
    const summary = {
      ok: true,
      payment: {
        txHash, amountUnits: invoice.amountUnits,
        amount: `${formatUnits(amount, 6)} USDC`,
        payee: invoice.payTo, ref: invoice.ref,
      },
    };
    if (ctype.includes("image/png")) {
      const buf = Buffer.from(await paid.arrayBuffer());
      // Best-effort local copy so the screenshot is viewable on screen
      // (e.g. WSL Claude CLI, where the MCP image is visible to the model
      // but not displayed in the terminal). Never fails the paid call:
      // a write error is only logged. Path is fixed so the demo machine
      // can open it via \\wsl$\Ubuntu\... \ bridge/demo/last-screenshot.png.
      let savedNote = "";
      try {
        const outPath = new URL("../demo/last-screenshot.png", import.meta.url);
        await writeFile(outPath, buf);
        savedNote = `\n截图已保存到桥目录 demo/last-screenshot.png（${buf.length} 字节），可用文件管理器直接打开查看。`;
      } catch (e) {
        console.error("[spendseal-mcp] could not save last-screenshot.png:", e?.message ?? e);
      }
      return {
        content: [
          { type: "text", text: `${JSON.stringify(summary)}\n已付款并取回截图（${buf.length} 字节）。${savedNote}` },
          { type: "image", data: buf.toString("base64"), mimeType: "image/png" },
        ],
      };
    }
    const text = await paid.text();
    return { content: [{ type: "text", text: `${JSON.stringify(summary)}\nAPI 返回：\n${text.slice(0, 4000)}` }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("spendseal-mcp ready (passport #" + config.passportId.toString() + ", vault " + config.vault + ")");
