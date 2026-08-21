// Reports transcoding status for every video in Cloudflare Stream.
// Usage: node scripts/stream-status.mjs

import { existsSync, readFileSync } from "node:fs";

function loadEnv() {
  const path = new URL("../.env.local", import.meta.url);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_TOKEN = process.env.CLOUDFLARE_STREAM_TOKEN;
const cfBase = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/stream`;

const res = await fetch(`${cfBase}?limit=1000`, { headers: { Authorization: `Bearer ${CF_TOKEN}` } });
const json = await res.json();
const vids = (json.result || []).sort((a, b) => (a.meta?.name || "").localeCompare(b.meta?.name || ""));

let ready = 0;
for (const v of vids) {
  const state = v.status?.state || "?";
  const pct = v.status?.pctComplete != null ? `${Math.round(v.status.pctComplete)}%` : "";
  if (state === "ready") ready++;
  console.log(
    `${state === "ready" ? "✓" : "…"} ${(v.meta?.name || v.uid).padEnd(22)} ${state.padEnd(12)} ${pct.padStart(4)}  ${v.uid}`
  );
}
console.log(`\n${ready}/${vids.length} ready.`);
