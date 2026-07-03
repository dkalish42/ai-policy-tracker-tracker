# Security & Quality Review — AI Policy Tracker Tracker

**Date:** 2026-07-03
**Reviewer:** Automated security & quality review
**Scope:** All source, config, dependency manifests, and scripts. Build artifacts, binary assets, and vendored deps excluded (none present). Git history scanned for secrets.

---

## Summary

This is a **static, client-only website**: a single `index.html` (HTML/CSS/inline JS) plus static assets, deployed to Vercel and GitHub. There is **no backend, no server code, no database, no authentication, no dependency manifest** (`package.json`, `requirements.txt`, etc.) and therefore **no third-party runtime dependencies to CVE-check** — the only external network resource is Google Fonts loaded over HTTPS. The classic server-side attack surface (SQLi, command injection, SSRF, insecure deserialization, auth bypass, file upload) **does not exist here**. That materially limits severity: the tracker data (`T[]`) is hardcoded, author-controlled content, and the one user input (the search box) is used only for `Array.filter`, never written to the DOM.

Nothing Critical or High was found. The real issues are **information exposure** (internal working files committed and publicly served) and **missing hardening** (link `rel`, HTTP security headers).

### Counts by severity

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High     | 0 |
| Medium   | 1 |
| Low      | 5 |

### Fixed in this review
- **M1** — Untracked/removed internal files (`Due Diligence Report.md`, `AI Policy Tracker Tracker.xlsx`) from the repo so they stop being served publicly.
- **L1** — Added `rel="noopener noreferrer"` to all JS-generated `target="_blank"` links.
- **L2** — Added `vercel.json` with HTTP security headers (CSP, `frame-ancestors`, `nosniff`, `Referrer-Policy`).
- **L3** — Hardened the Konami easter-egg DOM sink to strip attacker-influenceable URL parts.
- **L5** — Added `.claude/` to `.gitignore` to prevent accidental commit of local settings.

### Needs your attention (deferred — see details)
- **L4** — Three demo HTML files (`demo-bento-playful.html`, `demo-dark-glass.html`, `demo-table-dense.html`) are committed and publicly served. They may be intentional design showcases, so I did **not** remove them. Decide whether to keep or `git rm` them.

### Areas reviewed and found clean
- **Search input handling** — the query string `q` is only used in `.includes()` for filtering; it is never inserted into `innerHTML`. No reflected/DOM XSS from search.
- **Secrets** — full `git log -p` history scan plus a working-tree sweep found no API keys, tokens, passwords, or private keys. `.vercel/project.json` (project/org IDs, not secrets) and `.claude/settings.local.json` are untracked/gitignored.
- **Dependencies** — none to audit (no package manifest; no bundled JS libraries).
- **Injection (SQL/command/path)** — no server, no filesystem or shell access, no dynamic queries. Not applicable.

---

## Findings

### M1 — Internal working files committed and publicly served
**Severity:** Medium
**Files:** `Due Diligence Report.md`, `AI Policy Tracker Tracker.xlsx`

**Description.** Both files are tracked in git and, because Vercel deploys the repo root, are reachable at public URLs:
- `https://ai-policy-tracker-tracker.vercel.app/Due%20Diligence%20Report.md` → HTTP 200
- `https://ai-policy-tracker-tracker.vercel.app/AI%20Policy%20Tracker%20Tracker.xlsx` → HTTP 200

**Why it's harmful.** `Due Diligence Report.md` is an internal working document — it addresses the author in the second person ("Your current draft contains 31 trackers…"), contains editorial corrections, source-verification notes, and strategic gap analysis not meant for publication. The `.xlsx` is the underlying source spreadsheet. Neither is linked from the site, but both are directly downloadable by anyone who guesses or scrapes the path, and search engines can index them. This is unintentional information disclosure of pre-publication/internal material.

**Fix applied.** `git rm --cached` both files and added them to `.gitignore`, so they are removed from the deployed site while remaining on the author's disk. This does **not** change anything a normal visitor sees (the files were never part of the UI). History still contains them; if the content is considered sensitive, history rewriting would be a separate, destructive step — flagged, not performed. **Commit:** see "fix: stop serving internal files" below.

---

### L1 — Reverse tabnabbing: JS-generated external links miss `rel="noopener noreferrer"`
**Severity:** Low
**File:** `index.html:1116`, `index.html:1178`, `index.html:1338`

