/**
 * badge.js — lightweight on-page indicator rendered in Shadow DOM.
 *
 * Shows quick capture counts near the top-right of the SERP so the user knows a
 * capture succeeded without opening the popup. Clicking the badge asks the
 * background/popup to open (we can't programmatically open the popup from a
 * content script, so we surface a hint + focus; the click also re-broadcasts the
 * latest capture so an already-open popup refreshes).
 *
 * Everything is inside a closed-ish Shadow root so page CSS can't leak in and
 * our CSS can't leak out. All DOM work is wrapped in try/catch with silent fail
 * — the badge must NEVER break the SERP.
 *
 * Dark-mode aware via prefers-color-scheme inside the shadow stylesheet.
 *
 * Attaches to window.SERPSnapshot.badge.
 */
(function (root) {
  'use strict';

  var NS = (root.SERPSnapshot = root.SERPSnapshot || {});

  var HOST_ID = 'serp-snapshot-badge-host';
  var shadowRoot = null;
  var els = {};

  var STYLE = [
    ':host { all: initial; }',
    '.wrap {',
    '  position: fixed; top: 12px; right: 12px; z-index: 2147483000;',
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;',
    '  pointer-events: none;',
    '}',
    '.badge {',
    '  pointer-events: auto; cursor: pointer; user-select: none;',
    '  display: inline-flex; align-items: center; gap: 8px;',
    '  padding: 8px 12px; border-radius: 10px;',
    '  background: #ffffff; color: #1a1a1a;',
    '  border: 1px solid rgba(0,0,0,0.12);',
    '  box-shadow: 0 4px 14px rgba(0,0,0,0.14);',
    '  font-size: 12px; line-height: 1.2; max-width: 320px;',
    '  transition: transform .12s ease, opacity .12s ease;',
    '}',
    '.badge:hover { transform: translateY(-1px); }',
    '.dot { width: 8px; height: 8px; border-radius: 50%; background: #10b981; flex: 0 0 auto; }',
    '.dot.busy { background: #f59e0b; animation: pulse 1s ease-in-out infinite; }',
    '.dot.ok { background: #10b981; }',
    '.dot.err { background: #dc2626; }',
    '@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }',
    '.title { font-weight: 600; white-space: nowrap; }',
    '.counts { color: #5f6368; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '.close {',
    '  pointer-events: auto; cursor: pointer; margin-left: 2px; color: #9aa0a6;',
    '  font-weight: 700; font-size: 13px; padding: 0 2px;',
    '}',
    '.close:hover { color: #d93025; }',
    '@media (prefers-color-scheme: dark) {',
    '  .badge { background: #202124; color: #e8eaed; border-color: rgba(255,255,255,0.14);',
    '           box-shadow: 0 4px 16px rgba(0,0,0,0.5); }',
    '  .counts { color: #9aa0a6; }',
    '}'
  ].join('\n');

  function ensureHost() {
    try {
      var existing = document.getElementById(HOST_ID);
      if (existing && existing.shadowRoot) {
        shadowRoot = existing.shadowRoot;
        return existing;
      }
      var host = document.createElement('div');
      host.id = HOST_ID;
      // Keep the host itself out of layout flow.
      host.style.setProperty('all', 'initial', 'important');
      (document.documentElement || document.body).appendChild(host);
      shadowRoot = host.attachShadow ? host.attachShadow({ mode: 'open' }) : null;
      if (!shadowRoot) return null;

      var style = document.createElement('style');
      style.textContent = STYLE;
      shadowRoot.appendChild(style);

      var wrap = document.createElement('div');
      wrap.className = 'wrap';

      var badge = document.createElement('div');
      badge.className = 'badge';
      badge.setAttribute('role', 'button');
      badge.setAttribute('tabindex', '0');
      badge.title = 'SERP Snapshot — click to refresh the popup with this capture';

      var dot = document.createElement('span');
      dot.className = 'dot';

      var title = document.createElement('span');
      title.className = 'title';
      title.textContent = 'SERP Snapshot';

      var counts = document.createElement('span');
      counts.className = 'counts';
      counts.textContent = '';

      var close = document.createElement('span');
      close.className = 'close';
      close.textContent = '×';
      close.title = 'Hide badge';

      badge.appendChild(dot);
      badge.appendChild(title);
      badge.appendChild(counts);
      badge.appendChild(close);
      wrap.appendChild(badge);
      shadowRoot.appendChild(wrap);

      els = { host: host, wrap: wrap, badge: badge, dot: dot, title: title, counts: counts, close: close };

      badge.addEventListener('click', function (e) {
        if (e.target === close) return;
        try {
          if (typeof els._onClick === 'function') els._onClick();
        } catch (err) {
          /* ignore */
        }
      });
      badge.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          if (typeof els._onClick === 'function') els._onClick();
        }
      });
      close.addEventListener('click', function (e) {
        e.stopPropagation();
        hide();
      });

      return host;
    } catch (e) {
      return null;
    }
  }

  /**
   * Register a click handler (main.js wires this to re-broadcast the capture).
   */
  function onClick(fn) {
    ensureHost();
    els._onClick = fn;
  }

  /**
   * Show the "capturing…" busy state.
   */
  function showBusy() {
    try {
      if (!ensureHost()) return;
      els.dot.className = 'dot busy';
      els.title.textContent = 'SERP Snapshot';
      els.counts.textContent = 'capturing…';
      els.wrap.style.display = '';
    } catch (e) {
      /* silent */
    }
  }

  /**
   * Show final counts. `counts` is the capture.counts object.
   */
  function showCounts(counts) {
    try {
      if (!ensureHost()) return;
      els.dot.className = 'dot ok';
      var aio = counts.aioPresent ? 'AI Overview: ' + counts.aioSources + ' sources' : 'No AI Overview';
      els.counts.textContent =
        counts.organic + ' organic · ' + counts.paa + ' PAA · ' + counts.related + ' related · ' + aio;
      els.wrap.style.display = '';
    } catch (e) {
      /* silent */
    }
  }

  function showError(message) {
    try {
      if (!ensureHost()) return;
      els.dot.className = 'dot err';
      els.counts.textContent = message || 'capture failed';
      els.wrap.style.display = '';
    } catch (e) {
      /* silent */
    }
  }

  function hide() {
    try {
      if (els.wrap) els.wrap.style.display = 'none';
    } catch (e) {
      /* silent */
    }
  }

  NS.badge = {
    onClick: onClick,
    showBusy: showBusy,
    showCounts: showCounts,
    showError: showError,
    hide: hide
  };
})(typeof window !== 'undefined' ? window : this);
