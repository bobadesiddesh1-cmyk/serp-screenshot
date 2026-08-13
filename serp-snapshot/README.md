# SERP Snapshot — One-Click SERP to Spreadsheet

Open any Google search results page and export everything on it — **organic
results, People Also Ask, related searches, and which domains got cited in the
AI Overview** — straight to CSV or your clipboard. The AI Overview citation
column exists nowhere else.

**100% local. Zero network calls. `storage` permission only.**

Built for SEO professionals who copy-paste SERP data into spreadsheets every day
for rank tracking, competitor research, and client reporting.

---

## Install (load unpacked)

1. Clone / download this folder (`serp-snapshot/`).
2. Open `chrome://extensions` in Chrome (or any Chromium browser).
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked** and select the `serp-snapshot/` folder.
5. Pin the extension. Open a Google search (e.g.
   `https://www.google.com/search?q=running+shoes`) and click the toolbar icon.

No build step. No dependencies. It runs exactly as the folder sits on disk.

> The four PNG icons are generated placeholders. Regenerate or replace them with
> `python3 icons/make-icons.py` (pure stdlib, no dependencies).

---

## How it works

- A **content script** runs only on `www.google.com/search*` and
  `www.google.co.in/search*` (declared in `manifest.json`).
- On load and on Google's SPA soft-navigations it does a **passive parse** and
  shows a small **Shadow-DOM badge** at the top-right of the SERP with live
  counts.
- Clicking **Capture this SERP** in the popup does a **full capture**: it
  auto-expands the first 4 People-Also-Ask questions (waiting briefly for each
  answer to render), parses all four sections, computes the AI-Overview
  cross-reference, saves a history entry, and hands the data to the popup.
- Export is **CSV** (Blob download, no `downloads` permission) or **Clipboard**
  (tab-separated, pastes straight into Google Sheets / Excel).

Everything is local. Grep the source for `fetch`, `XMLHttpRequest`,
`sendBeacon`, `WebSocket` — there are none.

---

## What gets extracted

| Section | Fields |
|---|---|
| **Organic results** | `position` (organic-only rank, ads/carousels excluded), `title`, `url` (redirect-unwrapped), `displayUrl`, `snippet`, `domain`, `sitelinks[]`, `citedByAIOverview` |
| **Rich results** | Video / Top-stories / image carousel items, captured separately with a `type` label, excluded from organic numbering |
| **People Also Ask** | `position`, `question`, `answerSnippet` (if expanded), `answerSourceUrl` (redirect-unwrapped), `nested` |
| **Related searches** | `position`, `text` |
| **AI Overview** | `aioPresent`, `citedDomains[{domain, url, title, ranksInOrganicTop10}]`, `expansionState` (`expanded` / `collapsed` / `partially-expanded`) |

**The differentiator:** for every AI-Overview-cited domain we compute whether it
*also* ranks in the organic top-10 (`ranksInOrganicTop10`), and we flag each
organic row that a cited domain matches (`cited_by_ai_overview`). That single
cross-reference is the most shareable stat in the popup and costs nothing extra.

---

## CSV column reference

Every CSV starts with a metadata block (query, capture timestamp, detected
location, source URL, section name) followed by a blank spacer line and then the
header row. Fields are RFC-4180 escaped (snippets *will* contain commas and
quotes) and the file carries a UTF-8 BOM so Excel opens accents correctly.

### `…-organic.csv`

| Column | Meaning |
|---|---|
| `position` | Organic rank (1-based). Blank on sitelink sub-rows. |
| `title` | Result title (or sitelink title). |
| `url` | Real destination (Google `/url?q=` redirect unwound). |
| `domain` | Host, lowercased, `www.` stripped. |
| `snippet` | Result snippet. |
| `is_sitelink` | `true` for indented sitelink sub-rows, else `false`. |
| `parent_position` | For a sitelink row, the position of its parent result. |
| `cited_by_ai_overview` | `true` if this domain is cited in the AI Overview. |

### `…-paa.csv`

| Column | Meaning |
|---|---|
| `position` | PAA order (1-based). |
| `question` | The question text. |
| `answer_snippet` | Answer text (present when the row was expanded). |
| `answer_source_url` | First external link in the answer (redirect-unwound). |
| `is_nested` | `true` if the question was revealed by expanding another. |

### `…-related.csv`

| Column | Meaning |
|---|---|
| `position` | Order (1-based). |
| `text` | The related-search query text. |

### `…-aioverview.csv`

| Column | Meaning |
|---|---|
| `cited_domain` | Domain cited in the AI Overview. |
| `cited_url` | Citation URL (redirect-unwound). |
| `cited_title` | Anchor text, when meaningful. |
| `ranks_in_organic_top10` | `true` if this domain also ranks in the organic top 10. |

### `…-rich.csv` (only if rich results present and the setting is on)

| Column | Meaning |
|---|---|
| `type` | `video` / `top-story` / `image` / `carousel`. |
| `title`, `url`, `domain` | As per organic. |

**Clipboard export** produces the same data as tab-separated text — one metadata
line, then each section under a `## Heading`, so it pastes into a spreadsheet
with columns aligned. **Copy organic only** copies just the organic table.

---

## Settings

- **Default export format** — CSV or Clipboard.
- **Include all sections** — also export PAA / related / AI-Overview CSVs (and
  rich results if enabled) alongside the organic CSV. Default **on**.
- **Include sitelinks as sub-rows** — default **on**.
- **Include rich-result carousel items as a separate section** — default **on**.

