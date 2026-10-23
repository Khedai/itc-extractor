// Tracker export — "Submit to Tracker" / "Export Tracker", replicating the
// original single-file Khusela app:
//
//   • Submit to Tracker  validates Name + Surname + ID + Application Type,
//                        appends ONE 12-column row to a persistent on-device
//                        tracker (browser localStorage, key
//                        'khusela_sales_tracker_v1'), then downloads the whole
//                        tracker as a real Excel workbook
//                        (Khusela_Sales_Tracker.xlsx).
//   • Export Tracker     re-downloads that workbook without adding a row.
//
// Only the essential intake details are recorded (not every form field):
//   DATE, NAME, SURNAME, ID NUMBER, CELL, WHATSAPP, EMAIL, APPLICATION TYPE,
//   BANK, ACCOUNT NO, DEBIT ORDER DATE, DEBIT ORDER AMOUNT.
//
// Values are read straight off the form's name= fields, so every column the
// trimmed tracker captures is filled (the original form field names are used
// verbatim). The pure core (row building + XLSX serialisation) has no DOM
// dependency, so it is testable with plain Node (see tools/test_tracker_node.js).
(function () {
  'use strict';

  const TRACKER_KEY = 'khusela_sales_tracker_v1';
  const TRACKER_FILE = 'Khusela_Sales_Tracker.xlsx';
  const TRACKER_SHEET = 'Tracker';

  const TRACKER_HEADERS = [
    'DATE', 'NAME', 'SURNAME', 'ID NUMBER', 'CELL', 'WHATSAPP', 'EMAIL',
    'APPLICATION TYPE', 'BANK', 'ACCOUNT NO', 'DEBIT ORDER DATE',
    'DEBIT ORDER AMOUNT',
  ];

  // Tracker header -> source key in the plain-object passed to buildRow().
  const SOURCE_BY_HEADER = {
    'DATE': 'date', 'NAME': 'name', 'SURNAME': 'surname', 'ID NUMBER': 'id',
    'CELL': 'cell', 'WHATSAPP': 'whatsapp', 'EMAIL': 'email',
    'APPLICATION TYPE': 'application_type', 'BANK': 'bank',
    'ACCOUNT NO': 'account_no', 'DEBIT ORDER DATE': 'debit_order_date',
    'DEBIT ORDER AMOUNT': 'debit_order_amount',
  };

  // ── Pure core (testable without a DOM) ───────────────────────────────────

  // Turn a plain sources object into a full tracker row keyed by the workbook
  // headers (missing sources → '').
  function buildRow(sources) {
    const row = {};
    TRACKER_HEADERS.forEach((h) => { row[h] = ''; });
    TRACKER_HEADERS.forEach((h) => {
      const v = sources ? sources[SOURCE_BY_HEADER[h]] : '';
      row[h] = v == null ? '' : String(v);
    });
    return row;
  }

  // ── Minimal XLSX writer (no dependencies) ────────────────────────────────
  // An .xlsx is a ZIP of XML parts. The rows are small and few, so every part
  // is stored uncompressed (ZIP method 0) — valid Excel, and no ZIP library or
  // compression code needed.

  const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const OFFICE_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  const utf8 = (s) => new TextEncoder().encode(s);
  const u16 = (v) => [v & 255, (v >>> 8) & 255];
  const u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];

  const xmlEsc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

  function colName(n) {
    let s = '';
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(data) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // Build a ZIP with every part stored (method 0). Uses the 1980-01-01 DOS
  // timestamp and the UTF-8 filename flag.
  function zipStore(files) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    files.forEach((f) => {
      const name = utf8(f.name);
      const data = f.data;
      const crc = crc32(data);
      const local = new Uint8Array([].concat(
        u32(0x04034B50), u16(20), u16(0x0800), u16(0),
        u16(0), u16(0x21),
        u32(crc), u32(data.length), u32(data.length),
        u16(name.length), u16(0),
      ));
      locals.push(local, name, data);
      const central = new Uint8Array([].concat(
        u32(0x02014B50), u16(20), u16(20), u16(0x0800), u16(0),
        u16(0), u16(0x21),
        u32(crc), u32(data.length), u32(data.length),
        u16(name.length), u16(0), u16(0), u16(0), u16(0),
        u32(0), u32(offset),
      ));
      centrals.push(central, name);
      offset += local.length + name.length + data.length;
    });
    const centralSize = centrals.reduce((n, p) => n + p.length, 0);
    const end = new Uint8Array([].concat(
      u32(0x06054B50), u16(0), u16(0),
      u16(files.length), u16(files.length),
      u32(centralSize), u32(offset), u16(0),
    ));
    const parts = locals.concat(centrals, [end]);
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let pos = 0;
    parts.forEach((p) => { out.set(p, pos); pos += p.length; });
    return out;
  }

  const STYLES_XML = XML_HEAD +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
    '</styleSheet>';

  function buildSheetXml(rows) {
    const all = [TRACKER_HEADERS].concat((rows || []).map((r) => TRACKER_HEADERS.map((h) => r[h])));
    const widths = TRACKER_HEADERS.map((h, i) => {
      let len = String(h).length;
      all.forEach((r) => { const v = String(r[i] == null ? '' : r[i]); if (v.length > len) len = v.length; });
      return Math.min(55, Math.max(12, len + 2));
    });
    const cols = '<cols>' + widths.map((w, i) =>
      '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols>';
    const body = all.map((vals, ri) => {
      const r = ri + 1;
      const cells = vals.map((v, ci) => {
        const ref = colName(ci + 1) + r;
        const style = ri === 0 ? ' s="1"' : '';
        return '<c r="' + ref + '"' + style + ' t="inlineStr"><is><t xml:space="preserve">' +
          xmlEsc(v) + '</t></is></c>';
      }).join('');
      return '<row r="' + r + '">' + cells + '</row>';
    }).join('');
    return XML_HEAD +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" ' +
      'activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      cols + '<sheetData>' + body + '</sheetData></worksheet>';
  }

  // Serialise every tracker row into a single-sheet Excel workbook (.xlsx).
  function toXlsx(rows) {
    const contentTypes = XML_HEAD +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>';
    const rootRels = XML_HEAD + '<Relationships xmlns="' + REL_NS + '">' +
      '<Relationship Id="rId1" Type="' + OFFICE_NS + '/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';
    const workbook = XML_HEAD +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="' + OFFICE_NS + '"><sheets>' +
      '<sheet name="' + xmlEsc(TRACKER_SHEET) + '" sheetId="1" r:id="rId1"/>' +
      '</sheets></workbook>';
    const workbookRels = XML_HEAD + '<Relationships xmlns="' + REL_NS + '">' +
      '<Relationship Id="rId1" Type="' + OFFICE_NS + '/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="' + OFFICE_NS + '/styles" Target="styles.xml"/>' +
      '</Relationships>';
    return zipStore([
      { name: '[Content_Types].xml', data: utf8(contentTypes) },
      { name: '_rels/.rels', data: utf8(rootRels) },
      { name: 'xl/workbook.xml', data: utf8(workbook) },
      { name: 'xl/_rels/workbook.xml.rels', data: utf8(workbookRels) },
      { name: 'xl/styles.xml', data: utf8(STYLES_XML) },
      { name: 'xl/worksheets/sheet1.xml', data: utf8(buildSheetXml(rows)) },
    ]);
  }

  // ── Persistence (browser localStorage) ───────────────────────────────────

  function getTracker() {
    try {
      const raw = localStorage.getItem(TRACKER_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function setTracker(rows) {
    try { localStorage.setItem(TRACKER_KEY, JSON.stringify(rows)); } catch (e) { /* storage unavailable */ }
  }

  // ── Reading the current application off the form ─────────────────────────

  const val = (name) => {
    if (typeof document === 'undefined') return '';
    const el = document.querySelector('[name="' + name + '"]');
    return el ? String(el.value == null ? '' : el.value).trim() : '';
  };

  // The essential intake values, read from the form's name= fields exactly as
  // the original did.
  function collectSources() {
    return {
      date: val('date'),
      name: val('name'),
      surname: val('surname'),
      id: val('id'),
      cell: val('cell'),
      whatsapp: val('whatsapp'),
      email: val('email'),
      application_type: val('application_type'),
      bank: val('bank'),
      account_no: val('account_no'),
      debit_order_date: val('debit_order_date'),
      debit_order_amount: val('debit_order_amount'),
    };
  }

  // ── Browser actions ──────────────────────────────────────────────────────

  // Download the whole tracker workbook (no row is added). Returns true when a
  // download happened, false when the tracker is empty (mirrors the original,
  // which alerts in that case).
  function downloadXlsx() {
    const rows = getTracker();
    if (!rows.length) {
      if (typeof alert === 'function') {
        alert('There are no submitted applications in the tracker yet.');
      }
      return false;
    }
    const blob = new Blob([toXlsx(rows)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = TRACKER_FILE;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
    return true;
  }

  function exportTracker() {
    downloadXlsx();
  }

  function submitFromForm() {
    if (typeof document === 'undefined') return 'no-dom';
    const s = collectSources();
    if (!s.name || !s.surname || !s.id) {
      alert('Please enter or extract Name, Surname and ID Number before submitting.');
      return 'incomplete';
    }
    if (!s.application_type) {
      alert('Please select an Application Type before submitting.');
      return 'incomplete';
    }
    const rows = getTracker();
    rows.push(buildRow(s));
    setTracker(rows);
    downloadXlsx();
    alert('Application submitted successfully and added to the Khusela Sales Tracker. The updated tracker has been downloaded as an Excel workbook (Khusela_Sales_Tracker.xlsx).');
    return 'ok';
  }

  function wire() {
    if (typeof document === 'undefined') return;
    const run = () => {
      const btn = document.getElementById('btnTracker');
      const exportBtn = document.getElementById('btnExportTracker');
      if (btn) btn.addEventListener('click', submitFromForm);
      if (exportBtn) exportBtn.addEventListener('click', exportTracker);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
  }
  wire();

  // No-op for the old notification-clear API — tracker feedback is the
  // immediate download + alert of the original app.
  const clearStatus = function () {};

  const ITCTracker = {
    TRACKER_KEY, TRACKER_FILE, TRACKER_SHEET, TRACKER_HEADERS, SOURCE_BY_HEADER,
    buildRow, toXlsx, zipStore, crc32, getTracker, setTracker,
    collectSources, downloadXlsx, submitFromForm, exportTracker, wire, clearStatus,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = ITCTracker;
  else if (typeof window !== 'undefined') window.ITCTracker = ITCTracker;
})();
