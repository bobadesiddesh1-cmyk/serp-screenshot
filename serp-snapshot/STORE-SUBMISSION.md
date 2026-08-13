# Chrome Web Store — Submission Guide (SERP Snapshot)

Everything you need to publish, in the order the dashboard asks for it. Copy-paste
the **verbatim** blocks; pick the marked options for dropdowns/checkboxes.

---

## 0) One-time prerequisites

1. A Google account to publish under.
2. Register as a Chrome Web Store developer (one-time **$5 USD** fee):
   → https://chrome.google.com/webstore/devconsole/ → accept the agreement → pay.
3. Verify a contact email in the dashboard (**Account → Contact email**). Google
   requires a verified email before you can publish.

---

## 1) The upload package

Upload **`serp-snapshot-store.zip`** (provided). It is the store-ready package:
`manifest.json` sits at the **root of the zip** (Chrome requires this — a zip with
a nested folder is rejected). It contains only runtime files (no README /
build scripts).

Dashboard: **Items → + New item → Upload** the zip.

> Bump `"version"` in `manifest.json` for every future update (e.g. `1.0.1`), then
> re-zip and upload a new package under the same item.

---

## 2) Store listing tab

**Item name**
```
SERP Snapshot — One-Click SERP to Spreadsheet
```

**Summary** (max 132 chars)
```
Export Google SERP organic results, People Also Ask, related searches & AI Overview citations to CSV or clipboard. 100% local.
```

**Description** (paste as-is)
```
Stop copy-pasting SERPs by hand. SERP Snapshot captures everything on a Google search results page in one click and exports it spreadsheet-ready.

WHAT IT CAPTURES
• Organic results — a clean rank table with real (redirect-unwound) URLs, domains, snippets, and sitelinks as sub-rows. Ads and carousels are excluded from the ranking, exactly like a rank tracker counts.
• People Also Ask — questions plus answer snippets and source links. The first few are auto-expanded so you actually get the answers.
• Related searches — the full bottom-of-page list.
• AI Overview citations — the domains Google's AI Overview cited, PLUS a one-click stat showing which of them ALSO rank in the organic top 10. This cross-reference column exists nowhere else.

EXPORT THE WAY YOU ALREADY WORK
• CSV — one sheet-friendly file per section (organic, PAA, related, AI Overview), properly escaped so snippets with commas and quotes never break your columns. Opens clean in Excel and Google Sheets.
• Clipboard — tab-separated, so it pastes straight into a spreadsheet with columns aligned.
• "Copy organic only" for when you just want the ranking table fast.
• A local history of your last 20 captures.

BUILT FOR SEO PROS
Rank tracking, competitor research, and client reporting — without the manual copy-paste. An unobtrusive on-page badge confirms each capture at a glance.

PRIVACY BY DESIGN
100% local. Zero network requests. Zero analytics. The only permission is "storage", used to remember your settings and history on your own machine. The extension runs only on Google search pages and nowhere else.

—
Built by BuildWithSiddesh — practical tools for people who do the SEO work.
More at https://www.buildwithsiddesh.com/
```

> Category note: Google's current taxonomy has no "Productivity" option — use
> **Tools** (the closest alternative is Workflow & Planning).

**Category:** `Tools`
**Language:** `English`

**Additional fields**
- Official URL: leave `None` (needs a Search Console-verified domain).
- Homepage URL: `https://www.buildwithsiddesh.com/`
- Support URL: `https://github.com/bobadesiddesh1-cmyk/serp-screenshot/issues`
- Mature content: off.

**Graphic assets** (all provided, exact sizes required by the store):
| Asset | File | Size |
|---|---|---|
| Store icon | `store-icon-128.png` | 128×128 |
| Screenshot 1 | `screenshot-1-hero.png` | 1280×800 |
| Screenshot 2 | `screenshot-2-aio-column.png` | 1280×800 |
| Screenshot 3 | `screenshot-3-badge.png` | 1280×800 |
| Screenshot 4 | `screenshot-4-exports.png` | 1280×800 |
| Screenshot 5 | `screenshot-5-privacy.png` | 1280×800 |
| Small promo tile | `promo-tile-440x280.png` | 440×280 |
| Marquee promo tile | `promo-marquee-1400x560.png` | 1400×560 |

