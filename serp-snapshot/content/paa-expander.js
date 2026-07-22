/**
 * paa-expander.js — click-and-wait expansion of the first N People-Also-Ask
 * questions.
 *
 * WHY: A collapsed PAA row often does not have its answer snippet in the DOM.
 * Google lazy-loads the answer (and sometimes extra nested questions) only when
 * the row is expanded. To export answer snippets we programmatically expand the
 * first few rows, waiting briefly after each click for the answer to render.
 *
 * We expand at most PAA_EXPAND_COUNT rows (default 4, per spec). Each expansion
 * is followed by a PAA_EXPAND_WAIT_MS pause. Everything is wrapped so a failure
 * to expand never blocks the capture — we just extract whatever is present.
 *
 * Attaches to window.SERPSnapshot.paaExpander.
 */
(function (root) {
  'use strict';

  var NS = (root.SERPSnapshot = root.SERPSnapshot || {});
  var U = NS.adapter && NS.adapter._util;

  var PAA_EXPAND_COUNT = 4;
  var PAA_EXPAND_WAIT_MS = 350;

  function sleep(ms) {
    return new Promise(function (resolve) {
      root.setTimeout(resolve, ms);
    });
  }

  /**
   * Find the clickable toggle controls for PAA rows, in document order.
   * Mirrors serp-adapter's PAA location logic but returns the actual button
   * element we should click (the [aria-expanded] control).
   */
  function findToggles() {
    if (!U) return [];
    // Prefer known PAA row wrappers, then any question-shaped aria-expanded ctrl.
    var wrappers = U.qsa(
      '.related-question-pair, [jsname="yEVEwb"], [data-initq], div[jsname="N760b"]'
    ).filter(function (r) {
      return U.isVisible(r);
    });

    var toggles = [];
    var seen = [];

    function pushToggle(el) {
      if (!el) return;
      var btn = el.matches && el.matches('[aria-expanded]') ? el : el.querySelector('[aria-expanded]');
      if (!btn) {
        // Some rows use role=button without aria-expanded.
        btn = el.querySelector('[role="button"]') || el;
      }
      if (btn && seen.indexOf(btn) === -1 && U.isVisible(btn)) {
        seen.push(btn);
        toggles.push(btn);
      }
    }

    if (wrappers.length) {
      wrappers.forEach(pushToggle);
    } else {
      // Fallback: question-shaped expandable controls anywhere on the page.
      U.qsa('[aria-expanded]')
        .filter(function (el) {
          var t = U.text(el);
          return t && /\?\s*$/.test(t) && t.length <= 200 && U.isVisible(el);
        })
        .forEach(pushToggle);
    }
    return toggles;
  }

  function isExpanded(btn) {
    if (!btn) return false;
    var v = btn.getAttribute && btn.getAttribute('aria-expanded');
    return v === 'true';
  }

  /**
   * Expand up to `count` collapsed PAA rows, waiting after each click.
   * Resolves when done (or immediately if there's nothing to expand).
   *
   * @param {number} [count]  how many rows to expand (default PAA_EXPAND_COUNT)
   * @returns {Promise<number>} number of rows we actually clicked to expand
   */
  function expandFirst(count) {
    var target = typeof count === 'number' ? count : PAA_EXPAND_COUNT;
    return new Promise(function (resolve) {
      var toggles;
      try {
        toggles = findToggles().slice(0, target);
      } catch (e) {
        return resolve(0);
      }
      if (!toggles.length) return resolve(0);

      var clicked = 0;
      var idx = 0;

      function step() {
        if (idx >= toggles.length) return resolve(clicked);
        var btn = toggles[idx++];
        try {
          if (!isExpanded(btn)) {
            btn.click();
            clicked += 1;
            // Wait for the answer to render, then continue.
            sleep(PAA_EXPAND_WAIT_MS).then(step);
            return;
          }
        } catch (e) {
          /* clicking failed — skip this row */
        }
        // Already expanded or click failed: move on without a full wait.
        step();
      }

      step();
    });
  }

  NS.paaExpander = {
    PAA_EXPAND_COUNT: PAA_EXPAND_COUNT,
    PAA_EXPAND_WAIT_MS: PAA_EXPAND_WAIT_MS,
    findToggles: findToggles,
    expandFirst: expandFirst
  };
})(typeof window !== 'undefined' ? window : this);
