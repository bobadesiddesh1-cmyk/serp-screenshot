/**
 * storage.js — thin promise wrapper over chrome.storage.local for settings and
 * capture history. Loaded both as a content script and by the popup (via a
 * <script> tag), so it must not assume a DOM.
 *
 * Keys:
 *   serp_snapshot_settings  → { defaultFormat, includeAllSections,
 *                               includeSitelinks, includeRichResults }
 *   serp_snapshot_history   → Array<{ query, date, resultCount, aioPresent }>
 *
 * Attaches to window.SERPSnapshot.storage.
 */
(function (root) {
  'use strict';

  var NS = (root.SERPSnapshot = root.SERPSnapshot || {});

  var SETTINGS_KEY = 'serp_snapshot_settings';
  var HISTORY_KEY = 'serp_snapshot_history';
  var HISTORY_CAP = 20;

  var DEFAULT_SETTINGS = {
    defaultFormat: 'csv', // 'csv' | 'clipboard'
    includeAllSections: true, // export PAA/related/AIO CSVs alongside organic
    includeSitelinks: true, // sitelink sub-rows in organic CSV
    includeRichResults: true // separate rich-results section
  };

  function hasChromeStorage() {
    return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  }

  function get(key) {
    return new Promise(function (resolve) {
      if (!hasChromeStorage()) return resolve(undefined);
      try {
        chrome.storage.local.get(key, function (res) {
          // chrome.runtime.lastError is read to swallow "context invalidated".
          void (chrome.runtime && chrome.runtime.lastError);
          resolve(res ? res[key] : undefined);
        });
      } catch (e) {
        resolve(undefined);
      }
    });
  }

  function set(obj) {
    return new Promise(function (resolve) {
      if (!hasChromeStorage()) return resolve(false);
      try {
        chrome.storage.local.set(obj, function () {
          void (chrome.runtime && chrome.runtime.lastError);
          resolve(true);
        });
      } catch (e) {
        resolve(false);
      }
    });
  }

  function getSettings() {
    return get(SETTINGS_KEY).then(function (stored) {
      // Merge over defaults so a newly-added setting always has a value.
      var merged = {};
      for (var k in DEFAULT_SETTINGS) {
        if (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, k)) {
          merged[k] = DEFAULT_SETTINGS[k];
        }
      }
      if (stored && typeof stored === 'object') {
        for (var j in stored) {
          if (Object.prototype.hasOwnProperty.call(stored, j)) merged[j] = stored[j];
        }
      }
      return merged;
    });
  }

  function saveSettings(partial) {
    return getSettings().then(function (current) {
      var next = current;
      if (partial && typeof partial === 'object') {
        for (var k in partial) {
          if (Object.prototype.hasOwnProperty.call(partial, k)) next[k] = partial[k];
        }
      }
      var payload = {};
      payload[SETTINGS_KEY] = next;
      return set(payload).then(function () {
        return next;
      });
    });
  }

  function getHistory() {
    return get(HISTORY_KEY).then(function (list) {
      return Array.isArray(list) ? list : [];
    });
  }

  /**
   * Prepend a history entry, dedupe nothing (each capture is its own event),
   * cap at HISTORY_CAP most-recent.
   * @param {{query:string,date:string,resultCount:number,aioPresent:boolean}} entry
   */
  function addHistory(entry) {
    return getHistory().then(function (list) {
      var next = [entry].concat(list).slice(0, HISTORY_CAP);
      var payload = {};
      payload[HISTORY_KEY] = next;
      return set(payload).then(function () {
        return next;
      });
    });
  }

  function clearHistory() {
    var payload = {};
    payload[HISTORY_KEY] = [];
    return set(payload).then(function () {
      return [];
    });
  }

  NS.storage = {
    SETTINGS_KEY: SETTINGS_KEY,
    HISTORY_KEY: HISTORY_KEY,
    HISTORY_CAP: HISTORY_CAP,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    getSettings: getSettings,
    saveSettings: saveSettings,
    getHistory: getHistory,
    addHistory: addHistory,
    clearHistory: clearHistory
  };
})(typeof window !== 'undefined' ? window : this);
