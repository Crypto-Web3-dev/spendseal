// Protocol-level test of spendseal-mcp through a real MCP client (stdio):
//   tools/list -> passport_status -> phishing rejected w/o any tx ->
//   over-price aborted -> real purchase returns an image.
// The purchase spends 0.05 test USDC from passport #1 in the demo pool. Run: npm run test:client
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const DEMO = "http://localhost:8787/demo-page";
let failures = 0;
function assert(cond, msg) {
  console.log((cond ? "ok - " : "FAIL - ") + msg);
  if (!cond) failures++;
}
const textOf = (res) => res.content?.filter((c) => c.type === "text").map((c) => c.text).join("\n") ?? "";

// start the seller
const seller = spawn("node", ["src/server.js"], {
  cwd: new URL("../../seller", import.meta.url).pathname, stdio: "pipe",
});
try {
  for (let i = 0; i < 30; i++) {
    try { const r = await fetch("http://localhost:8787/health"); if (r.ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }

  const transport = new StdioClientTransport({
    command: "node",
    args: [new URL("../src/index.js", import.meta.url).pathname],
    env: {
      ...process.env,
      PASSPORT_ID: "1",
      SELLER_API_BASE: "http://localhost:8787",
    },
  });
  const client = new Client({ name: "spendseal-test-client", version: "0.1.0" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert(JSON.stringify(names) === JSON.stringify(["passport_status", "pay_for_api"]),
      `exactly two tools exposed: ${names.join(", ")}`);

    const st1 = await client.callTool({ name: "passport_status", arguments: {} });
    assert(textOf(st1).includes("日限额"), "passport_status returns readable status");
    assert(textOf(st1).includes("0.000000 USDC") || textOf(st1).includes("今日已付：0 USDC") || textOf(st1).includes("今日已付：0.000000"), "passport #1 in the demo pool starts with 0 spent today");

    // phishing: bridge must reject on signature, spending nothing
    const evil = await client.callTool({
      name: "pay_for_api",
      arguments: { api_path: `/api/evil-screenshot?url=${encodeURIComponent(DEMO)}` },
    });
    assert(evil.isError && textOf(evil).includes("invoice_signature_invalid"),
      "phishing invoice rejected by bridge (invoice_signature_invalid)");

    // price cap: buyer-side abort, no tx
    const pricey = await client.callTool({
      name: "pay_for_api",
      arguments: { api_path: `/api/screenshot?url=${encodeURIComponent(DEMO)}`, max_amount_units: "10000" },
    });
    assert(pricey.isError && textOf(pricey).includes("price_too_high"),
      "over-price purchase aborted by max_amount_units");

    const st2 = await client.callTool({ name: "passport_status", arguments: {} });
    assert(textOf(st2).includes("今日已付：0.000000 USDC") || textOf(st2).includes("今日已付：0 USDC"),
      "still 0 spent after both rejections (no transaction was sent)");

    // the real purchase
    const buy = await client.callTool({
      name: "pay_for_api",
      arguments: { api_path: `/api/screenshot?url=${encodeURIComponent(DEMO)}` },
    });
    const img = buy.content?.find((c) => c.type === "image");
    assert(!buy.isError && !!img, "real purchase returns an image through MCP");
    assert(img && img.data.length > 10000, `image payload is substantial (${img?.data.length ?? 0} base64 chars)`);
    assert(textOf(buy).includes("txHash") || textOf(buy).includes("payment"), "result includes payment summary");
    // screenshot is also saved to disk for on-screen viewing (WSL CLI case)
    const { readFile } = await import("node:fs/promises");
    const saved = await readFile(new URL("../demo/last-screenshot.png", import.meta.url)).catch(() => null);
    assert(!!saved && saved.length > 10000, `screenshot saved to demo/last-screenshot.png (${saved?.length ?? 0} bytes)`);
    assert(!!saved && Buffer.from(img.data, "base64").equals(saved), "saved file matches the returned image bytes");

    const st3 = await client.callTool({ name: "passport_status", arguments: {} });
    assert(textOf(st3).includes("今日已付：0.050000 USDC") || textOf(st3).includes("0.05 USDC"),
      "passport #1 in the demo pool now shows 0.05 USDC spent today");
  } finally {
    await client.close();
  }
} finally {
  seller.kill("SIGTERM");
}
console.log(failures === 0 ? "\nMCP CLIENT TEST ALL GREEN" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
