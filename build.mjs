#!/usr/bin/env node
// Builds the site from its data.
//
//   trackers.json + changelog.json + src/template.html
//     -> index.html     the page, with every tracker written into the table as plain HTML
//     -> trackers.csv   the same data for spreadsheets
//     -> sitemap.xml
//
// Usage:
//   node build.mjs           write the files
//   node build.mjs --check   write nothing; exit 1 if the committed files are out of date
//
// No dependencies. Needs Node 18 or newer.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const CHECK = process.argv.includes("--check");

const doc = JSON.parse(read("trackers.json"));
const changelog = JSON.parse(read("changelog.json"));
const template = read("src/template.html");
const trackers = doc.trackers;

// ── Validate ────────────────────────────────────────────────
const errors = [];
const REQUIRED = ["id", "name", "org", "category", "tab", "scope", "jurisdictions", "topics", "format", "url", "cadence", "status", "cost", "interactive", "added", "verified", "description"];
const templateIds = new Set([...template.matchAll(/\bid="([^"{}$]+)"/g)].map(m => m[1]));
const RESERVED = new Set(["gaps", "changelog", "criteria", "suggest", "meta-tracker", ...templateIds]);
const seen = new Set();
for (const t of trackers) {
  const where = `"${t.name || t.id || "?"}"`;
  for (const k of REQUIRED) if (t[k] === undefined || t[k] === "") errors.push(`${where}: missing ${k}`);
  if (!/^[a-z][a-z0-9-]*$/.test(t.id || "")) errors.push(`${where}: id must be lowercase letters, digits and hyphens`);
  if (seen.has(t.id)) errors.push(`${where}: duplicate id ${t.id}`);
  if (RESERVED.has(t.id)) errors.push(`${where}: id ${t.id} is reserved by the page`);
  seen.add(t.id);
  if (!doc.categories[t.category]) errors.push(`${where}: unknown category ${t.category}`);
  if (!doc.tabs[t.tab]) errors.push(`${where}: unknown tab ${t.tab}`);
  if (!["Active", "Stale"].includes(t.status)) errors.push(`${where}: status must be Active or Stale`);
  for (const j of t.jurisdictions || []) if (!doc.jurisdictions[j]) errors.push(`${where}: unknown jurisdiction ${j}`);
  for (const x of t.topics || []) if (!doc.topics[x]) errors.push(`${where}: unknown topic ${x}`);
  if (!(t.jurisdictions || []).length) errors.push(`${where}: needs at least one jurisdiction`);
  if (!(t.topics || []).length) errors.push(`${where}: needs at least one topic`);
  if (!/^https?:\/\//.test(t.url || "")) errors.push(`${where}: url must start with http(s)://`);
  for (const k of ["added", "verified"]) if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(t[k] || "")) errors.push(`${where}: ${k} must look like 2026-11`);
  if (typeof t.interactive !== "boolean") errors.push(`${where}: interactive must be true or false`);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.reviewed || "")) errors.push("reviewed must look like 2026-11-23");
for (const e of changelog) if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || "") || !e.title || !Array.isArray(e.items)) errors.push(`changelog entry ${JSON.stringify(e.title)} needs date, title and items`);
if (errors.length) {
  console.error("trackers.json has problems:\n  " + errors.join("\n  "));
  process.exit(1);
}

// ── Helpers ─────────────────────────────────────────────────
const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = iso => { const [y, m, d] = iso.split("-").map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };
const shortMonth = ym => { const [y, m] = ym.split("-").map(Number); return `${MONTHS[m - 1].slice(0, 3)} ${y}`; };
const domainOf = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const latestAdded = trackers.map(t => t.added).sort().pop();
const tabNames = Object.keys(doc.tabs);
const count = tab => trackers.filter(t => t.tab === tab).length;

// ── Data for the page script (short keys keep the page small) ──
const pageData = trackers.map(t => ({
  id: t.id, n: t.name, o: t.org, c: t.category, cl: doc.categories[t.category], s: t.scope, st2: t.jurisdictions,
  tp: t.topics, f: t.format, u: t.url, cd: t.cadence, d: t.description, st: t.status, cost: t.cost,
  interactive: t.interactive, tab: t.tab, a: t.added, v: t.verified,
}));
// "<" is escaped so no description can ever close the script tag.
const js = v => JSON.stringify(v).replace(/</g, "\\u003c");
const dataBlock =
  "const T=[\n" + pageData.map(t => js(t) + ",").join("\n") + "\n];\n" +
  `const TOPICS=${js(doc.topics)};\n` +
  `const JURS=${js(doc.jurisdictions)};\n` +
  `const META=${js({ reviewed: doc.reviewed, latest: latestAdded })};`;

// ── Static table rows: what a reader or crawler without JavaScript gets ──
function staticRow(t) {
  const domain = domainOf(t.url);
  const tags = t.topics.map(x => `<span class="tag">${esc(doc.topics[x])}</span>`).join("");
  const chip = t.status === "Active" ? "chip-active" : "chip-stale";
  return `<tr id="${esc(t.id)}" data-tab="${t.tab}"${t.status === "Active" ? "" : ' class="stale"'}>
<td></td>
<td><a class="cell-name" href="#${esc(t.id)}">${esc(t.name)}</a></td>
<td class="cell-org">${esc(t.org)}</td>
<td><span class="chip chip-scope">${esc(doc.categories[t.category])}</span></td>
<td>${esc(t.scope)}</td>
<td><span class="chip chip-format">${esc(t.format.split(",")[0])}</span></td>
<td>${esc(t.cadence)}</td>
<td><span class="chip ${chip}">${esc(t.status)}</span></td>
<td class="link-cell"><a href="${esc(t.url)}" rel="noopener noreferrer">${esc(domain.length > 24 ? domain.slice(0, 22) + "…" : domain)}</a></td>
</tr>
<tr class="desc-row" data-tab="${t.tab}"><td colspan="9">${esc(t.description)}
<div class="desc-meta"><span class="tags">${tags}</span><span>Cost: ${esc(t.cost)}</span><span>Last verified ${shortMonth(t.verified)}</span></div></td></tr>`;
}
const rows = tabNames.map(tab => {
  const list = trackers.filter(t => t.tab === tab).sort((a, b) => a.name.localeCompare(b.name));
  return `<tr class="static-group" data-tab="${tab}"><td colspan="9"><h2>${esc(doc.tabs[tab])} <span>${list.length}</span></h2></td></tr>\n` +
    list.map(staticRow).join("\n");
}).join("\n");

