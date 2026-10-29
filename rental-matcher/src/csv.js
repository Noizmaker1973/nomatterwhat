/**
 * Minimal RFC 4180 CSV parser/serializer (quoted fields, embedded commas,
 * quotes and newlines). Auto-detects comma, semicolon or tab delimiters.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.RM = root.RM || {}).csv = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function detectDelimiter(text) {
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let inQuotes = false;
    for (const ch of firstLine) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (!inQuotes && ch in counts) counts[ch]++;
    }
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return best[1] > 0 ? best[0] : ',';
  }

  /** Parse CSV text into an array of rows (arrays of strings). */
  function parseRows(text, delimiter) {
    text = String(text || '').replace(/^﻿/, '');
    const d = delimiter || detectDelimiter(text);
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === d) { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
  }

  /** Parse CSV with a header row into {headers, records}. */
  function parse(text, delimiter) {
    const rows = parseRows(text, delimiter);
    if (!rows.length) return { headers: [], records: [] };
    const headers = rows[0].map((h) => h.trim());
    const records = rows.slice(1).map((r) => {
      const o = {};
      headers.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); });
      return o;
    });
    return { headers, records };
  }

  function escapeCell(v) {
    if (v === null || v === undefined) return '';
    const s = Array.isArray(v) ? v.join('; ') : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** Serialize objects to CSV using the given column list [{key,label}] or keys. */
  function stringify(objects, columns) {
    const cols = (columns || Object.keys(objects[0] || {})).map((c) =>
      typeof c === 'string' ? { key: c, label: c } : c);
    const lines = [cols.map((c) => escapeCell(c.label)).join(',')];
    for (const o of objects) lines.push(cols.map((c) => escapeCell(o[c.key])).join(','));
    return lines.join('\r\n') + '\r\n';
  }

  return { parse, parseRows, stringify, detectDelimiter };
});
