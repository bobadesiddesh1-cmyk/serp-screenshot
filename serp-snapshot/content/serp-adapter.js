/**
 * serp-adapter.js — the parsing brain of SERP Snapshot.
 *
 * WHY AN ADAPTER: Google's SERP markup is obfuscated and changes constantly.
 * Every data type is extracted through THREE fallback strategies, tried in
 * order, so a single selector break degrades one section to empty rather than
 * blocking the whole capture:
 *
 *   (a) KNOWN     — current, specific container/selector patterns.
 *   (b) HEURISTIC — structural pattern matching that survives class renames.
 *   (c) MINIMAL   — last-ditch "any external link with a heading-styled child".
 *
 * Every extraction is wrapped in try/catch. A failed data-type extraction
 * returns its empty shape; it never throws upward.
 *
 * SELECTOR REPAIR: search this file for "STRATEGY A" comments — those hold the
 * brittle, Google-specific selectors most likely to need patching. The README
 * "Selector repair guide" walks through the process.
 *
 * Attaches to window.SERPSnapshot.adapter.
 */
(function (root) {
  'use strict';

  var NS = (root.SERPSnapshot = root.SERPSnapshot || {});
  var UU = NS.urlunwrap;

  // -------------------------------------------------------------------------
  // Small DOM helpers
  // -------------------------------------------------------------------------

  function qsa(sel, ctx) {
    try {
      return Array.prototype.slice.call((ctx || document).querySelectorAll(sel));
    } catch (e) {
      return [];
    }
  }

  function text(el) {
    if (!el) return '';
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Is the element rendered (has layout, not display:none/visibility:hidden)?
   * Used to skip offscreen/hidden template nodes Google keeps in the DOM.
   */
  function isVisible(el) {
    if (!el || !el.getClientRects) return false;
    try {
      if (el.getClientRects().length === 0) return false;
      var cs = root.getComputedStyle(el);
      if (!cs) return true;
      return cs.visibility !== 'hidden' && cs.display !== 'none';
    } catch (e) {
      return true;
    }
  }

  /**
   * The Google search-results root, where organic results live. We prefer
   * #rso (results section) then #search then #center_col, then <body>.
   */
  function searchRoot() {
    return (
      document.getElementById('rso') ||
      document.getElementById('search') ||
      document.getElementById('center_col') ||
      document.body
    );
  }

  /**
   * Ad detection. Ads are EXCLUDED entirely from the export. Google marks ads
   * several ways; we check ancestry and label text.
   *
   * STRATEGY A markers (patch here when ad markup changes):
   *   #tads, #tadsb, #bottomads         — top/bottom ad blocks
   *   [data-text-ad], [data-pcu]        — text-ad data attrs
   *   .uEierd, .commercial-unit-desktop-top
   */
  var AD_ANCESTOR_SEL =
    '#tads, #tadsb, #bottomads, [data-text-ad], [data-pcu], .commercial-unit-desktop-top, .commercial-unit-desktop-rhs';

  function isAd(el) {
    if (!el) return false;
    try {
      if (el.closest && el.closest(AD_ANCESTOR_SEL)) return true;
      // Label heuristic: a nearby "Sponsored" / "Ad ·" badge.
      var host = el.closest ? el.closest('div') : null;
      var scope = host || el;
      var labelEls = qsa('span, div', scope).slice(0, 12);
      for (var i = 0; i < labelEls.length; i++) {
        var t = text(labelEls[i]);
        if (t === 'Sponsored' || t === 'Ad' || t === 'Ads') return true;
      }
    } catch (e) {
      /* fall through */
    }
    return false;
  }

  /**
   * Given an anchor, return its unwrapped absolute destination, or '' if it is
   * not a usable external link (google-internal, fragment, empty).
   */
  function anchorDest(a) {
    if (!a) return '';
    var raw = a.getAttribute('href');
    if (!raw) return '';
    var dest = UU.unwrap(raw);
    if (!UU.isHttpUrl(dest)) return '';
    return dest;
  }

  /**
   * Is this destination google-internal (search, maps, images, accounts…)?
   * Such links are not organic results.
   */
  function isGoogleInternal(url) {
    var d = UU.domainOf(url);
    if (!d) return true;
    // google.<tld>, gstatic, googleusercontent, youtube is a real result though.
    if (/^google\./.test(d) || d === 'google.com') return true;
    if (/(^|\.)gstatic\.com$/.test(d)) return true;
    if (/(^|\.)googleusercontent\.com$/.test(d)) return true;
    if (/^webcache\.googleusercontent/.test(d)) return true;
    return false;
  }

  var DISPLAY_URL_SEL = 'cite, cite[role="text"], .qLRx3b, .tjvcx, .iUh30';

  function findDisplayUrl(scope) {
    var cite = scope.querySelector ? scope.querySelector(DISPLAY_URL_SEL) : null;
    return cite ? text(cite) : '';
  }

  /**
   * Snippet text near an organic result.
   * STRATEGY A snippet classes (patch here): .VwiC3b is the long-standing
   * snippet class; data-sncf marks snippet fields; the line-clamp style is a
   * structural fallback.
   */
  var SNIPPET_SEL =
    '.VwiC3b, [data-sncf], .lEBKkf, div[style*="line-clamp"], .yXK7lf, .lyLwlc';

  function findSnippet(scope) {
    var els = qsa(SNIPPET_SEL, scope);
    for (var i = 0; i < els.length; i++) {
      var t = text(els[i]);
      // Skip trivial fragments (breadcrumb dates etc.) — require some length.
      if (t && t.length >= 20) return t;
    }
    // Fallback: any reasonably long text node under the result minus the title.
    return '';
  }

  // -------------------------------------------------------------------------
  // ORGANIC RESULTS
  // -------------------------------------------------------------------------

  /**
   * Build an organic-result record from a container that we've decided is a
   * genuine organic result (title anchor with an <h3>).
   */
  function buildOrganicRecord(container, titleAnchor, h3) {
    var url = anchorDest(titleAnchor);
    return {
      title: text(h3),
      url: url,
      displayUrl: findDisplayUrl(container),
      snippet: findSnippet(container),
      domain: UU.domainOf(url),
      _container: container // internal, stripped before export
    };
  }

  /**
   * Collect sitelink sub-rows within an organic result container. Sitelinks are
   * the extra indented links Google shows under a strong result.
   *
   * STRATEGY A: sitelink tables/blocks use .fl / .sld / [data-sokoban-container]
   * or a nested list of anchors-with-h3 that are NOT the main title anchor.
   */
  function collectSitelinks(container, mainAnchor) {
    var out = [];
    try {
      // Nested anchors carrying their own heading (h3) other than the main one.
      var nested = qsa('a h3', container)
        .map(function (h) {
          return { h3: h, a: h.closest('a') };
        })
        .filter(function (p) {
          return p.a && p.a !== mainAnchor;
        });
      var seen = {};
      for (var i = 0; i < nested.length; i++) {
        var a = nested[i].a;
        var dest = anchorDest(a);
        if (!dest || isGoogleInternal(dest)) continue;
        var title = text(nested[i].h3);
        var key = title + '|' + dest;
        if (!title || seen[key]) continue;
        seen[key] = true;
        out.push({ sitelinkTitle: title, sitelinkUrl: dest });
      }
      // Classic sitelink anchors (no h3) inside a sitelink table.
      if (!out.length) {
        var slAnchors = qsa(
          '[data-sokoban-container] a, table.jmjoTe a, .fl.iUh30 a, .usJj9c a',
          container
        );
        for (var j = 0; j < slAnchors.length; j++) {
          var sa = slAnchors[j];
          var sd = anchorDest(sa);
          var st = text(sa);
          if (sd && st && !isGoogleInternal(sd)) {
            out.push({ sitelinkTitle: st, sitelinkUrl: sd });
          }
        }
      }
    } catch (e) {
      /* sitelinks are best-effort */
    }
    return out;
  }

  /**
   * Detect a rich-result / video carousel item. These are EXCLUDED from organic
   * numbering and captured separately with a type label.
   *
   * STRATEGY A markers: video results carry a watch/duration badge; carousels
   * live in [jsname] scroll containers; "Videos" / "Top stories" headed blocks.
   */
  function classifyRich(container) {
    try {
      var t = (container.textContent || '').toLowerCase();
      var host = container.closest
        ? container.closest('g-scrolling-carousel, [aria-label], [role="list"]')
        : null;
      // Video: presence of a video thumbnail / duration marker.
      if (container.querySelector('video, [aria-label*="minute"], .k8XOCe span[aria-hidden]')) {
        if (/youtube\.com|youtu\.be|\bvideo\b/.test(t)) return 'video';
      }
      if (host) {
        var label = (host.getAttribute && host.getAttribute('aria-label')) || '';
        label = label.toLowerCase();
        if (/video/.test(label)) return 'video';
        if (/top stories|news/.test(label)) return 'top-story';
        if (/image/.test(label)) return 'image';
        if (label) return 'carousel';
      }
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  /**
   * STRATEGY A — known containers. Modern organic results are <div class="g">
   * (still used) or blocks under #rso carrying a title anchor + <h3>. We also
   * accept the newer .MjjYud / .tF2Cxc result wrappers.
   */
  function organicStrategyKnown(rootEl) {
    var containers = qsa('div.g, div.tF2Cxc, div.MjjYud, div.Ww4FFb', rootEl);
    return containers;
  }

  /**
   * STRATEGY B — heuristic. Any block under the results root that (1) contains
   * exactly-ish one <h3> wrapped in an <a>, and (2) whose anchor points
   * off-Google. Survives class renames because it keys on structure.
   */
  function organicStrategyHeuristic(rootEl) {
    var h3s = qsa('h3', rootEl);
    var containers = [];
    var seen = [];
    for (var i = 0; i < h3s.length; i++) {
      var h3 = h3s[i];
      var a = h3.closest('a');
      if (!a) continue;
      // Walk up to a reasonable "result card" ancestor: nearest div with a
      // data-hveid (Google stamps these on result blocks) or a few levels up.
      var card =
        h3.closest('[data-hveid]') ||
        h3.closest('div.g, div.tF2Cxc, div.MjjYud') ||
        (a.parentElement && a.parentElement.closest ? a.parentElement.closest('div') : null) ||
        a.parentElement;
      if (!card) continue;
      if (seen.indexOf(card) !== -1) continue;
      seen.push(card);
      containers.push(card);
    }
    return containers;
  }

  /**
   * STRATEGY C — minimal viable. Any external link that has a heading-styled
   * child (h3, or a role=heading, or a large-font span). Lowest fidelity but
   * something rather than nothing.
   */
  function organicStrategyMinimal(rootEl) {
    var anchors = qsa('a[href]', rootEl);
    var containers = [];
    var seen = [];
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      var heading = a.querySelector('h3, [role="heading"]');
      if (!heading) continue;
      var dest = anchorDest(a);
      if (!dest || isGoogleInternal(dest)) continue;
      var card = a.closest('div') || a.parentElement;
      if (!card || seen.indexOf(card) !== -1) continue;
      seen.push(card);
      containers.push(card);
    }
    return containers;
  }

  /**
   * Extract organic results using the three strategies. Returns:
   *   { organic: [...], richResults: [...], strategy: 'known'|'heuristic'|'minimal' }
   *
   * `position` is organic-only rank (ads and carousels excluded).
   */
  function extractOrganic(opts) {
    opts = opts || {};
    var rootEl = searchRoot();
    var result = { organic: [], richResults: [], strategy: 'none' };

    var strategies = [
      { name: 'known', fn: organicStrategyKnown },
      { name: 'heuristic', fn: organicStrategyHeuristic },
      { name: 'minimal', fn: organicStrategyMinimal }
    ];

    for (var s = 0; s < strategies.length; s++) {
      var containers;
      try {
        containers = strategies[s].fn(rootEl) || [];
      } catch (e) {
        containers = [];
      }
      if (!containers.length) continue;

      var parsed = parseOrganicContainers(containers, opts);
      if (parsed.organic.length) {
        parsed.strategy = strategies[s].name;
        return parsed;
      }
      // If a strategy found containers but zero valid organic results, keep
      // trying the next (more permissive) strategy.
    }
    return result;
  }

  /**
   * Turn a list of candidate containers into ranked organic records, filtering
   * ads/dupes/rich results and numbering organic-only.
   */
  function parseOrganicContainers(containers, opts) {
    var out = { organic: [], richResults: [], strategy: 'none' };
    var seenUrls = {};
    var position = 0;

    for (var i = 0; i < containers.length; i++) {
      var container = containers[i];
      try {
        if (!isVisible(container)) continue;
        if (isAd(container)) continue; // ads excluded entirely

        // Find the main title anchor: first <a> that directly wraps an <h3>.
        var h3 = container.querySelector('h3');
        if (!h3) continue;
        var titleAnchor = h3.closest('a');
        if (!titleAnchor) {
          // Sometimes the h3 sits beside the anchor; grab the nearest anchor.
          titleAnchor = container.querySelector('a[href]');
        }
        if (!titleAnchor) continue;

        var dest = anchorDest(titleAnchor);
        if (!dest || isGoogleInternal(dest)) continue;

        // Rich/video carousel item → separate array, excluded from numbering.
        var richType = classifyRich(container);
        if (richType) {
          out.richResults.push({
            type: richType,
            title: text(h3),
            url: dest,
            domain: UU.domainOf(dest)
          });
          continue;
        }

        // De-dupe: Google frequently double-lists the same block under nested
        // wrappers (.g inside .MjjYud). Key on destination URL.
        if (seenUrls[dest]) continue;
        seenUrls[dest] = true;

        position += 1;
        var rec = buildOrganicRecord(container, titleAnchor, h3);
        rec.position = position;
        rec.sitelinks = collectSitelinks(container, titleAnchor);
        out.organic.push(rec);
      } catch (e) {
        // One bad container must not abort the rest.
        continue;
      }
    }
    return out;
  }

  // Expose organic pieces now; PAA / related / AIO are appended below in
  // subsequent build steps but live on the same namespace object.
  NS.adapter = NS.adapter || {};
  NS.adapter.extractOrganic = extractOrganic;

  // Share helpers with the later sections of this file / other content scripts.
  NS.adapter._util = {
    qsa: qsa,
    text: text,
    isVisible: isVisible,
    searchRoot: searchRoot,
    anchorDest: anchorDest,
    isGoogleInternal: isGoogleInternal,
    isAd: isAd
  };
})(typeof window !== 'undefined' ? window : this);

/**
 * serp-adapter.js — PEOPLE ALSO ASK extraction.
 *
 * PAA is a list of expandable question rows. We extract every question visible
 * in the DOM. If a row has been expanded (by the user or by paa-expander.js),
 * we also pull the answer snippet and the answer's source URL. Google sometimes
 * injects additional nested questions on expand; those are flagged nested:true.
 *
 * Three fallback strategies for locating the PAA block, same philosophy as
 * organic.
 */
(function (root) {
  'use strict';

  var NS = (root.SERPSnapshot = root.SERPSnapshot || {});
  var UU = NS.urlunwrap;
  var U = NS.adapter._util;

  /**
   * STRATEGY A — known PAA markers. Google's PAA rows have carried, over time:
   *   .related-question-pair          — the classic question-pair wrapper
   *   [jsname="N760b"] / [jsname="yEVEwb"] — internal jsnames on rows
   *   [data-initq]                    — the initial question data attr
   * The block container is often .cUnQKe / [role="heading"] labelled group.
   */
  function paaRowsKnown() {
    var rows = U.qsa(
      '.related-question-pair, [jsname="yEVEwb"], [data-initq], div[jsname="N760b"]'
    );
    return rows.filter(function (r) {
      return U.isVisible(r);
    });
  }

  /**
   * STRATEGY B — heuristic. Find the "People also ask" label, then treat the
   * expandable rows under its container as PAA rows. Rows are elements with
   * aria-expanded or role=button carrying question-like text ending in "?".
   */
  function paaRowsHeuristic() {
    var label = findLabel(['people also ask', 'people also asked']);
    if (!label) return [];
    var container = label.closest('[jscontroller], div');
    // Climb to a container that holds several expandable rows.
    for (var hops = 0; hops < 4 && container; hops++) {
      var candidates = U.qsa('[aria-expanded], [role="button"]', container).filter(
        function (el) {
          return /\?\s*$/.test(U.text(el)) && U.isVisible(el);
        }
      );
      if (candidates.length >= 2) {
        // Return the row wrapper (parent that also holds the answer panel).
        return candidates.map(function (btn) {
          return btn.closest('[data-hveid], [jsname], div') || btn;
        });
      }
      container = container.parentElement;
    }
    return [];
  }

  /**
   * STRATEGY C — minimal. Any expandable control on the page whose visible text
   * is a question (ends with "?"). Catches PAA even if labelling changed.
   */
  function paaRowsMinimal() {
    var controls = U.qsa('[aria-expanded]').filter(function (el) {
      var t = U.text(el);
      return t && /\?\s*$/.test(t) && t.length <= 200 && U.isVisible(el);
    });
    var seen = [];
    var rows = [];
    for (var i = 0; i < controls.length; i++) {
      var wrap = controls[i].closest('[data-hveid], div') || controls[i];
      if (seen.indexOf(wrap) !== -1) continue;
      seen.push(wrap);
      rows.push(wrap);
    }
    return rows;
  }

  /**
   * Locate an element whose trimmed text exactly matches one of the given
   * lower-cased label strings. Used to anchor heuristic strategies on
   * human-visible labels that change far less often than class names.
   */
  function findLabel(labels) {
    var all = U.qsa('div, span, h2, h3, g-section-with-header, [role="heading"]');
    for (var i = 0; i < all.length; i++) {
      var t = U.text(all[i]).toLowerCase();
      for (var j = 0; j < labels.length; j++) {
        if (t === labels[j]) return all[i];
      }
    }
    return null;
  }

  /**
   * Pull the question text out of a PAA row. The question is the row's heading /
   * button text, ending in "?". We take the shortest question-like text to avoid
   * accidentally grabbing the answer.
   */
  function questionOf(row) {
    var btn =
      row.querySelector('[aria-expanded]') ||
      row.querySelector('[role="button"]') ||
      row.querySelector('[role="heading"]') ||
      row;
    var t = U.text(btn);
    // If the button text swallowed the answer too, keep only up to the first "?".
    var m = t.match(/^(.*?\?)/);
    return m ? m[1].trim() : t;
  }

  /**
   * Given an expanded PAA row, extract the answer snippet + source URL.
   * Returns { answerSnippet, answerSourceUrl }. Empty strings if not expanded /
   * not found.
   *
   * The answer panel is the row content MINUS the question header. We look for a
   * dedicated answer container first, then fall back to "row text after the
   * question".
   */
  function answerOf(row, questionText) {
    var out = { answerSnippet: '', answerSourceUrl: '' };
    try {
      // STRATEGY A: known answer containers.
      var panel =
        row.querySelector('[data-attrid] .VwiC3b') ||
        row.querySelector('.VwiC3b') ||
        row.querySelector('[data-md]') ||
        row.querySelector('[jsname="dwOfLc"]') ||
        row.querySelector('[role="region"]');

      var snippet = panel ? U.text(panel) : '';

      // HEURISTIC: full row text minus the leading question.
      if (!snippet) {
        var full = U.text(row);
        if (questionText && full.indexOf(questionText) === 0) {
          snippet = full.slice(questionText.length).trim();
        } else {
          snippet = full;
        }
      }

      // A collapsed row has essentially no answer body; treat very short
      // leftovers (just the question echoed) as "not expanded".
      if (snippet && snippet.replace(/\s+/g, ' ').length >= 15) {
        out.answerSnippet = snippet;
      }

      // Source URL: first external link in the answer region. Google places the
      // source link inside the answer panel OR as a sibling of it, so search the
      // whole row (the question button carries no external href).
      var scope = row;
      var links = U.qsa('a[href]', scope);
      for (var i = 0; i < links.length; i++) {
        var dest = U.anchorDest(links[i]);
        if (dest && !U.isGoogleInternal(dest)) {
          out.answerSourceUrl = dest;
          break;
        }
      }
    } catch (e) {
      /* answer is best-effort */
    }
    return out;
  }

  /**
   * Extract all PAA questions. Returns { paa: [...], strategy }.
   * Each item: { position, question, answerSnippet, answerSourceUrl, nested }.
   *
   * `nested` is true for questions that appear to have been injected as
   * children of another question's expanded panel.
   */
  function extractPAA() {
    var strategies = [
      { name: 'known', fn: paaRowsKnown },
      { name: 'heuristic', fn: paaRowsHeuristic },
      { name: 'minimal', fn: paaRowsMinimal }
    ];

    var rows = [];
    var strategyName = 'none';
    for (var s = 0; s < strategies.length; s++) {
      try {
        rows = strategies[s].fn() || [];
      } catch (e) {
        rows = [];
      }
      if (rows.length) {
        strategyName = strategies[s].name;
        break;
      }
    }

    var out = { paa: [], strategy: strategyName };
    var seen = {};
    var position = 0;

    for (var i = 0; i < rows.length; i++) {
      try {
        var row = rows[i];
        var q = questionOf(row);
        if (!q || q.length < 3) continue;
        var key = q.toLowerCase();
        if (seen[key]) continue;
        seen[key] = true;

        // Nested detection: is this row inside another PAA row's answer panel?
        var nested = false;
        try {
          var parentRow = row.parentElement ? row.parentElement.closest('.related-question-pair, [jsname="yEVEwb"]') : null;
          nested = !!(parentRow && parentRow !== row);
        } catch (e2) {
          nested = false;
        }

        position += 1;
        var ans = answerOf(row, q);
        out.paa.push({
          position: position,
          question: q,
          answerSnippet: ans.answerSnippet,
          answerSourceUrl: ans.answerSourceUrl,
          nested: nested
        });
      } catch (e3) {
        continue;
      }
    }
    return out;
  }

  NS.adapter.extractPAA = extractPAA;
  NS.adapter._paa = { findLabel: findLabel, questionOf: questionOf };
})(typeof window !== 'undefined' ? window : this);

/**
 * serp-adapter.js — RELATED SEARCHES + AI OVERVIEW extraction, plus the
 * cross-reference computation and the top-level capture() orchestrator.
 */
(function (root) {
  'use strict';

  var NS = (root.SERPSnapshot = root.SERPSnapshot || {});
  var UU = NS.urlunwrap;
  var U = NS.adapter._util;
  var findLabel = NS.adapter._paa.findLabel;

  // -------------------------------------------------------------------------
  // RELATED SEARCHES
  // -------------------------------------------------------------------------

  /**
   * STRATEGY A — known related-search containers.
   *   #bres         — the bottom "related searches" section
   *   .k8XOCe       — chip links
   *   .EItsjc, .s75CSd, .y6Uyqe — related-search item wrappers over time
   */
  function relatedKnown() {
    var scope = document.getElementById('bres') || document.getElementById('botstuff');
    var links = [];
    if (scope) {
      links = U.qsa('a[href], .k8XOCe, .EItsjc a, .y6Uyqe a', scope);
    }
    if (!links.length) {
      links = U.qsa('#bres a[href], .k8XOCe');
    }
    return links;
  }

  /**
   * STRATEGY B — heuristic. Find the "Related searches" / "People also search
   * for" label, then collect the /search?q= anchors under its container.
   */
  function relatedHeuristic() {
    var label = findLabel([
      'related searches',
      'people also search for',
      'related to this search'
    ]);
    if (!label) return [];
    var container = label.closest('div');
    for (var hops = 0; hops < 5 && container; hops++) {
      var anchors = U.qsa('a[href]', container).filter(isRelatedAnchor);
      if (anchors.length >= 2) return anchors;
      container = container.parentElement;
    }
    return [];
  }

  /**
   * STRATEGY C — minimal. Any /search?q= anchor in the bottom third of the page
   * that carries short chip-like text (a query, not a result title).
   */
  function relatedMinimal() {
    return U.qsa('a[href]').filter(function (a) {
      if (!isRelatedAnchor(a)) return false;
      var t = U.text(a);
      return t && t.length > 0 && t.length <= 80 && !a.querySelector('h3');
    });
  }

  /**
   * Is this anchor a related-search query link? It points to /search?q= on the
   * same Google host and carries query text.
   */
  function isRelatedAnchor(a) {
    try {
      var href = a.getAttribute('href') || '';
      if (!href) return false;
      var url = new URL(href, root.location.href);
      var sameGoogle = url.hostname === root.location.hostname;
      var isSearch = url.pathname === '/search';
      return sameGoogle && isSearch && url.searchParams.has('q');
    } catch (e) {
      return false;
    }
  }

  /**
   * Extract related searches. Returns { related: [{position, text}], strategy }.
   */
  function extractRelated() {
    var strategies = [
      { name: 'known', fn: relatedKnown },
      { name: 'heuristic', fn: relatedHeuristic },
      { name: 'minimal', fn: relatedMinimal }
    ];
    var anchors = [];
    var strategyName = 'none';
    for (var s = 0; s < strategies.length; s++) {
      try {
        anchors = (strategies[s].fn() || []).filter(function (el) {
          return el && el.getAttribute; // keep only elements
        });
      } catch (e) {
        anchors = [];
      }
      // relatedKnown may return chip divs too; normalize to text carriers.
      if (anchors.length) {
        strategyName = strategies[s].name;
        break;
      }
    }

    var out = { related: [], strategy: strategyName };
    var seen = {};
    var position = 0;
    for (var i = 0; i < anchors.length; i++) {
      try {
        var el = anchors[i];
        if (!U.isVisible(el)) continue;
        var t = U.text(el);
        if (!t) continue;
        var key = t.toLowerCase();
        if (seen[key]) continue;
        seen[key] = true;
        position += 1;
        out.related.push({ position: position, text: t });
      } catch (e) {
        continue;
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // AI OVERVIEW
  // -------------------------------------------------------------------------

  /**
   * STRATEGY A — known AIO container markers. The AI Overview block has carried,
   * over its short life, attributes/labels such as:
   *   [data-attrid*="SGE"], [data-al-attr], [aria-label*="AI Overview"]
   *   containers near text "AI Overview".
   * These are volatile — patch here first when AIO extraction breaks.
   */
  function aioContainerKnown() {
    var sel =
      '[data-attrid*="SGE"], [aria-label*="AI Overview"], [aria-label*="AI overview"], div[jsname][data-hveid] [aria-label*="Overview"]';
    var els = U.qsa(sel).filter(U.isVisible);
    return els.length ? els[0] : null;
  }

  /**
   * STRATEGY B — heuristic. Find a block whose visible text contains the label
   * "AI Overview" (or locale-equivalent we recognize) sitting above the first
   * organic result.
   */
  function aioContainerHeuristic() {
    var label = null;
    var candidates = U.qsa('div, span, h1, h2, [role="heading"]');
    for (var i = 0; i < candidates.length; i++) {
      var t = U.text(candidates[i]).toLowerCase();
      if (t === 'ai overview' || t === 'ai overview·' || /^ai overview\b/.test(t)) {
        if (U.isVisible(candidates[i])) {
          label = candidates[i];
          break;
        }
      }
    }
    if (!label) return null;
    // Climb to a container that also holds source chips/links.
    var container = label.closest('[data-hveid], [jscontroller], div') || label.parentElement;
    for (var hops = 0; hops < 5 && container; hops++) {
      if (U.qsa('a[href]', container).length >= 1) return container;
      container = container.parentElement;
    }
    return label.parentElement;
  }

  /**
   * STRATEGY C — structural. A block positioned above the first organic result
   * that carries multiple external source chips (links). Detect by taking the
   * first organic result's top offset and looking for a preceding block with
   * >= 2 external links.
   */
  function aioContainerStructural(firstOrganicContainer) {
    try {
      var root_ = U.searchRoot();
      var blocks = U.qsa('#rso > div, #search > div, [data-hveid]', root_).filter(U.isVisible);
      var firstTop = firstOrganicContainer
        ? firstOrganicContainer.getBoundingClientRect().top
        : Infinity;
      for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i];
        var top = b.getBoundingClientRect().top;
        if (top >= firstTop) continue; // must be ABOVE first organic result
        var extLinks = U.qsa('a[href]', b).filter(function (a) {
          var d = U.anchorDest(a);
          return d && !U.isGoogleInternal(d);
        });
        if (extLinks.length >= 2) return b;
      }
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  /**
   * Detect the AIO expansion state from its container.
   * Returns 'expanded' | 'collapsed' | 'partially-expanded'.
   */
  function aioExpansionState(container) {
    try {
      // A "Show more" / "Show all" control implies content is hidden.
      var controls = U.qsa('[aria-expanded], [role="button"], div[jsname]', container);
      for (var i = 0; i < controls.length; i++) {
        var t = U.text(controls[i]).toLowerCase();
        if (/show more|show all|show everything/.test(t)) {
          var v = controls[i].getAttribute && controls[i].getAttribute('aria-expanded');
          if (v === 'true') return 'expanded';
          // Control present and collapsed but some citations already visible.
          return 'partially-expanded';
        }
      }
      // No show-more control found: treat as fully expanded.
      return 'expanded';
    } catch (e) {
      return 'expanded';
    }
  }

  /**
   * Extract the cited domains from an AIO container. Dedupe by domain, unwrap
   * redirect hrefs, capture a title where the anchor has readable text.
   */
  function aioCitations(container) {
    var out = [];
    var seen = {};
    var anchors = U.qsa('a[href]', container);
    for (var i = 0; i < anchors.length; i++) {
      try {
        var a = anchors[i];
        var dest = U.anchorDest(a);
        if (!dest || U.isGoogleInternal(dest)) continue;
        var domain = UU.domainOf(dest);
        if (!domain) continue;
        if (seen[domain]) continue;
        seen[domain] = true;
        var title = U.text(a);
        // Anchor text is often just the domain/site name; keep it if meaningful.
        out.push({
          domain: domain,
          url: dest,
          title: title && title.length <= 200 ? title : ''
        });
      } catch (e) {
        continue;
      }
    }
    return out;
  }

  /**
   * Extract the AI Overview. Returns one of:
   *   { aioPresent: false }
   *   { aioPresent: true, citedDomains: [...], expansionState, strategy }
   */
  function extractAIO(firstOrganicContainer) {
    var container = null;
    var strategy = 'none';
    try {
      container = aioContainerKnown();
      if (container) strategy = 'known';
      if (!container) {
        container = aioContainerHeuristic();
        if (container) strategy = 'heuristic';
      }
      if (!container) {
        container = aioContainerStructural(firstOrganicContainer);
        if (container) strategy = 'structural';
      }
    } catch (e) {
      container = null;
    }

    if (!container) return { aioPresent: false };

    var citedDomains = [];
    var expansionState = 'expanded';
    try {
      citedDomains = aioCitations(container);
      expansionState = aioExpansionState(container);
    } catch (e) {
      /* keep whatever we have */
    }

    return {
      aioPresent: true,
      citedDomains: citedDomains,
      expansionState: expansionState,
      strategy: strategy
    };
  }

  // -------------------------------------------------------------------------
  // CROSS-REFERENCE  (the differentiator stat)
  // -------------------------------------------------------------------------

  /**
   * For each AIO-cited domain, mark whether it also appears in the organic
   * top-10. Mutates:
   *   - each aio citation gets `ranksInOrganicTop10: boolean`
   *   - each organic result in the top 10 gets `citedByAIOverview: boolean`
   *
   * Domain comparison uses normalizeDomain (lowercase, strip leading www.).
   * Sitelink sub-rows do not count toward the top-10.
   */
  function crossReference(organic, aio) {
    // Build the set of top-10 organic domains.
    var top10 = {};
    for (var i = 0; i < organic.length && i < 10; i++) {
      var d = UU.normalizeDomain(organic[i].domain || organic[i].url);
      if (d) top10[d] = true;
    }

    // Set of cited domains for marking organic rows.
    var citedSet = {};
    if (aio && aio.aioPresent && aio.citedDomains) {
      for (var j = 0; j < aio.citedDomains.length; j++) {
        var cd = UU.normalizeDomain(aio.citedDomains[j].domain || aio.citedDomains[j].url);
        aio.citedDomains[j].ranksInOrganicTop10 = !!(cd && top10[cd]);
        if (cd) citedSet[cd] = true;
      }
    }

    // Mark organic rows (all of them, not just top-10, but the flag reflects
    // "is this domain cited by the AIO").
    for (var k = 0; k < organic.length; k++) {
      var od = UU.normalizeDomain(organic[k].domain || organic[k].url);
      organic[k].citedByAIOverview = !!(od && citedSet[od]);
    }
  }

  // -------------------------------------------------------------------------
  // METADATA
  // -------------------------------------------------------------------------

  /**
   * Read query text + search location from URL params (best-effort).
   */
  function readMetadata() {
    var meta = {
      query: '',
      capturedAt: new Date().toISOString(),
      location: 'not detected',
      host: root.location ? root.location.hostname : '',
      pageUrl: root.location ? root.location.href : ''
    };
    try {
      var params = new URL(root.location.href).searchParams;
      meta.query = params.get('q') || '';
      // Location hints, in priority order.
      var loc = [];
      if (params.get('near')) loc.push('near=' + params.get('near'));
      if (params.get('gl')) loc.push('gl=' + params.get('gl'));
      if (params.get('uule')) loc.push('uule=' + params.get('uule'));
      if (loc.length) meta.location = loc.join(' ');
    } catch (e) {
      /* metadata is best-effort */
    }
    return meta;
  }

  // -------------------------------------------------------------------------
  // TOP-LEVEL CAPTURE
  // -------------------------------------------------------------------------

  /**
   * Capture the entire SERP into one plain-data object. Assumes any desired PAA
   * expansion has ALREADY happened (main.js awaits paa-expander first).
   *
   * The returned object is JSON-serializable (internal `_container` refs are
   * stripped) so it can be sent over chrome.tabs.sendMessage.
   *
   * @param {Object} [settings]  storage settings (affects nothing in parsing,
   *                             kept for forward-compat / future toggles).
   * @returns {Object} full capture
   */
  function capture(settings) {
    var meta = readMetadata();

    var organicResult = { organic: [], richResults: [], strategy: 'none' };
    try {
      organicResult = NS.adapter.extractOrganic({}) || organicResult;
    } catch (e) {
      /* organic degrades to empty */
    }

    var paaResult = { paa: [], strategy: 'none' };
    try {
      paaResult = NS.adapter.extractPAA() || paaResult;
    } catch (e) {
      /* PAA degrades to empty */
    }

    var relatedResult = { related: [], strategy: 'none' };
    try {
      relatedResult = extractRelated() || relatedResult;
    } catch (e) {
      /* related degrades to empty */
    }

    // AIO needs the first organic container for its structural fallback.
    var firstContainer =
      organicResult.organic.length && organicResult.organic[0]._container
        ? organicResult.organic[0]._container
        : null;
    var aioResult = { aioPresent: false };
    try {
      aioResult = extractAIO(firstContainer) || aioResult;
    } catch (e) {
      /* AIO degrades to absent */
    }

    // Cross-reference (cheap; mutates organic + aio in place).
    try {
      crossReference(organicResult.organic, aioResult);
    } catch (e) {
      /* non-fatal */
    }

    // Strip internal DOM refs so the object is serializable.
    var organicClean = organicResult.organic.map(function (r) {
      return {
        position: r.position,
        title: r.title,
        url: r.url,
        displayUrl: r.displayUrl,
        snippet: r.snippet,
        domain: r.domain,
        sitelinks: r.sitelinks || [],
        citedByAIOverview: !!r.citedByAIOverview
      };
    });

    return {
      meta: meta,
      organic: organicClean,
      richResults: organicResult.richResults || [],
      paa: paaResult.paa || [],
      related: relatedResult.related || [],
      aio: aioResult,
      strategies: {
        organic: organicResult.strategy,
        paa: paaResult.strategy,
        related: relatedResult.strategy,
        aio: aioResult.strategy || (aioResult.aioPresent ? 'unknown' : 'none')
      },
      counts: {
        organic: organicClean.length,
        richResults: (organicResult.richResults || []).length,
        paa: (paaResult.paa || []).length,
        related: (relatedResult.related || []).length,
        aioSources: aioResult.aioPresent && aioResult.citedDomains ? aioResult.citedDomains.length : 0,
        aioPresent: !!aioResult.aioPresent
      }
    };
  }

  NS.adapter.extractRelated = extractRelated;
  NS.adapter.extractAIO = extractAIO;
  NS.adapter.crossReference = crossReference;
  NS.adapter.readMetadata = readMetadata;
  NS.adapter.capture = capture;
})(typeof window !== 'undefined' ? window : this);