**Description.** The two static header links to x.com correctly use `rel="noopener"`, but the three `target="_blank"` links generated in JavaScript (table link cell, compare-drawer link, quiz-result link) do not:
```js
<a href="${t.u}" target="_blank">…            // line 1116
<a href="${val}" target="_blank" style=…>…    // line 1178
<a href="${r.tracker.u}" target="_blank">…    // line 1338
```

**Why it's harmful.** Without `rel="noopener"`, a page opened in the new tab receives a `window.opener` reference to this page and can navigate it elsewhere (reverse tabnabbing / phishing). Modern browsers imply `noopener` for `target="_blank"` since ~2021, so exploitability is limited to older browsers — hence Low — but the explicit attribute is the standard best practice and matches what the static links already do.

**Fix applied.** Added `rel="noopener noreferrer"` to all three generated links. **Commit:** "fix: add rel=noopener to generated external links (L1)".

---

### L2 — No HTTP security headers (clickjacking, no CSP)
**Severity:** Low
**File:** (new) `vercel.json`

**Description.** The deployment sends no `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, or `Referrer-Policy`. The site can be framed by any origin (clickjacking) and has no defense-in-depth against content injection.

**Why it's harmful.** Impact is low because the page performs no sensitive/state-changing actions (nothing to clickjack into), but headers are cheap hardening and `frame-ancestors 'none'` closes the framing vector outright.

**Fix applied.** Added `vercel.json` with a header set tuned not to break the site (the page relies on inline `<script>`/`<style>` and the Google Fonts import, so the CSP intentionally allows `'unsafe-inline'` for script/style and whitelists `fonts.googleapis.com`/`fonts.gstatic.com`). A strict nonce-based CSP would require refactoring all inline code and is out of scope for a minimal fix. **Commit:** "fix: add HTTP security headers via vercel.json (L2)".

---

### L3 — DOM-XSS sink in Konami easter egg via `window.location.href`
**Severity:** Low
**File:** `index.html:1594` (was), rendered at `index.html:1116`

**Description.** The easter-egg row sets `u: window.location.href` and that value is later interpolated **unescaped** into an `href` attribute string built with `innerHTML` (`<a href="${t.u}" …>`). The URL (including query string and fragment) is partially attacker-influenceable: a crafted link such as `…/#"><img src=x onerror=…>` would break out of the attribute.

**Why it's harmful.** This is essentially self-XSS — it requires luring a victim to a crafted URL **and** getting them to type the 10-key Konami sequence, so practical risk is very low. But it is a genuine unescaped-input-to-innerHTML sink and the only place any non-authored value reaches the DOM as markup.

**Fix applied.** Stripped the query and fragment from the URL before use (`window.location.href.split('#')[0].split('?')[0]`), removing the attacker-controllable portion. **Commit:** "fix: sanitize easter-egg URL sink (L3)".

---

### L4 — Demo HTML files publicly served (needs your decision)
**Severity:** Low
**Files:** `demo-bento-playful.html`, `demo-dark-glass.html`, `demo-table-dense.html`

**Description.** Three alternate design mockups are committed and served (HTTP 200 at their public paths). They contain older/superseded copies of the tracker dataset and are not linked from the live site.

**Why it might matter.** They expose stale data and unfinished designs at guessable URLs. However, they may be **intentional** — kept online to share design options with collaborators. Because removing them changes what the repo publishes and I can't confirm intent, I did not touch them.

**Recommended approach.** If they are leftovers, `git rm demo-*.html` and add `demo-*.html` to `.gitignore`. If they are shared showcases, leave them. **Deferred — awaiting your decision.**

---

### L5 — `.claude/settings.local.json` not gitignored
**Severity:** Low
**File:** `.gitignore`

**Description.** The local Claude Code settings file (containing local tool-permission allowlists — not secrets) is currently untracked but the `.claude/` directory is not in `.gitignore`, so it could be committed accidentally by a future `git add`.

**Fix applied.** Added `.claude/` to `.gitignore`. **Commit:** "chore: gitignore .claude local settings (L5)".

---

## Bugs / quality notes (non-security)

No functional bugs of consequence were found in the application logic. Minor observations, none fixed (out of scope for a security review, no risk):
- The table/compare/quiz render paths interpolate the hardcoded `T[]` fields into `innerHTML` without escaping. This is **not** a vulnerability today because the data is author-controlled, but a contributor adding a field value containing `"` or `<` could break layout. Defense-in-depth (an escape helper) would prevent that; left as-is to keep the fix minimal and behavior unchanged.
- `render()` re-attaches event listeners on every keystroke/sort; correct, just mildly wasteful — no leak because `innerHTML` replacement discards the old nodes and their listeners.
