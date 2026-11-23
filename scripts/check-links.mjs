#!/usr/bin/env node
// Checks every tracker link in trackers.json.
//
//   node scripts/check-links.mjs
//
// Exit code 1 means at least one link looks dead (404, 410, or the domain no longer
// resolves) and is not listed in scripts/link-check-known.json. Sites that refuse
// scripts (401/403/429) are reported as "blocked" and do not fail the run: most law
// firm sites do this, and their pages load fine in a browser.
//
// No dependencies. Needs Node 18 or newer.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { trackers } = JSON.parse(fs.readFileSync(path.join(ROOT, "trackers.json"), "utf8"));
const known = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/link-check-known.json"), "utf8"));
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const TIMEOUT_MS = 30000;
const CONCURRENCY = 8;

async function check(t) {
  const host = new URL(t.url).hostname.replace(/^www\./, "");
  try {
    const res = await fetch(t.url, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*;q=0.8", "accept-language": "en-US,en;q=0.9" },
    });
    if (res.body) res.body.cancel().catch(() => {});
    let verdict = "ok";
    if (res.status === 404 || res.status === 410) verdict = "dead";
    else if ([401, 403, 429].includes(res.status)) verdict = "blocked";
    else if (res.status >= 400) verdict = "error";
    const moved = res.redirected && new URL(res.url).hostname.replace(/^www\./, "") !== host ? res.url : "";
    return { t, host, verdict, detail: String(res.status), moved };
  } catch (e) {
    const code = (e.cause && e.cause.code) || e.name || "error";
    const verdict = code === "ENOTFOUND" ? "dead" : "error";
    return { t, host, verdict, detail: code, moved: "" };
  }
}

const results = [];
const queue = [...trackers];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (let t = queue.shift(); t; t = queue.shift()) results.push(await check(t));
}));

for (const r of results) if (r.verdict === "dead" && known[r.host]) { r.verdict = "known"; r.detail += ` (${known[r.host]})`; }
const by = v => results.filter(r => r.verdict === v);
const lines = [];
const section = (title, list) => {
  if (!list.length) return;
  lines.push(`\n### ${title} (${list.length})\n`);
  for (const r of list) lines.push(`- ${r.t.name}: ${r.detail} ${r.t.url}${r.moved ? ` -> now ${r.moved}` : ""}`);
};
lines.push(`## Link check: ${by("ok").length} ok, ${by("blocked").length} blocked, ${by("known").length} known false alarm, ${by("error").length} unclear, ${by("dead").length} dead (of ${results.length})`);
section("Dead: fix or mark Stale", by("dead"));
section("Unclear: timeouts and server errors, worth a look if they repeat", by("error"));
section("Moved to another domain", results.filter(r => r.moved));
section("Blocked: site refuses scripts, check by hand during a refresh", by("blocked"));
section("Known false alarms", by("known"));
const report = lines.join("\n") + "\n";
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
process.exit(by("dead").length ? 1 : 0);
