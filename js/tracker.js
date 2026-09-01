// Tracker export — appends the current application to the user's own tracker
// spreadsheet (Excel / CSV / ODS). The whole operation is client-side: the
// tracker file is read, a new row is appended at the bottom of the selected
// sheet, and the updated file is saved back (native save dialog when the
// browser supports the File System Access API, otherwise a normal download).
//
// Column behaviour:
//   • Headers on the sheet's first row are matched against known field names
//     (Name, Surname, ID Number, Account Number, Phone Number, Title, Amount).
//   • A field is written ONLY into a column that already exists — if the sheet
//     has no matching column (e.g. no Title), that field is skipped entirely.
//   • An empty sheet (no headers at all) gets its columns created first.
//   • The Amount column always gets an "R" (Rand) prefix — "R <amount>", or a
//     bare "R" when no amount is filled in.
//
// The module has no DOM dependencies in its pure core (matching / appending) so
// it can be unit-tested with plain Node (see tools/test_tracker_node.js); the
// browser wiring is applied separately when a document exists.
(function () {
  'use strict';

  // ── Field definitions ────────────────────────────────────────────────────
  // label  : header text used when a column must be created (empty sheet)
  // aliases: header names that count as a match (case/space/punctuation-insensitive)
  const FIELD_DEFS = [
    { key: 'name',    label: 'Name',           match: ['name', 'first name', 'names', 'full name', 'applicant', 'applicant name'] },
    { key: 'surname', label: 'Surname',        match: ['surname', 'last name', 'lastname', 'family name'] },
    { key: 'id',      label: 'ID Number',      match: ['id', 'id number', 'id no', 'idnum', 'identity', 'identity number', 'identity no', 'national id', 'rsa id'] },
    { key: 'account', label: 'Account Number', match: ['account', 'account number', 'account no', 'acc', 'acc no', 'acc number', 'account ref', 'client ref', 'client reference', 'application ref', 'application number'] },
    { key: 'phone',   label: 'Phone Number',   match: ['phone', 'phone number', 'phone no', 'cell', 'cellphone', 'cellular', 'cell no', 'mobile', 'mobile number', 'contact', 'contact number', 'tel', 'telephone', 'telephone no', 'home tel', 'work tel'] },
    { key: 'title',   label: 'Title',          match: ['title'] },
    { key: 'amount',  label: 'Amount',         match: ['amount', 'debit amount', 'reduced amount', 'loan amount', 'monthly amount', 'instalment', 'installment'] },
  ];

  // ── Pure matching + append logic (testable without a DOM) ────────────────

  const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const tokens = (s) => String(s == null ? '' : s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

  // How well a single header matches a field.
  //   100  = exact header match
  //    90  = exact + a common abbreviation suffix ("ID No" vs "ID", "Acc No" vs "Acc")
  //    60+ = every word of the alias appears in the header (multi-word aliases
  //          rank above single-word ones, so "Instalment Amount" beats "Amount")
  function matchScore(header, field) {
    const h = norm(header);
    if (!h) return 0;
    const hTokens = tokens(header);
    let best = 0;
    for (const alias of field.match) {
      const a = norm(alias);
      if (!a) continue;
      if (a === h) { best = 100; continue; }
      const aTokens = tokens(alias);
      if (aTokens.length && aTokens.every((t) => hTokens.includes(t))) {
        best = Math.max(best, 60 + 10 * aTokens.length);
      } else if (['no', 'num', 'number'].some((suffix) => h === a + suffix)) {
        best = Math.max(best, 90);
      }
    }
    return best;
  }

  // The amount column always carries an R (Rand): prefix a bare number with
  // "R ", keep an existing "R…", and write a bare "R" when no amount is set.
  function formatAmount(raw) {
    const v = String(raw == null ? '' : raw).trim();
    return v ? (/^R/i.test(v) ? v : 'R ' + v) : 'R';
  }

  // Map fieldKey -> column index for the headers of a sheet. Uses greedy
  // best-score assignment so "First Name"/"Last Name" resolve to the right
  // fields, no column is ever consumed twice, and weak partial matches (e.g.
  // "Name" matching a "Last Name" header) lose to exact ones.
  function matchColumns(header, fieldDefs) {
    const used = new Set();
    const assigned = new Map();
    const candidates = [];
    header.forEach((cell, ci) => {
      const hText = String(cell == null ? '' : cell).trim();
      if (!hText) return;
      fieldDefs.forEach((f, fi) => {
        const s = matchScore(hText, f);
        if (s > 0) candidates.push({ s, fi, ci });
      });
    });
    candidates.sort((x, y) => y.s - x.s || x.fi - y.fi || x.ci - y.ci);
    for (const c of candidates) {
      const field = fieldDefs[c.fi];
      if (used.has(c.ci) || assigned.has(field.key)) continue;
      used.add(c.ci);
      assigned.set(field.key, c.ci);
    }
    return assigned;
  }

  const isEmptyCell = (v) => v == null || String(v).trim() === '';
  const isEmptyRow = (r) => !r || r.every(isEmptyCell);

  // rows   : array-of-arrays from sheet_to_json(ws, { header: 1, defval: '' })
  // values : { name, surname, id, account, phone, title, amount }
  // returns: { rows, report } — report = { created[], matched[], skipped[],
  //          rowIndex (1-based), error? }
  function appendRows(rows, values, fieldDefs) {
    fieldDefs = fieldDefs || FIELD_DEFS;
    const report = { created: [], matched: [], skipped: [], rowIndex: -1 };

    let headerIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      if (!isEmptyRow(rows[i])) { headerIdx = i; break; }
    }

    const newRows = rows.map((r) => r.slice());
    let header;
    if (headerIdx === -1) {
      // Empty sheet — create every column so the tracker is well-formed.
      header = fieldDefs.map((f) => f.label);
      newRows.push(header.slice());
      headerIdx = newRows.length - 1;
      report.created = fieldDefs.map((f) => f.label);
    } else {
      header = newRows[headerIdx];
    }

    const assigned = matchColumns(header, fieldDefs);
    if (headerIdx !== -1 && assigned.size === 0) {
      const names = header.filter((c) => !isEmptyCell(c)).join(', ') || '(blank header)';
      report.error = 'No matching columns were found in the sheet header (' + names + '). ' +
        'Expected names such as Name, Surname, ID Number, Account Number, Phone Number, Title or Amount.';
      return { rows: newRows, report };
    }

    const dataRow = new Array(header.length).fill('');
    fieldDefs.forEach((f) => {
      const ci = assigned.get(f.key);
      if (ci == null) {
        if (!report.created.length) report.skipped.push(f.label);
        return;
      }
      dataRow[ci] = isEmptyCell(values[f.key]) ? '' : String(values[f.key]);
      if (!report.created.length) report.matched.push(f.label);
    });

    newRows.push(dataRow);
    report.rowIndex = newRows.length; // 1-based row number of the appended row
    return { rows: newRows, report };
  }

  // ── Browser helpers ──────────────────────────────────────────────────────

  const getEl = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);

  function xlsx() {
    if (typeof window !== 'undefined' && window.XLSX) return window.XLSX;
    if (typeof require === 'function') return require('../vendor/xlsx.full.min.js');
    return null;
  }

  // Gather the current application's values from the form. Account number is
  // the client reference (falling back to the application ref, then to the
  // first loan account number); phone is the cellular number by preference.
  function collectFormValues() {
    const get = (id) => { const el = getEl(id); return el ? String(el.value || '').trim() : ''; };
    const first = get('fFirst');
    const second = get('fSecond');
    const name = [first, second].filter(Boolean).join(' ');
    const surname = get('fSurname');
    const id = get('fId');
    const account = get('fClientRef') || get('fAppRef') || firstLoanAccount();
    const phone = get('fCell') || get('fHomeTel') || get('fWorkTel');
    const title = get('fTitle');
    const amount = formatAmount(get('fDebitAmount') || get('fReducedAmount'));
    return { name, surname, id, account, phone, title, amount };
  }

  function firstLoanAccount() {
    const body = getEl('loansBody');
    if (!body) return '';
    const row = body.querySelector('tr');
    if (!row) return '';
    const inputs = row.querySelectorAll('input');
    return inputs.length > 1 ? String(inputs[1].value || '').trim() : '';
  }

  function readFileArrayBuffer(file) {
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('Could not read the selected file.'));
      fr.readAsArrayBuffer(file);
    });
  }

  async function readWorkbook(file) {
    const X = xlsx();
    if (!X) throw new Error('The spreadsheet library failed to load.');
    const buf = await readFileArrayBuffer(file);
    return X.read(new Uint8Array(buf), { type: 'array', cellStyles: true });
  }

  function rowsFromSheet(ws) {
    return xlsx().utils.sheet_to_json(ws, { header: 1, defval: '' });
  }

  function sheetFromRows(ws, rows) {
    const rebuilt = xlsx().utils.aoa_to_sheet(rows);
    if (ws['!cols']) rebuilt['!cols'] = ws['!cols'];
    if (ws['!merges']) rebuilt['!merges'] = ws['!merges'];
    return rebuilt;
  }

  const BOOK_TYPES = { xlsx: 'xlsx', xls: 'biff8', csv: 'csv', ods: 'ods' };
  const MIME_TYPES = {
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    csv: 'text/csv',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',
  };
  const extensionOf = (name) => (String(name || '').split('.').pop() || '').toLowerCase();
  const mimeFor = (name) => MIME_TYPES[extensionOf(name)] || 'application/octet-stream';

  function workbookToBlob(wb, fileName) {
    const out = xlsx().write(wb, { bookType: BOOK_TYPES[extensionOf(fileName)] || 'xlsx', type: 'array' });
    return new Blob([out], { type: mimeFor(fileName) });
  }


  async function saveFile(blob, fileName) {
    // Prefer the File System Access API so the tracker file is overwritten in
    // place (Chrome / Edge). Fall back to a plain download everywhere else.
    if (window.showSaveFilePicker) {
      try {
        const ext = extensionOf(fileName);
        const accept = {};
        accept[mimeFor(fileName)] = ['.' + ext];
        const handle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [{ description: 'Spreadsheet', accept: accept }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return { via: 'picker', name: handle.name };
      } catch (e) {
        if (e && e.name === 'AbortError') {
          throw new Error('Save cancelled — nothing was written to the tracker. Your form data is still intact.');
        }
        // Any other failure — fall through to a plain download.
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
    return { via: 'download', name: fileName };
  }

  // ── Tracker UI (file picker + sheet selector + submit) ───────────────────

  function setTrackerStatus(type, html) {
    const el = getEl('trackerStatus');
    if (!el) return;
    el.innerHTML = html;
    el.className = 'itc-status' + (type ? ' ' + type : '');
  }

  function fillSheetSelect(wb, keepSelection) {
    const el = getEl('trackerSheet');
    if (!el) return;
    const prev = keepSelection ? el.value : null;
    el.innerHTML = '';
    (wb.SheetNames || []).forEach((name) => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      el.appendChild(opt);
    });
    if (prev && wb.SheetNames.includes(prev)) el.value = prev;
  }

  async function submitFromForm() {
    const fileEl = getEl('trackerFile');
    const sheetEl = getEl('trackerSheet');
    const file = fileEl && fileEl.files && fileEl.files[0];
    if (!file) {
      setTrackerStatus('err', 'Select your tracker Excel file first, then press <b>Submit to Tracker</b>.');
      const panel = getEl('trackerPanel');
      if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const sheetName = sheetEl && sheetEl.value ? sheetEl.value : null;

    let wb;
    try {
      wb = await readWorkbook(file);
    } catch (e) {
      setTrackerStatus('err', 'Could not read "' + file.name + '": ' + (e && e.message ? e.message : e));
      return;
    }
    const targetSheet = sheetName || (wb.SheetNames && wb.SheetNames[0]);
    const ws = targetSheet ? wb.Sheets[targetSheet] : null;
    if (!ws) {
      setTrackerStatus('err', 'The workbook has no readable sheet. Pick a valid Excel, CSV or ODS tracker file.');
      return;
    }

    const values = collectFormValues();
    if (!Object.values(values).some((v) => v !== '' && v != null)) {
      setTrackerStatus('err', 'Nothing to submit yet — fill at least one field on the application form first.');
      return;
    }

    const { rows: newRows, report } = appendRows(rowsFromSheet(ws), values, FIELD_DEFS);
    if (report.error) {
      setTrackerStatus('err', report.error);
      return;
    }

    wb.Sheets[targetSheet] = sheetFromRows(ws, newRows);


    let save;
    try {
      save = await saveFile(workbookToBlob(wb, file.name), file.name);
    } catch (e) {
      setTrackerStatus('err', (e && e.message ? e.message : 'Failed to save the tracker file.') + ' No changes were written.');
      return;
    }

    const parts = [];
    if (report.created.length) parts.push('created columns <b>' + report.created.join(', ') + '</b>');
    if (report.matched.length) parts.push('filled existing columns <b>' + report.matched.join(', ') + '</b>');
    if (report.skipped.length) parts.push('skipped <b>' + report.skipped.join(', ') + '</b> (no matching column)');
    const where = save.via === 'picker'
      ? 'The tracker file has been updated in place.'
      : 'Downloading the updated file — save it over your tracker file.';
    setTrackerStatus(
      'ok',
      'Row <b>' + report.rowIndex + '</b> added to <b>' + file.name + '</b> &rarr; sheet <b>' + targetSheet + '</b> — ' +
      (parts.length ? parts.join('; ') : 'all columns matched') + '. ' + where,
    );
  }

  function wire() {
    if (typeof document === 'undefined') return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', wire);
      return;
    }
    const fileEl = getEl('trackerFile');
    const btn = getEl('btnTracker');
    const sheetEl = getEl('trackerSheet');
    if (!fileEl || !btn) return;

    fileEl.addEventListener('change', async () => {
      const file = fileEl.files && fileEl.files[0];
      if (!file) {
        if (sheetEl) sheetEl.innerHTML = '';
        setTrackerStatus('', 'Select your tracker Excel file and press <b>Submit to Tracker</b>.');
        return;
      }
      try {
        const wb = await readWorkbook(file);
        fillSheetSelect(wb, false);
        const count = (wb.SheetNames || []).length;
        setTrackerStatus('ok', 'Loaded <b>' + file.name + '</b> (' + count + ' sheet' + (count === 1 ? '' : 's') + '). Choose the sheet, then press <b>Submit to Tracker</b>.');
      } catch (e) {
        setTrackerStatus('err', 'Could not read "' + file.name + '": ' + (e && e.message ? e.message : e));
      }
    });

    btn.addEventListener('click', submitFromForm);
  }
  wire();

  // Expose as a global in the browser (plain <script>) and as a CommonJS module
  // so the same file can be unit-tested with plain Node.
  const ITCTracker = { FIELD_DEFS, matchScore, matchColumns, appendRows, formatAmount, collectFormValues, submitFromForm, wire };
  if (typeof module !== 'undefined' && module.exports) module.exports = ITCTracker;
  else if (typeof window !== 'undefined') window.ITCTracker = ITCTracker;
})();