History keeps the **last 20 captures** (`query`, date, organic count, whether an
AI Overview was present). Clicking an entry shows its saved summary — it does not
re-fetch; re-visit the SERP and capture again for fresh data. **Clear all** wipes
history.

---

## Selector-repair guide

Google's SERP markup is obfuscated and changes often. `content/serp-adapter.js`
is built so a broken selector degrades **one** section to empty rather than
breaking the whole capture. Each data type is tried through **three strategies**
in order:

1. **KNOWN** — current, specific class/attribute selectors. *Brittle; patch here
   first.* Search the file for `STRATEGY A` comments.
2. **HEURISTIC** — structural pattern matching (e.g. "an `<a>` wrapping an `<h3>`
   under a `[data-hveid]` block"). Survives class renames.
3. **MINIMAL** — last-ditch ("any external link with a heading-styled child").

**When a section stops extracting:**

1. Open a SERP, DevTools → inspect the broken element, note its new container
   class / attribute.
2. Find the matching `STRATEGY A` block in `serp-adapter.js`:
   - Organic containers: `organicStrategyKnown` (`div.g, div.tF2Cxc, …`).
   - Ads: `AD_ANCESTOR_SEL`.
   - Snippet: `SNIPPET_SEL`. Display URL: `DISPLAY_URL_SEL`.
   - PAA rows: `paaRowsKnown`. PAA answers: `answerOf`.
   - Related: `relatedKnown`. AI Overview: `aioContainerKnown`.
3. Add the new selector to that strategy's list (keep the old ones — they're
   harmless and help older cached pages).
4. Reload the extension at `chrome://extensions`, re-capture, confirm counts.

Because the heuristic/minimal tiers key on human-visible structure and label text
("People also ask", "Related searches", "AI Overview"), most Google changes are
absorbed without any edit at all.

---

## Acceptance tests (walkthrough)

Run these by hand after loading unpacked. Automated unit + DOM tests for the pure
and parsing logic live under `../scratchpad/test-*.js` during development.

1. **Zero console errors.** Load unpacked, open a Google SERP, open DevTools
   console → no errors from the extension.
2. **Normal capture.** Click **Capture this SERP** → popup shows counts for all
   four sections; the on-page badge shows the same counts.
3. **Organic CSV.** Export → opens in Excel/Sheets; columns match the spec
   exactly; sitelinks appear as sub-rows (with `is_sitelink=true` and
   `parent_position` set) when the setting is on.
4. **PAA CSV.** Export → the first 4 questions carry `answer_snippet` values even
   though they started collapsed (the extension expanded them).
5. **AI Overview present.** On a query that shows an AI Overview → citations are
   extracted; the `cited_by_ai_overview` column marks matching organic rows;
   `ranks_in_organic_top10` is correct in the AIO CSV.
6. **No AI Overview.** On a query with none → `aioPresent: false`; the other
   three sections still export cleanly.
7. **Copy organic only.** Click it, paste into a spreadsheet → tab-separated
   columns line up.
8. **History.** The capture appears in the History tab; **Clear all** empties it.
9. **Selector break (mental test).** In `organicStrategyKnown`, temporarily
   change `div.g` to `div.__nope__` → the heuristic strategy still extracts
   organic results (verified by the DOM test's "BROKEN" scenario).

---

## Chrome Web Store listing (draft)

**Name:** SERP Snapshot — One-Click SERP to Spreadsheet

**Summary (132 chars):** Export Google SERP organic results, People Also Ask,
related searches & AI Overview citations to CSV/clipboard. 100% local.

**Description:**

> Stop copy-pasting SERPs by hand. SERP Snapshot captures everything on a Google
> search results page in one click and exports it spreadsheet-ready.
>
> • **Organic results** — clean rank table with real (redirect-unwound) URLs,
>   domains, snippets, and sitelinks as sub-rows. Ads and carousels are excluded
>   from the ranking, exactly like a rank tracker counts.
> • **People Also Ask** — questions plus answer snippets and source links; the
>   first few are auto-expanded so you actually get the answers.
> • **Related searches** — the full bottom-of-page list.
> • **AI Overview citations** — the domains Google's AI Overview cited, and a
>   one-click stat showing which of them *also* rank in the organic top 10. This
>   column exists nowhere else.
>
> Export to CSV (one file per section) or copy tab-separated straight into Google
> Sheets / Excel. Keep a local history of your last 20 captures.
>
> **Privacy:** 100% local. Zero network requests. Zero analytics. The only
> permission is `storage`, used to remember your settings and history on your own
> machine.

**Category:** Productivity / Developer Tools
**Permissions justification:** `storage` — persist user settings and local
capture history. No host permissions beyond the two declared Google search
content-script matches; no network access.

---

## Project layout

```
serp-snapshot/
├── manifest.json
├── content/
│   ├── serp-adapter.js   # organic + PAA + related + AIO extraction (3-tier fallbacks)
│   ├── paa-expander.js   # click-and-wait expansion of the first 4 PAA
│   ├── badge.js          # Shadow-DOM on-page indicator
│   └── main.js           # orchestration + messaging + soft-nav observer
├── popup/                # popup.html, popup.css, popup.js
├── shared/               # csv.js, storage.js, urlunwrap.js
├── icons/                # 16/32/48/128 + make-icons.py generator
├── DECISIONS.md          # every design decision + defaults
└── README.md
```

See `DECISIONS.md` for the rationale behind every default.

---

Built by **[BuildWithSiddesh](https://www.buildwithsiddesh.com/)** — practical
tools for people who do the SEO work.
