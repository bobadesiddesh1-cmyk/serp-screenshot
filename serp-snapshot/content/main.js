/**
 * main.js — content-script orchestrator.
 *
 * Responsibilities:
 *   1. Passive capture on load + on SPA soft-navigation (URL-change observer,
 *      debounced) → show the on-page badge with counts. Passive capture does
 *      NOT click PAA rows (non-intrusive).
 *   2. Respond to popup messages:
 *        SERP_SNAPSHOT_CAPTURE   → expand first 4 PAA, full capture, save to
 *                                  history, update badge, return the data.
 *        SERP_SNAPSHOT_GET_LAST  → return the last capture (no re-parse).
 *   3. Keep the most recent capture in memory so the popup can read it cheaply.
 *
 * All entry points are wrapped so a failure never throws into the page.
 *
 * Loads after the shared + adapter + expander + badge scripts (see manifest
 * content_scripts order).
 */
(function (root) {
  'use strict';

  var NS = root.SERPSnapshot || {};
  var adapter = NS.adapter;
  var badge = NS.badge;
  var expander = NS.paaExpander;
  var storage = NS.storage;

  var SOFT_NAV_DEBOUNCE_MS = 600;

  var lastCapture = null;
  var lastUrl = root.location ? root.location.href : '';
  var softNavTimer = null;
  var capturing = false;

  function isSearchPage() {
    try {
      return /\/search/.test(root.location.pathname) && new URL(root.location.href).searchParams.has('q');
    } catch (e) {
      return false;
    }
  }

  /**
   * Passive capture: parse the SERP as-is (no PAA expansion) and update the
   * badge. Cheap; runs on load and after soft-navs.
   */
  function passiveCapture() {
    if (!adapter || !isSearchPage()) return;
    try {
      var data = adapter.capture();
      lastCapture = data;
      if (badge) badge.showCounts(data.counts);
    } catch (e) {
      if (badge) badge.showError('parse error');
    }
  }

  /**
   * Full capture: expand the first 4 PAA rows (badge shows "capturing…"), then
   * parse, save to history, update the badge, and return the data.
   * @returns {Promise<Object>} the capture
   */
  function fullCapture() {
    if (!adapter) return Promise.reject(new Error('adapter unavailable'));
    if (capturing && lastCapture) return Promise.resolve(lastCapture);
    capturing = true;
    if (badge) badge.showBusy();

    var expandPromise =
      expander && typeof expander.expandFirst === 'function'
        ? expander.expandFirst()
        : Promise.resolve(0);

    return expandPromise
      .catch(function () {
        return 0; // expansion failure must not abort capture
      })
      .then(function () {
        var data = adapter.capture();
        lastCapture = data;
        if (badge) badge.showCounts(data.counts);
        // Persist a history entry (best-effort; never blocks the return).
        try {
          if (storage && data.meta) {
            storage.addHistory({
              query: data.meta.query || '(no query)',
              date: data.meta.capturedAt,
              resultCount: data.counts.organic,
              aioPresent: !!data.counts.aioPresent
            });
          }
        } catch (e) {
          /* ignore history failure */
        }
        capturing = false;
        return data;
      })
      .catch(function (err) {
        capturing = false;
        if (badge) badge.showError('capture failed');
        throw err;
      });
  }

  // ---- Messaging ----------------------------------------------------------

  function handleMessage(msg, sender, sendResponse) {
    if (!msg || !msg.type) return false;

    if (msg.type === 'SERP_SNAPSHOT_CAPTURE') {
      fullCapture()
        .then(function (data) {
          safeRespond(sendResponse, { ok: true, data: data });
        })
        .catch(function (err) {
          safeRespond(sendResponse, { ok: false, error: String(err && err.message ? err.message : err) });
        });
      return true; // async response
    }

    if (msg.type === 'SERP_SNAPSHOT_GET_LAST') {
      // If we have nothing yet, do a quick passive parse so the popup isn't empty.
      if (!lastCapture) {
        try {
          passiveCapture();
        } catch (e) {
          /* ignore */
        }
      }
      safeRespond(sendResponse, { ok: true, data: lastCapture });
      return false;
    }

    if (msg.type === 'SERP_SNAPSHOT_PING') {
      safeRespond(sendResponse, { ok: true, onSearchPage: isSearchPage() });
      return false;
    }

    return false;
  }

  function safeRespond(sendResponse, payload) {
    try {
      sendResponse(payload);
    } catch (e) {
      /* the popup may have closed; ignore */
    }
  }

  try {
    if (root.chrome && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener(handleMessage);
    }
  } catch (e) {
    /* messaging unavailable — badge-only mode still works */
  }

  // ---- Badge click: re-broadcast last capture so an open popup refreshes ---

  try {
    if (badge && typeof badge.onClick === 'function') {
      badge.onClick(function () {
        try {
          if (root.chrome && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ type: 'SERP_SNAPSHOT_BADGE_CLICK', data: lastCapture }, function () {
              void (chrome.runtime && chrome.runtime.lastError);
            });
          }
        } catch (e) {
          /* ignore */
        }
      });
    }
  } catch (e) {
    /* ignore */
  }

  // ---- Soft-navigation observer -------------------------------------------

  function onPossibleNav() {
    var href = root.location ? root.location.href : '';
    if (href === lastUrl) return;
    lastUrl = href;
    if (softNavTimer) root.clearTimeout(softNavTimer);
    softNavTimer = root.setTimeout(function () {
      passiveCapture();
    }, SOFT_NAV_DEBOUNCE_MS);
  }

  try {
    // A MutationObserver on the results area catches Google's SPA re-renders.
    var target = document.getElementById('search') || document.body;
    if (target && root.MutationObserver) {
      var mo = new MutationObserver(function () {
        onPossibleNav();
      });
      mo.observe(target, { childList: true, subtree: true });
    }
    // Also cover history API navigations that don't mutate immediately.
    root.addEventListener('popstate', onPossibleNav);
    root.addEventListener('hashchange', onPossibleNav);
  } catch (e) {
    /* observer optional */
  }

  // ---- Initial passive capture --------------------------------------------

  function init() {
    try {
      passiveCapture();
    } catch (e) {
      /* ignore */
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // document_idle already; parse on next tick so late-rendered blocks land.
    root.setTimeout(init, 300);
  }
})(typeof window !== 'undefined' ? window : this);
