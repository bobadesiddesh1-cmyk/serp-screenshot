# DECISIONS.md — SERP Snapshot

This log records every design decision made while building the extension,
especially where the build spec left something to a "sensible default".
Read this alongside the inline comments in `content/serp-adapter.js` when
Google changes its markup and selectors need repair.

## Fixed by spec (implemented as written)

- **Manifest V3**, vanilla JS, no build step, loads unpacked as-is.
- **Permissions: `storage` only.** No `downloads`, `tabs`, `scripting`, or
  host permissions beyond the two declared content-script matches. No network
  requests, no analytics — verified by grepping the source for `fetch`,
  `XMLHttpRequest`, `sendBeacon`, `import(` and remote URLs.
- **Content-script hosts:** `www.google.com/search*` and
  `www.google.co.in/search*` registered explicitly. Other Google TLDs are not
  matched by the manifest (would require host permissions we don't request),
  but the adapter's fallback strategies are TLD-agnostic, so if a user drops
  the extension onto another TLD via an updated manifest it still works.
- **Downloads via Blob + anchor-click** (no `downloads` permission).
- **Clipboard via `navigator.clipboard.writeText()`** — invoked from the popup,
  which is a user-gesture context, so it is allowed.
- **All on-page UI in Shadow DOM**, dark-mode aware, wrapped in try/catch with
  silent failure.

## Defaults chosen where the spec was open

1. **Icons are generated as flat-color PNGs** with a simple "SS" glyph, created
   at build time via a tiny generator (`icons/make-icons` is documented in the
   README). They are placeholders — replace with brand art before Web Store
   submission. Chosen because the spec required the four sizes to exist and load
   cleanly; art direction was unspecified.
2. **PAA auto-expansion count = first 4** (as specified). Wait after each click
   = **350ms** (`PAA_EXPAND_WAIT_MS`), chosen as a balance between reliability
   (Google lazy-loads answer content) and staying responsive. Tunable constant.
3. **Extraction debounce on soft-navigation = 600ms** (`SOFT_NAV_DEBOUNCE_MS`).
   Google's SPA navigations fire several DOM mutations; 600ms lets the new SERP
   settle before we re-parse.
4. **History cap = 20 entries** (as specified). Stored under
   `chrome.storage.local` key `serp_snapshot_history`.
5. **Settings defaults:**
   - `defaultFormat`: `"csv"`
   - `includeAllSections` (multi-file CSV export): `true`
   - `includeSitelinks` (sitelink sub-rows in organic CSV): `true`
   - `includeRichResults` (separate rich-results section): `true`
   Stored under `chrome.storage.local` key `serp_snapshot_settings`.
6. **"Top 10 organic" for the AIO cross-reference** means organic positions
   1–10 inclusive, counting organic results only (ads/carousels already
   excluded from numbering). Sitelink sub-rows do NOT count toward the 10.
7. **Domain normalization** for cross-referencing strips a leading `www.` and
   lowercases the host, so `www.Example.com` and `example.com` match. Chosen so
   the "cited AND ranks" stat isn't defeated by trivial host differences.
8. **CSV newline** = `\r\n` (Excel-friendly). Fields are always quoted when they
   contain a comma, quote, CR or LF; embedded quotes are doubled (RFC 4180).
   A UTF-8 BOM is prepended so Excel opens accented characters correctly.
9. **Multi-file CSV export** downloads four separate `.csv` files
   (organic / paa / related / aio) staggered by a few ms each so Chrome doesn't
   collapse them into a single "multiple downloads" block silently. Chosen over
   a zip because we have no zipping library and want zero dependencies.
10. **Clipboard format** = tab-separated values with a metadata header line,
    section headers, and a blank line between sections. Pastes into Sheets/Excel
    with columns aligned.
11. **Search location detection** reads the `uule`, `gl`, and `near` URL params
    if present; otherwise reports `"not detected"`. `uule` is base64-ish and not
    decoded (that's a heavier job) — we surface it raw so power users can decode
    it. Chosen as minimal-viable "if detectable from URL params".
12. **Badge position** = top-right of the viewport, `position: fixed`, high
    z-index, pointer-events limited to the badge itself so it never blocks SERP
    interaction. Auto-hides its "capturing…" state when done.
13. **Message passing:** popup ↔ content script via
    `chrome.tabs.sendMessage`. The content script keeps the last capture in
    memory so the popup can request it without forcing a re-parse, but the popup
    "Capture" button always triggers a fresh parse.

## Known limitations (documented, not bugs)

- We do NOT auto-expand every PAA (only the first 4) — deeper expansion is
  explicitly out of scope per spec.
- We do NOT click the AI Overview "Show more" control; we extract visible
  citations and flag `partially-expanded`. Clicking would risk layout thrash and
  is out of scope per spec.
- Google's markup is obfuscated and changes frequently. The adapter is built in
  three fallback tiers precisely so a selector break degrades gracefully. See
  the "Selector repair guide" in README.md.