// ── Changelog ───────────────────────────────────────────────
const changelogHtml = '  <ol class="log-list">\n' + changelog.map(e =>
  `    <li class="log-entry"><h4>${esc(e.title)} <time datetime="${e.date}">${longDate(e.date)}</time></h4>\n      <ul>\n` +
  e.items.map(i => `        <li>${esc(i)}</li>`).join("\n") + "\n      </ul></li>"
).join("\n") + "\n  </ol>";

// ── Structured data ─────────────────────────────────────────
const jsonld = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Dataset",
  name: "AI Policy Tracker Tracker dataset",
  description: `A catalog of ${trackers.length} trackers that follow AI legislation, regulation, litigation, and policy, with scope, format, update cadence, status, and cost for each.`,
  url: doc.site,
  license: doc.licenseUrl,
  dateModified: doc.reviewed,
  creator: { "@type": "Person", name: "Daniel Kalish", url: "https://x.com/Daniel_Kalish_" },
  distribution: [
    { "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: doc.site + "trackers.csv" },
    { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: doc.site + "trackers.json" },
  ],
}, null, 2).replace(/</g, "\\u003c");

// ── Assemble index.html ─────────────────────────────────────
const tokens = {
  "/*{{DATA}}*/": dataBlock,
  "<!--{{ROWS}}-->": rows,
  "<!--{{CHANGELOG}}-->": changelogHtml,
  "{{JSONLD}}": jsonld,
  "{{ROUNDED}}": Math.floor(trackers.length / 10) * 10 + "+",
  "{{TOTAL}}": String(trackers.length),
  "{{REVIEWED_ISO}}": doc.reviewed,
  "{{REVIEWED_HUMAN}}": longDate(doc.reviewed),
  "{{LICENSE}}": esc(doc.license),
  "{{N_POLICY}}": String(count("policy")),
  "{{N_LITIGATION}}": String(count("litigation")),
  "{{N_ADJACENT}}": String(count("adjacent")),
};
let html = template;
for (const [k, v] of Object.entries(tokens)) {
  if (!html.includes(k)) { console.error(`src/template.html is missing the ${k} placeholder`); process.exit(1); }
  html = html.split(k).join(v);
}
const left = html.match(/\{\{[A-Z_]+\}\}/);
if (left) { console.error(`Unfilled placeholder ${left[0]} in src/template.html`); process.exit(1); }
if (!html.startsWith("<!DOCTYPE html>\n")) { console.error("src/template.html must start with <!DOCTYPE html>"); process.exit(1); }
html = html.replace("<!DOCTYPE html>\n", "<!DOCTYPE html>\n<!-- Generated by build.mjs from src/template.html and trackers.json. Edit those, not this file. -->\n");

// ── CSV ─────────────────────────────────────────────────────
const cell = v => { const s = String(v == null ? "" : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const COLS = [
  ["id", t => t.id], ["name", t => t.name], ["organization", t => t.org], ["category", t => doc.categories[t.category]],
  ["tab", t => doc.tabs[t.tab]], ["scope", t => t.scope], ["jurisdictions", t => t.jurisdictions.map(j => doc.jurisdictions[j]).join("; ")],
  ["topics", t => t.topics.map(x => doc.topics[x]).join("; ")], ["format", t => t.format], ["url", t => t.url],
  ["cadence", t => t.cadence], ["status", t => t.status], ["cost", t => t.cost], ["interactive", t => (t.interactive ? "yes" : "no")],
  ["added", t => t.added], ["last_verified", t => t.verified], ["description", t => t.description],
];
// The leading BOM is what makes Excel read the file as UTF-8.
const csv = "﻿" + [COLS.map(c => c[0]).join(","), ...trackers.map(t => COLS.map(c => cell(c[1](t))).join(","))].join("\r\n") + "\r\n";

// ── Sitemap ─────────────────────────────────────────────────
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${doc.site}</loc>
    <lastmod>${doc.reviewed}</lastmod>
  </url>
</urlset>
`;

// ── Write or check ──────────────────────────────────────────
const outputs = { "index.html": html, "trackers.csv": csv, "sitemap.xml": sitemap };
let stale = 0;
for (const [file, content] of Object.entries(outputs)) {
  const p = path.join(ROOT, file);
  const current = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
  if (CHECK) {
    if (current !== content) { console.error(`${file} is out of date. Run: node build.mjs`); stale++; }
  } else if (current !== content) {
    fs.writeFileSync(p, content);
    console.log(`wrote ${file}`);
  }
}
if (CHECK && stale) process.exit(1);
console.log(`${trackers.length} trackers (${tabNames.map(t => `${count(t)} ${t}`).join(", ")}), reviewed ${doc.reviewed}${CHECK ? ": files are up to date" : ""}`);
