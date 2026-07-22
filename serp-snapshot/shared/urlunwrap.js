/**
 * urlunwrap.js — Unwind Google's redirect-wrapped hrefs to the real destination.
 *
 * Google wraps many outbound links so it can log the click before bouncing the
 * user to the destination. The wrappers we handle:
 *
 *   /url?q=<encoded-real-url>&sa=...          (classic organic wrapper)
 *   /url?url=<encoded-real-url>&...           (alternate param name)
 *   https://www.google.com/url?q=<encoded>... (absolute form)
 *   /interstitial?url=<encoded-real-url>      (occasionally used for AIO/AMP)
 *
 * Some hrefs are already clean (Google increasingly links directly). Some are
 * relative anchors (#fragment) or Google-internal (/search?...) — those we
 * return as-is or resolve against location so the caller can decide.
 *
 * Pure module: no DOM reads, no side effects. Attaches to window.SERPSnapshot.
 */
(function (root) {
  'use strict';

  var NS = (root.SERPSnapshot = root.SERPSnapshot || {});

  // Param names Google has used to carry the real destination, in priority order.
  var REDIRECT_PARAMS = ['q', 'url', 'imgurl', 'continue'];

  /**
   * Return true if the string looks like an http(s) absolute URL.
   */
  function isHttpUrl(value) {
    return /^https?:\/\//i.test(value);
  }

  /**
   * Given a URL object, decide whether it is one of Google's redirect wrappers.
   * We treat any URL whose pathname is exactly /url or /interstitial (on a
   * google host, or relative) as a wrapper candidate.
   */
  function isRedirectWrapper(urlObj) {
    var path = urlObj.pathname || '';
    if (path === '/url' || path === '/interstitial') return true;
    // Some locales append a trailing slash.
    if (path === '/url/' || path === '/interstitial/') return true;
    return false;
  }

  /**
   * Unwrap a single href string to its real destination.
   *
   * @param {string} href        the raw href (may be relative or absolute)
   * @param {string} [baseHref]  base to resolve relative hrefs against;
   *                             defaults to the current document location.
   * @returns {string} the best-effort real destination URL. Never throws;
   *                   on any failure returns the original href untouched.
   */
  function unwrap(href, baseHref) {
    if (!href || typeof href !== 'string') return href || '';
    var trimmed = href.trim();

    // Pure fragment or javascript: — nothing to unwrap.
    if (trimmed === '' || trimmed[0] === '#' || /^javascript:/i.test(trimmed)) {
      return trimmed;
    }

    var base = baseHref || (root.location && root.location.href) || 'https://www.google.com/';

    var urlObj;
    try {
      urlObj = new URL(trimmed, base);
    } catch (e) {
      // Not a parseable URL — hand it back unchanged.
      return trimmed;
    }

    // If it's not a Google redirect wrapper, it's already the destination
    // (or a Google-internal link the caller can filter). Return absolute form.
    if (!isRedirectWrapper(urlObj)) {
      return urlObj.href;
    }

    // Pull the real destination out of the query string.
    for (var i = 0; i < REDIRECT_PARAMS.length; i++) {
      var candidate = urlObj.searchParams.get(REDIRECT_PARAMS[i]);
      if (candidate) {
        // The param value is percent-encoded; URLSearchParams.get already
        // decodes it once. Guard against double-encoding just in case.
        var decoded = candidate;
        if (!isHttpUrl(decoded)) {
          try {
            decoded = decodeURIComponent(candidate);
          } catch (e2) {
            decoded = candidate;
          }
        }
        if (isHttpUrl(decoded)) {
          // Re-normalize through URL to strip stray whitespace / fragments Google adds.
          try {
            return new URL(decoded).href;
          } catch (e3) {
            return decoded;
          }
        }
      }
    }

    // Wrapper with no recognizable destination param — return the wrapper URL
    // rather than nothing, so the row still carries *some* link.
    return urlObj.href;
  }

  /**
   * Extract just the registrable-ish domain (host minus a leading "www.")
   * from a URL. Used for the organic `domain` column and AIO cross-referencing.
   *
   * @param {string} url  an absolute (already-unwrapped) URL
   * @returns {string} lowercased host without a leading "www.", or "" on failure
   */
  function domainOf(url) {
    if (!url || typeof url !== 'string') return '';
    try {
      var host = new URL(url).hostname.toLowerCase();
      return host.replace(/^www\./, '');
    } catch (e) {
      return '';
    }
  }

  /**
   * Normalize a domain for equality comparison (lowercase, strip leading www.).
   * Accepts either a bare host or a full URL.
   */
  function normalizeDomain(value) {
    if (!value) return '';
    if (isHttpUrl(value)) return domainOf(value);
    return String(value).toLowerCase().replace(/^www\./, '').replace(/\/.*$/, '');
  }

  NS.urlunwrap = {
    unwrap: unwrap,
    domainOf: domainOf,
    normalizeDomain: normalizeDomain,
    isHttpUrl: isHttpUrl
  };
})(typeof window !== 'undefined' ? window : this);
