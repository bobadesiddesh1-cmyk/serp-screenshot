/**
 * csv.js — RFC 4180-compliant CSV building + TSV (clipboard) building.
 *
 * SERP snippets WILL contain commas, double-quotes, and sometimes newlines, so
 * escaping has to be correct or the export corrupts the moment a snippet has a
 * comma in it. Rules implemented:
 *
 *   - A field is quoted iff it contains a comma, a double-quote, CR, or LF.
 *   - Inside a quoted field, each `"` is doubled to `""`.
 *   - Rows are joined with CRLF (Excel-friendly).
 *   - A UTF-8 BOM is prepended by buildCsvBlob so Excel reads accents correctly.
 *
 * The TSV builder (for clipboard) uses tabs as delimiters and strips tabs/newlines
 * from field values so a single cell can't spill across columns/rows on paste.
 *
 * Pure module. Attaches to window.SERPSnapshot.csv.
 */
(function (root) {
  'use strict';

  var NS = (root.SERPSnapshot = root.SERPSnapshot || {});

  var CRLF = '\r\n';
  var NEEDS_QUOTING = /[",\r\n]/;
  var BOM = '﻿';

  /**
   * Escape a single CSV field per RFC 4180.
   * null/undefined become empty string; everything else is coerced to string.
   */
  function escapeField(value) {
    if (value === null || value === undefined) return '';
    var s = String(value);
    if (NEEDS_QUOTING.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  /**
   * Build one CSV line from an array of field values.
   */
  function row(fields) {
    if (!Array.isArray(fields)) return '';
    var out = [];
    for (var i = 0; i < fields.length; i++) {
      out.push(escapeField(fields[i]));
    }
    return out.join(',');
  }

  /**
   * Build a full CSV string.
   *
   * @param {Object} opts
   * @param {Array<Array>} [opts.metaLines]  arrays of fields rendered as leading
   *                                         rows (query, capture time, location).
   * @param {Array} opts.header              column header row (array of strings).
   * @param {Array<Array>} opts.rows         data rows (each an array of fields).
   * @returns {string} the CSV text (no BOM; buildCsvBlob adds it).
   */
  function build(opts) {
    opts = opts || {};
    var lines = [];
    if (opts.metaLines && opts.metaLines.length) {
      for (var m = 0; m < opts.metaLines.length; m++) {
        lines.push(row(opts.metaLines[m]));
      }
      // Blank spacer line between metadata and the table so Excel treats the
      // header row as the table header.
      lines.push('');
    }
    if (opts.header) lines.push(row(opts.header));
    if (opts.rows) {
      for (var r = 0; r < opts.rows.length; r++) {
        lines.push(row(opts.rows[r]));
      }
    }
    return lines.join(CRLF);
  }

  /**
   * Wrap CSV text in a Blob with a UTF-8 BOM so Excel opens it correctly.
   * @returns {Blob}
   */
  function buildCsvBlob(csvText) {
    return new Blob([BOM + csvText], { type: 'text/csv;charset=utf-8;' });
  }

  // ---- TSV / clipboard helpers -------------------------------------------

  /**
   * Sanitize a value for a single TSV cell: collapse embedded tabs and newlines
   * to single spaces so the cell can't break the column/row grid on paste.
   */
  function tsvCell(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[\t\r\n]+/g, ' ').trim();
  }

  /**
   * Build one tab-separated line.
   */
  function tsvRow(fields) {
    if (!Array.isArray(fields)) return '';
    var out = [];
    for (var i = 0; i < fields.length; i++) out.push(tsvCell(fields[i]));
    return out.join('\t');
  }

  NS.csv = {
    escapeField: escapeField,
    row: row,
    build: build,
    buildCsvBlob: buildCsvBlob,
    tsvCell: tsvCell,
    tsvRow: tsvRow,
    CRLF: CRLF
  };
})(typeof window !== 'undefined' ? window : this);
