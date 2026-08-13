/**
 * popup.js — capture flow, preview counts, CSV/clipboard export, history, and
 * settings. Talks to the content script via chrome.tabs.sendMessage.
 *
 * No network. No extra permissions: we only read the active tab's id (allowed
 * without the "tabs" permission) and message the already-injected content
 * script (allowed without host permissions because it's declared in the
 * manifest match). We detect "are we on a SERP" by PINGing the content script
 * rather than reading the tab URL, so we never need the "tabs" permission.
 */
(function () {
  'use strict';

  var NS = window.SERPSnapshot || {};
  var CSV = NS.csv;
  var UU = NS.urlunwrap;
  var STORE = NS.storage;

  var state = {
    capture: null, // last capture object from content script
    settings: null,
    format: 'csv'
  };

  // ---- DOM refs -----------------------------------------------------------
  var $ = function (id) {
    return document.getElementById(id);
  };

  var el = {
    tabs: document.querySelectorAll('.tab'),
    panels: document.querySelectorAll('.panel'),
    pageHint: $('page-hint'),
    captureBtn: $('capture-btn'),
    preview: $('preview'),
    cOrganic: $('c-organic'),
    cPaa: $('c-paa'),
    cRelated: $('c-related'),
    cAio: $('c-aio'),
    cAioChip: $('c-aio-chip'),
    previewStat: $('preview-stat'),
    segs: document.querySelectorAll('.seg'),
    optAllSections: $('opt-all-sections'),
    exportBtn: $('export-btn'),
    copyOrganicBtn: $('copy-organic-btn'),
    status: $('status'),
    historyList: $('history-list'),
    historyEmpty: $('history-empty'),
    historyDetail: $('history-detail'),
    clearHistoryBtn: $('clear-history-btn'),
    setFormat: $('set-format'),
    setAllSections: $('set-all-sections'),
    setSitelinks: $('set-sitelinks'),
    setRich: $('set-rich'),
    settingsSaved: $('settings-saved')
  };

  // ---- Tabs ---------------------------------------------------------------
  function initTabs() {
    el.tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        var name = t.getAttribute('data-tab');
        el.tabs.forEach(function (x) {
          x.classList.toggle('active', x === t);
        });
        el.panels.forEach(function (p) {
          p.classList.toggle('active', p.getAttribute('data-panel') === name);
        });
        if (name === 'history') renderHistory();
      });
    });
  }

  // ---- Messaging with the content script ----------------------------------

  function getActiveTabId() {
    return new Promise(function (resolve) {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
          void (chrome.runtime && chrome.runtime.lastError);
          resolve(tabs && tabs[0] ? tabs[0].id : null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  function sendToContent(message) {
    return getActiveTabId().then(function (tabId) {
      if (tabId == null) return Promise.reject(new Error('no active tab'));
      return new Promise(function (resolve, reject) {
        try {
          chrome.tabs.sendMessage(tabId, message, function (resp) {
            var err = chrome.runtime && chrome.runtime.lastError;
            if (err) {
              reject(new Error(err.message || 'no content script on this page'));
              return;
            }
            resolve(resp);
          });
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  // ---- Capture ------------------------------------------------------------

  function setStatus(msg, kind) {
    el.status.textContent = msg || '';
    el.status.className = 'status' + (kind ? ' ' + kind : '');
  }

  function onCapture() {
    setStatus('Capturing… (expanding People Also Ask)');
    el.captureBtn.disabled = true;
    sendToContent({ type: 'SERP_SNAPSHOT_CAPTURE' })
      .then(function (resp) {
        el.captureBtn.disabled = false;
        if (!resp || !resp.ok) {
          setStatus((resp && resp.error) || 'Capture failed.', 'err');
          return;
        }
        applyCapture(resp.data);
        setStatus('Captured. Ready to export.', 'ok');
      })
      .catch(function (err) {
        el.captureBtn.disabled = false;
        setStatus(explainError(err), 'err');
      });
  }

  function explainError(err) {
    var m = String(err && err.message ? err.message : err);
    if (/no content script|Receiving end does not exist|no active tab/i.test(m)) {
      return 'Open a Google search results page first, then capture.';
    }
    return 'Error: ' + m;
  }

  function applyCapture(data) {
    state.capture = data;
    if (!data) {
      el.preview.classList.add('hidden');
      el.exportBtn.disabled = true;
      el.copyOrganicBtn.disabled = true;
      return;
    }
    var c = data.counts || {};
    el.cOrganic.textContent = c.organic || 0;
    el.cPaa.textContent = c.paa || 0;
    el.cRelated.textContent = c.related || 0;
    if (c.aioPresent) {
      el.cAio.textContent = c.aioSources;
      el.cAioChip.style.display = '';
    } else {
      el.cAio.textContent = 'not present';
    }
    el.preview.classList.remove('hidden');

    // The shareable stat: how many cited domains also rank in the top 10.
    var stat = buildCrossRefStat(data);
    el.previewStat.textContent = stat.text;
    el.previewStat.className = 'preview-stat' + (stat.good ? ' good' : '');

    el.exportBtn.disabled = false;
    el.copyOrganicBtn.disabled = (data.organic || []).length === 0;
  }

  function buildCrossRefStat(data) {
    if (!data.aio || !data.aio.aioPresent) {
      return { text: 'No AI Overview on this SERP.', good: false };
    }
    var cited = data.aio.citedDomains || [];
    var both = cited.filter(function (d) {
      return d.ranksInOrganicTop10;
    }).length;
    if (!cited.length) {
      return { text: 'AI Overview present, but no citations detected.', good: false };
    }
    return {
      text:
        both +
        ' of ' +
        cited.length +
        ' AI-cited domains also rank in the organic top 10.',
      good: both > 0
    };
  }

  // ---- CSV builders (column specs are exact — see README) -----------------

  function metaLines(data, sectionName) {
    var m = data.meta || {};
    return [
      ['# SERP Snapshot'],
      ['# Query', m.query || ''],
      ['# Captured', m.capturedAt || ''],
      ['# Location', m.location || 'not detected'],
      ['# Source', m.pageUrl || ''],
      ['# Section', sectionName]
    ];
  }

  function organicCsv(data) {
    var header = [
      'position',
      'title',
      'url',
      'domain',
      'snippet',
      'is_sitelink',
      'parent_position',
      'cited_by_ai_overview'
    ];
    var rows = [];
    var includeSitelinks = state.settings ? state.settings.includeSitelinks : true;

    (data.organic || []).forEach(function (r) {
      rows.push([
        r.position,
        r.title,
        r.url,
        r.domain,
        r.snippet,
        'false',
        '',
        r.citedByAIOverview ? 'true' : 'false'
      ]);
      if (includeSitelinks && r.sitelinks && r.sitelinks.length) {
        r.sitelinks.forEach(function (sl) {
          rows.push([
            '',
            sl.sitelinkTitle,
            sl.sitelinkUrl,
            UU ? UU.domainOf(sl.sitelinkUrl) : '',
            '',
            'true',
            r.position,
            ''
          ]);
        });
      }
    });
    return CSV.build({ metaLines: metaLines(data, 'Organic results'), header: header, rows: rows });
  }

  function paaCsv(data) {
    var header = ['position', 'question', 'answer_snippet', 'answer_source_url', 'is_nested'];
    var rows = (data.paa || []).map(function (p) {
      return [p.position, p.question, p.answerSnippet, p.answerSourceUrl, p.nested ? 'true' : 'false'];
    });
    return CSV.build({ metaLines: metaLines(data, 'People Also Ask'), header: header, rows: rows });
  }

  function relatedCsv(data) {
    var header = ['position', 'text'];
    var rows = (data.related || []).map(function (r) {
      return [r.position, r.text];
    });
    return CSV.build({ metaLines: metaLines(data, 'Related searches'), header: header, rows: rows });
  }

  function aioCsv(data) {
    var header = ['cited_domain', 'cited_url', 'cited_title', 'ranks_in_organic_top10'];
    var rows = [];
    if (data.aio && data.aio.aioPresent && data.aio.citedDomains) {
      data.aio.citedDomains.forEach(function (d) {
        rows.push([d.domain, d.url, d.title || '', d.ranksInOrganicTop10 ? 'true' : 'false']);
      });
    }
    return CSV.build({ metaLines: metaLines(data, 'AI Overview citations'), header: header, rows: rows });
  }

  function richCsv(data) {
    var header = ['type', 'title', 'url', 'domain'];
    var rows = (data.richResults || []).map(function (r) {
      return [r.type, r.title, r.url, r.domain];
    });
    return CSV.build({ metaLines: metaLines(data, 'Rich results / carousels'), header: header, rows: rows });
  }

  // ---- Download helper (Blob + anchor click, no downloads permission) -----

  function slug(s) {
    return String(s || 'serp')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'serp';
  }

  function downloadCsv(text, filename) {
    var blob = CSV.buildCsvBlob(text);
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke after a tick so the download has a chance to start.
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1500);
  }

  function exportCsv(data) {
    var base = 'serp-' + slug(data.meta && data.meta.query);
    var files = [{ text: organicCsv(data), name: base + '-organic.csv' }];

    var includeAll = el.optAllSections.checked;
    var includeRich = state.settings ? state.settings.includeRichResults : true;

    if (includeAll) {
      files.push({ text: paaCsv(data), name: base + '-paa.csv' });
      files.push({ text: relatedCsv(data), name: base + '-related.csv' });
      files.push({ text: aioCsv(data), name: base + '-aioverview.csv' });
      if (includeRich && (data.richResults || []).length) {
        files.push({ text: richCsv(data), name: base + '-rich.csv' });
      }
    }

    // Stagger the downloads so Chrome doesn't silently drop the extra files.
    files.forEach(function (f, i) {
      setTimeout(function () {
        downloadCsv(f.text, f.name);
      }, i * 250);
    });

    setStatus(
      files.length === 1
        ? 'Downloaded organic CSV.'
        : 'Downloaded ' + files.length + ' CSV files.',
      'ok'
    );
  }

  // ---- Clipboard (TSV) ----------------------------------------------------

  function organicTsv(data) {
    var lines = [];
    lines.push(
      CSV.tsvRow(['position', 'title', 'url', 'domain', 'snippet', 'is_sitelink', 'parent_position', 'cited_by_ai_overview'])
    );
    var includeSitelinks = state.settings ? state.settings.includeSitelinks : true;
    (data.organic || []).forEach(function (r) {
      lines.push(
        CSV.tsvRow([
          r.position,
          r.title,
          r.url,
          r.domain,
          r.snippet,
          'false',
          '',
          r.citedByAIOverview ? 'true' : 'false'
        ])
      );
      if (includeSitelinks && r.sitelinks) {
        r.sitelinks.forEach(function (sl) {
          lines.push(
            CSV.tsvRow(['', sl.sitelinkTitle, sl.sitelinkUrl, UU ? UU.domainOf(sl.sitelinkUrl) : '', '', 'true', r.position, ''])
          );
        });
      }
    });
    return lines.join('\n');
  }

  function fullTsv(data) {
    var m = data.meta || {};
    var blocks = [];
    blocks.push('# SERP Snapshot\tQuery: ' + (m.query || '') + '\tCaptured: ' + (m.capturedAt || '') + '\tLocation: ' + (m.location || 'not detected'));
    blocks.push('');
    blocks.push('## Organic results');
    blocks.push(organicTsv(data));

    blocks.push('');
    blocks.push('## People Also Ask');
    blocks.push(CSV.tsvRow(['position', 'question', 'answer_snippet', 'answer_source_url', 'is_nested']));
    (data.paa || []).forEach(function (p) {
      blocks.push(CSV.tsvRow([p.position, p.question, p.answerSnippet, p.answerSourceUrl, p.nested ? 'true' : 'false']));
    });

    blocks.push('');
    blocks.push('## Related searches');
    blocks.push(CSV.tsvRow(['position', 'text']));
    (data.related || []).forEach(function (r) {
      blocks.push(CSV.tsvRow([r.position, r.text]));
    });

    blocks.push('');
    blocks.push('## AI Overview citations');
    blocks.push(CSV.tsvRow(['cited_domain', 'cited_url', 'cited_title', 'ranks_in_organic_top10']));
    if (data.aio && data.aio.aioPresent && data.aio.citedDomains) {
      data.aio.citedDomains.forEach(function (d) {
        blocks.push(CSV.tsvRow([d.domain, d.url, d.title || '', d.ranksInOrganicTop10 ? 'true' : 'false']));
      });
    }
    return blocks.join('\n');
  }

  function copyText(text) {
    return navigator.clipboard.writeText(text);
  }

  function exportClipboard(data) {
    var text = el.optAllSections.checked ? fullTsv(data) : organicTsv(data);
    copyText(text)
      .then(function () {
        setStatus('Copied to clipboard — paste into Sheets/Excel.', 'ok');
      })
      .catch(function (err) {
        setStatus('Clipboard blocked: ' + (err && err.message ? err.message : err), 'err');
      });
  }

  function onExport() {
    if (!state.capture) return;
    if (state.format === 'clipboard') exportClipboard(state.capture);
    else exportCsv(state.capture);
  }

  function onCopyOrganic() {
    if (!state.capture) return;
    copyText(organicTsv(state.capture))
      .then(function () {
        setStatus('Organic table copied — paste into a spreadsheet.', 'ok');
      })
      .catch(function (err) {
        setStatus('Clipboard blocked: ' + (err && err.message ? err.message : err), 'err');
      });
  }

  // ---- Format toggle ------------------------------------------------------

  function setFormat(fmt) {
    state.format = fmt;
    el.segs.forEach(function (s) {
      s.classList.toggle('active', s.getAttribute('data-format') === fmt);
    });
  }

  // ---- History ------------------------------------------------------------

  function renderHistory() {
    STORE.getHistory().then(function (list) {
      el.historyDetail.classList.add('hidden');
      el.historyList.innerHTML = '';
      if (!list.length) {
        el.historyEmpty.style.display = '';
        return;
      }
      el.historyEmpty.style.display = 'none';
      list.forEach(function (entry) {
        var li = document.createElement('li');
        li.className = 'history-item';

        var q = document.createElement('div');
        q.className = 'q';
        q.textContent = entry.query || '(no query)';

        var meta = document.createElement('div');
        meta.className = 'meta';

        var date = document.createElement('span');
        date.textContent = formatDate(entry.date);

        var cnt = document.createElement('span');
        cnt.textContent = entry.resultCount + ' organic';

        meta.appendChild(date);
        meta.appendChild(cnt);
        if (entry.aioPresent) {
          var aio = document.createElement('span');
          aio.className = 'badge-aio';
          aio.textContent = 'AI Overview';
          meta.appendChild(aio);
        }

        li.appendChild(q);
        li.appendChild(meta);
        li.addEventListener('click', function () {
          showHistoryDetail(entry);
        });
        el.historyList.appendChild(li);
      });
    });
  }

  function showHistoryDetail(entry) {
    el.historyDetail.classList.remove('hidden');
    el.historyDetail.innerHTML = '';
    var rows = [
      ['Query', entry.query || '(no query)'],
      ['Captured', formatDate(entry.date)],
      ['Organic results', String(entry.resultCount)],
      ['AI Overview', entry.aioPresent ? 'present' : 'absent']
    ];
    rows.forEach(function (r) {
      var div = document.createElement('div');
      var b = document.createElement('b');
      b.textContent = r[0] + ': ';
      div.appendChild(b);
      div.appendChild(document.createTextNode(r[1]));
      el.historyDetail.appendChild(div);
    });
    var note = document.createElement('div');
    note.style.marginTop = '8px';
    note.style.color = 'var(--muted)';
    note.textContent = 'This is a saved summary — re-visit the SERP and capture again for fresh data.';
    el.historyDetail.appendChild(note);
  }

  function formatDate(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleString();
    } catch (e) {
      return iso || '';
    }
  }

  function onClearHistory() {
    STORE.clearHistory().then(function () {
      renderHistory();
    });
  }

  // ---- Settings -----------------------------------------------------------

  function applySettingsToUi(s) {
    state.settings = s;
    setFormat(s.defaultFormat || 'csv');
    el.optAllSections.checked = !!s.includeAllSections;
    el.setFormat.value = s.defaultFormat || 'csv';
    el.setAllSections.checked = !!s.includeAllSections;
    el.setSitelinks.checked = !!s.includeSitelinks;
    el.setRich.checked = !!s.includeRichResults;
  }

  function wireSettings() {
    function save(partial, label) {
      STORE.saveSettings(partial).then(function (next) {
        state.settings = next;
        // Keep the capture-tab controls in sync with settings.
        if (partial.defaultFormat) setFormat(partial.defaultFormat);
        if (typeof partial.includeAllSections === 'boolean') {
          el.optAllSections.checked = partial.includeAllSections;
        }
        el.settingsSaved.textContent = (label || 'Saved') + ' ✓';
        el.settingsSaved.className = 'status ok';
        setTimeout(function () {
          el.settingsSaved.textContent = '';
        }, 1500);
      });
    }
    el.setFormat.addEventListener('change', function () {
      save({ defaultFormat: el.setFormat.value }, 'Default format saved');
    });
    el.setAllSections.addEventListener('change', function () {
      save({ includeAllSections: el.setAllSections.checked }, 'Saved');
    });
    el.setSitelinks.addEventListener('change', function () {
      save({ includeSitelinks: el.setSitelinks.checked }, 'Saved');
    });
    el.setRich.addEventListener('change', function () {
      save({ includeRichResults: el.setRich.checked }, 'Saved');
    });
  }

  // ---- Wire up ------------------------------------------------------------

  function wireCapture() {
    el.captureBtn.addEventListener('click', onCapture);
    el.exportBtn.addEventListener('click', onExport);
    el.copyOrganicBtn.addEventListener('click', onCopyOrganic);
    el.segs.forEach(function (s) {
      s.addEventListener('click', function () {
        setFormat(s.getAttribute('data-format'));
      });
    });
    el.optAllSections.addEventListener('change', function () {
      // Reflect into settings so it persists as the user's preference.
      if (state.settings) {
        STORE.saveSettings({ includeAllSections: el.optAllSections.checked }).then(function (n) {
          state.settings = n;
        });
      }
    });
    el.clearHistoryBtn.addEventListener('click', onClearHistory);
  }

  /**
   * On open: detect whether we're on a SERP by pinging the content script, and
   * if so, pull the last passive capture to prefill the preview.
   */
  function initActivePage() {
    sendToContent({ type: 'SERP_SNAPSHOT_PING' })
      .then(function (resp) {
        if (resp && resp.ok && resp.onSearchPage) {
          el.pageHint.textContent = 'Google SERP detected. Capture to expand PAA and pull everything.';
          return sendToContent({ type: 'SERP_SNAPSHOT_GET_LAST' }).then(function (r) {
            if (r && r.ok && r.data) applyCapture(r.data);
          });
        }
        el.pageHint.textContent = 'Not a Google SERP. Open google.com/search results, then capture.';
        el.captureBtn.disabled = true;
      })
      .catch(function () {
        el.pageHint.textContent = 'Open a Google search results page, then capture it.';
        el.captureBtn.disabled = true;
      });
  }

  /**
   * Show the running version in the About card, read from the manifest so it
   * never drifts from the packaged version.
   */
  function showVersion() {
    try {
      var el2 = document.getElementById('about-version');
      if (el2 && chrome.runtime && chrome.runtime.getManifest) {
        el2.textContent = chrome.runtime.getManifest().version;
      }
    } catch (e) {
      /* keep the static fallback */
    }
  }

  function boot() {
    initTabs();
    wireCapture();
    wireSettings();
    showVersion();
    (STORE ? STORE.getSettings() : Promise.resolve(null)).then(function (s) {
      if (s) applySettingsToUi(s);
      initActivePage();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
