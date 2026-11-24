# AGENTS.md — Collection Archive

Use when maintaining or extending this app. It is a **deployed production PWA** whose
owner uses it daily: every commit to `main` is a live release. Update in small verified
steps and never let untested code reach `main`.

## What this is

A single-file, local-first collection archive. **There is no backend by design** — do
not add servers, databases, analytics, or auth. The privacy model (user data lives in
the user's browser; the host holds only ciphertext) is the product. Features may grow;
that invariant does not.

## Repo ↔ deployment

- `main` deploys automatically to https://wildwinslow.github.io/archive/ via GitHub
  Pages (no build step — the files in the repo ARE the app).
- Deployment takes ~1–2 minutes. Verify with the live suite (below), not by assuming.
- `share.json` is the owner's **published encrypted snapshot** (user data, ciphertext).
  It is served to viewers. Do not delete, edit, or commit any plaintext substitute.

## File map

| File | Role |
|---|---|
| `index.html` | THE app — all HTML/CSS/JS in one file |
| `sw.js` | service worker (offline shell; contains the `CACHE` version) |
| `manifest.webmanifest`, `icon-*.png` | PWA install metadata + icons |
| `share.json` | owner's encrypted share snapshot (user data — treat as sacred) |
| `tests/` | core logic suite + browser e2e + live-site suite + fixtures |
| `README.md` | user-facing docs + architecture diagrams |

Runtime deps: **none**. Dev deps (`package.json`): `playwright-core`, `pngjs`.

## Architecture invariants

1. **Single-file app.** All UI/logic lives in `index.html` inside one `<script>` block.
   Keep it that way; the deploy is a file copy.
2. **Data key:** `localStorage["winslow.collections.v1"]`. State shape:
   `{ items, wishlist, sets, cats, history }`. Both `items` and `wishlist` share the
   entry schema. `history` is `[{d: 'YYYY-MM-DD', v: number}]` — one snapshot per day.
3. **Pure core is testable without a browser.** The core functions (`normalizeItem`,
   `mergeItems`, `filterItems`, `stats`, `meltValue`, `worth`, `recordHistory`,
   `sparkPath`, `parseYearRange`, `certLink`, `originMap`, `encryptSnapshot`, …) are
   plain functions in the script block. `tests/core.test.js` extracts the block with a
   `/<script>([\s\S]*?)<\/script>/` regex and `require`s it. Export new pure functions
   via `module.exports` at the bottom of the script or the core suite cannot reach them.
4. **Zero-knowledge sharing.** `share.json` is AES-GCM-256 ciphertext; the key is
   derived from the owner's passcode via PBKDF2 (150k iterations, SHA-256, random
   salt). The passcode never leaves the device. Never introduce a code path that sends
   user data (or passcodes) to any server.

## Data contracts (do not break)

**Entry schema** (`normalizeItem` is the validator): `id`, `name` (≤140), `cat` (≤40),
`qty` (≥1), `cond` (≤30), `date`, `value` (≥0), `paid` (≥0), `metal` (`''|'silver'|'gold'`),
`fineWt` (0–100000), `yearFrom`/`yearTo` (1000–2100 or 0; `yearTo` auto-fixed),
`country` (≤40), `mint` (≤40), `denom` (≤40), `verified` (`''|'user'|'rook'|'graded'`),
`grade` (≤60), `notes` (≤2000), `photo` (`data:image/...` or null), `created`, `updated`.

**Merge contract** (`mergeItems`): match by `id`; missing → append; existing → higher
`updated` wins; ties keep the LOCAL copy. Must stay **idempotent** — re-importing the
same file does nothing. Entry files are `{items: [...], wishlist?: [...], cats?: [...]}`.
External tools (appraisal agents) generate these; changing the schema breaks their output.