> Five screenshots is the store maximum; upload them in the order above (the
> first is the one users see first). Screenshots and both promo tiles are 24-bit
> RGB with **no alpha**, as the store requires. The store icon keeps
> transparency and uses a 96×96 mark centered in the 128×128 canvas, per
> Google's icon guidance.
>
> Every screenshot and tile carries the **BuildWithSiddesh** byline.

---

## 3) Privacy practices tab (this is where most rejections happen — fill every field)

**Single purpose** (paste)
```
SERP Snapshot has one purpose: to let the user export the data on the Google search results page they are viewing (organic results, People Also Ask, related searches, and AI Overview citations) to a CSV file or the clipboard for use in a spreadsheet.
```

**Permission justifications**

- `storage` (paste)
```
Used only to save the user's own settings (default export format and section toggles) and a local history of their last 20 captures on their own device. This data is never transmitted anywhere.
```

- Host permission — `www.google.com/search*` and `www.google.co.in/search*` (paste)
```
The content script reads the current Google search results page so its contents can be extracted and exported when the user clicks Capture. The extension runs only on Google search result pages and makes no network requests.
```

- **Remote code:** select **"No, I am not using remote code."** (all JS is bundled;
  no `eval`, no externally-loaded scripts.)

**Data usage** — check the boxes truthfully:
- Do you collect or use any of the listed user data? → **None apply.** Leave every
  data-type box unchecked (the extension collects no personally identifiable
  information, health, financial, authentication, personal communications,
  location, web history, or user activity that leaves the device).
- Then check the three **certification** boxes:
  - ☑ I do not sell or transfer user data to third parties, outside of the approved use cases
  - ☑ I do not use or transfer user data for purposes unrelated to my item's single purpose
  - ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL** (required). Host the provided `PRIVACY.md` text at a public
URL and paste it here. Fastest option:
1. Go to https://gist.github.com → new **public** gist → filename `privacy.md` →
   paste the contents of `PRIVACY.md` → **Create public gist**.
2. Use that gist's URL as the privacy policy URL.
(Alternatively enable GitHub Pages on the repo, or host anywhere public.)

---

## 4) Distribution tab

- **Visibility:** `Public` (or `Unlisted` if you want a link-only soft launch).
- **Pricing:** Free.
- **Regions:** All regions (or restrict as you like).

---

## 5) Submit

Click **Submit for review**. Typical review is a few hours to a few days for a
small, single-purpose, `storage`-only extension. You'll get an email on approval
or with any requested change. If Google asks for anything, it's almost always a
permission-justification wording tweak — the text above is written to satisfy it.

---

## 6) Updating (and the version rule)

**Every package you upload must have a HIGHER `version` than the last one you
uploaded** — re-uploading the same version is rejected. This applies even while
the item is still a draft, so bump the version any time you re-upload after a
change.

1. Edit code, bump `manifest.json` `version` (e.g. `1.0.1` → `1.0.2`).
2. Re-create the store zip (manifest at root):
   ```
   cd serp-snapshot && zip -r ../serp-snapshot-store.zip . \
     -x '*.md' -x 'icons/make-icons.py' && cd ..
   ```
3. Confirm the zip carries the version you expect:
   ```
   unzip -p ../serp-snapshot-store.zip manifest.json | grep '"version"'
   ```
4. Dashboard → your item → **Package → Upload new package** → **Submit for review**.

> The version shown in the popup's About card is read from `manifest.json` at
> runtime via `chrome.runtime.getManifest()`, so it updates itself — there is no
> second place to edit.

### Version history
| Version | What changed |
|---|---|
| 1.0.0 | Initial build. |
| 1.0.1 | BuildWithSiddesh branding (popup footer byline, Settings About card, badge tooltip); store description brand line. |
| 1.0.2 | Brand name corrected to the site's own styling ("BuildWithSiddesh", one word) across popup, badge tooltip and docs. |

---

## Pre-flight checklist

- [x] `manifest.json` is Manifest V3, `version` set, `description` ≤ 132 chars.
- [x] Zip has `manifest.json` at the root (not inside a subfolder).
- [x] Icons present at 16/32/48/128; 128 used as the store icon.
- [x] Permissions limited to `storage` + the two Google search host matches.
- [x] No remote code, no network calls (verified: no `fetch`/`XHR`/`sendBeacon`).
- [x] 3 screenshots (1280×800) + promo tile (440×280) ready.
- [x] Privacy policy hosted at a public URL.
- [x] Single-purpose + permission justifications filled.
```