**Cert links** (`certLink`): parses grader + number out of `grade` text. PCGS →
`https://www.pcgs.com/cert/<n>`, NGC → `https://www.ngccoin.com/certlookup/<n>` (handles
`1234567-001` dashes), ANACS/ICG → verify pages. Conventional grade string:
`"NGC MS65 · cert 4735931-007"`. Failure mode must stay benign (unknown grader → no link).

**Melt presets** (`SILVER_PRESETS`): published fine-silver weights (troy oz). `dime90
0.07234`, `qtr90 0.18084`, `half90 0.36169`, `dollar90 0.77344`, `warNi 0.05626`,
`half40 0.14790`. These are physical constants — do not "adjust" them.

**Spot prices**: `GET https://api.gold-api.com/price/XAG|XAU` → `{price, ...}`, cached in
`localStorage["winslow.spot.v1"]`. Keyless, CORS-open. App must render fine with no
network (last cached price) or no cache (melt values simply omitted).

## Update workflow (every change)

1. Edit `index.html` / `sw.js` in the repo.
2. **Bump `CACHE` in `sw.js`** (e.g. `archive-v12` → `archive-v13`) whenever any shell
   file changes. Forgetting this pins real users to the old build — the #1 trap.
3. Run the suites (below). All green or no push.
4. Commit with a message that names the feature; push to `main`.
5. Wait for Pages (`gh api repos/wildwinslow/archive/pages --jq .status` → `built`),
   then run `npm run test:live` and confirm the deployed build carries your change.

## Testing

```bash
npm install
npm test            # core logic, no browser (fast)
npm run test:e2e    # full browser suite against the repo (needs Chromium)
npm run test:live   # acceptance against the deployed site
```

Browser suites need a Chromium: `npx playwright-core install chromium` (or set
`PLAYWRIGHT_BROWSERS_PATH` to an existing install). Target: **all suites green before
every push** (currently 141 + 131 + 37 ≈ 309 assertions).

## Known traps (all previously hit)

- **`CACHE` bump forgotten** → users stuck on the old shell. See workflow step 2.
- **HTML5 `step` on numeric inputs**: fine weights have 5 decimals — use `step="any"`
  or the form silently refuses to submit (no error shown).
- **CSS `text-transform: uppercase`** breaks `innerText`-based test assertions (the DOM
  text is fine; the rendered text shouts). Assert on `textContent` in tests.
- **Leading questions poison vision reads**: when building photo-appraisal features,
  never feed the model the answer to look for. Neutral re-reads fixed a coin that was
  misidentified three ways before breakfast.
- **`confirm()` dialogs in tests**: register the `dialog` handler BEFORE the click, and
  only once — duplicate handlers throw mid-suite.
- **Fresh-context vs viewer gate**: any fresh browser hits the passcode gate when
  `share.json` has data (correct behavior). Test contexts must seed an empty owner key
  via `addInitScript` to exercise owner features.
- **`route()` mocking**: match by hostname predicate, not URL glob — globs silently
  miss and the "mock" never fires.
- **Stray `process.exit()`** after an async test IIFE silently kills async assertions.
- **Name collisions in `const`** across test sections — suffix test locals (`wst`, `yi1`).

## Data safety (public repo)

- The repo is public. **Never commit real collection data**: appraisal entry files,
  photos of owned items, or plaintext backups. Test fixtures use fake items only.
- `share.json` is the only file with real user content and it must remain ciphertext.
  When replacing it (publishing a new snapshot), keep the format: `{v, kdf, salt, iv, data}`.
- Screenshot artifacts (`*.png`) are gitignored; keep them out of commits.

## Adding features

Match existing patterns: coin-gated fields use the `cat === '' || /coin/i.test(cat)`
gate (`updateMintUI`); new form fields need `normalizeItem` pass-through + clamping,
form fill in `openModal`, submit carry, card tag, search haystack, and core.test coverage;
new views branch in `renderGrid` and toggle in `renderViewbar`. Keep the app usable
offline and read-only for viewers (`locked`/`viewerMode` guards). Every feature ships
with tests — the suites are the definition of done.
