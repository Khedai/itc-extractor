// Tracker export — "Submit to Tracker" / "Export Tracker", replicating the
// original single-file Khusela app:
//
//   • Submit to Tracker  validates Name + Surname + ID + Application Type,
//                        appends ONE 35-column row to a persistent on-device
//                        tracker (browser localStorage, key
//                        'khusela_sales_tracker_v1'), then downloads the whole
//                        tracker as an Excel-compatible CSV
//                        (Khusela_Sales_Tracker.csv).
//   • Export Tracker     re-downloads that CSV without adding a row.
//
// Columns are identical to the original tracker (including the OWN AMOUNT
// column, which stays empty — the form has no Own Amount field):
//   DATE, CONSULTANT, BRANCH, NAME, SURNAME, ID NUMBER, CELL, WHATSAPP, EMAIL,
//   SPOUSE NAME, SPOUSE SURNAME, SPOUSE ID, SPOUSE CELL, SPOUSE WHATSAPP,
//   SPOUSE EMAIL, ADDRESS, EMPLOYER, APPLICATION TYPE, DEBT REVIEW STATUS,
//   MARITAL STATUS, BANK, ACCOUNT NO, ACCOUNT TYPE, DR STATUS, GROSS SALARY,
//   NETT SALARY, SPOUSE SALARY, TOTAL BALANCE, CURRENT INSTALMENT, REDUCED
//   INSTALMENT, DEBIT ORDER DATE, DEBIT ORDER AMOUNT, OWN AMOUNT, TIME OF CALL,
//   EXT NUMBER.
//
// Values are read straight off the form's name= fields, so every column the
// form captures is filled (the original form field names are used verbatim).
// The pure core (row building + CSV serialisation) has no DOM dependency, so it
// is testable with plain Node (see tools/test_tracker_node.js).
(function () {
  'use strict';

  const TRACKER_KEY = 'khusela_sales_tracker_v1';
  const TRACKER_FILE = 'Khusela_Sales_Tracker.csv';

  const TRACKER_HEADERS = [
    'DATE', 'CONSULTANT', 'BRANCH', 'NAME', 'SURNAME', 'ID NUMBER',
    'CELL', 'WHATSAPP', 'EMAIL', 'SPOUSE NAME', 'SPOUSE SURNAME',
    'SPOUSE ID', 'SPOUSE CELL', 'SPOUSE WHATSAPP', 'SPOUSE EMAIL',
    'ADDRESS', 'EMPLOYER', 'APPLICATION TYPE', 'DEBT REVIEW STATUS',
    'MARITAL STATUS', 'BANK', 'ACCOUNT NO', 'ACCOUNT TYPE', 'DR STATUS',
    'GROSS SALARY', 'NETT SALARY', 'SPOUSE SALARY', 'TOTAL BALANCE',
    'CURRENT INSTALMENT', 'REDUCED INSTALMENT', 'DEBIT ORDER DATE',
    'DEBIT ORDER AMOUNT', 'OWN AMOUNT', 'TIME OF CALL', 'EXT NUMBER',
  ];

  // Tracker header -> source key in the plain-object passed to buildRow().
  const SOURCE_BY_HEADER = {
    'DATE': 'date', 'CONSULTANT': 'consultant', 'BRANCH': 'branch',
    'NAME': 'name', 'SURNAME': 'surname', 'ID NUMBER': 'id', 'CELL': 'cell',
    'WHATSAPP': 'whatsapp', 'EMAIL': 'email', 'SPOUSE NAME': 'spouse_name',
    'SPOUSE SURNAME': 'spouse_surname', 'SPOUSE ID': 'spouse_id',
    'SPOUSE CELL': 'spouse_cell', 'SPOUSE WHATSAPP': 'spouse_whatsapp',
    'SPOUSE EMAIL': 'spouse_email', 'ADDRESS': 'address', 'EMPLOYER': 'employer',
    'APPLICATION TYPE': 'application_type', 'DEBT REVIEW STATUS': 'debt_review_status',
    'MARITAL STATUS': 'marital_status', 'BANK': 'bank', 'ACCOUNT NO': 'account_no',
    'ACCOUNT TYPE': 'account_type', 'DR STATUS': 'dr_status',
    'GROSS SALARY': 'gross_salary', 'NETT SALARY': 'nett_salary',
    'SPOUSE SALARY': 'spouse_salary', 'TOTAL BALANCE': 'total_balance',
    'CURRENT INSTALMENT': 'current_instalment',
    'REDUCED INSTALMENT': 'reduced_instalment',
    'DEBIT ORDER DATE': 'debit_order_date', 'DEBIT ORDER AMOUNT': 'debit_order_amount',
    'OWN AMOUNT': 'own_amount', 'TIME OF CALL': 'call_time', 'EXT NUMBER': 'ext_number',
  };

  // ── Pure core (testable without a DOM) ───────────────────────────────────

  // Turn a plain sources object into a full tracker row keyed by the CSV
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

  function csvCell(v) {
    return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  }

  function toCsv(rows) {
    return TRACKER_HEADERS.join(',') + '\n' +
      (rows || []).map((r) => TRACKER_HEADERS.map((h) => csvCell(r[h])).join(',')).join('\n') +
      '\n';
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

  const elText = (id) => {
    if (typeof document === 'undefined') return '';
    const el = document.getElementById(id);
    return el && el.textContent ? el.textContent : '';
  };

  // "R 12 345,67" → "12 345,67" (mirrors the original, which stripped the R
  // off the totals before writing the tracker row).
  const stripRand = (s) => String(s || '').replace(/^R\s*/, '');

  // Every value the tracker knows, read from the form's name= fields exactly
  // as the original did. CONSULTANT and OWN AMOUNT have no field on this form
  // (the header has no consultant input and the form has no own-amount input),
  // so those cells are written empty.
  function collectSources() {
    return {
      date: val('date'),
      consultant: '',
      branch: val('branch'),
      name: val('name'),
      surname: val('surname'),
      id: val('id'),
      cell: val('cell'),
      whatsapp: val('whatsapp'),
      email: val('email'),
      spouse_name: val('spouse_name'),
      spouse_surname: val('spouse_surname'),
      spouse_id: val('spouse_id'),
      spouse_cell: val('spouse_cell'),
      spouse_whatsapp: val('spouse_whatsapp'),
      spouse_email: val('spouse_email'),
      address: val('address'),
      employer: val('employer'),
      application_type: val('application_type'),
      debt_review_status: val('debt_review_status'),
      marital_status: val('marital_status'),
      bank: val('bank'),
      account_no: val('account_no'),
      account_type: val('account_type'),
      dr_status: val('dr_status'),
      gross_salary: val('gross_salary'),
      nett_salary: val('nett_salary'),
      spouse_salary: val('spouse_salary'),
      total_balance: stripRand(elText('totalBalance')),
      current_instalment: stripRand(elText('totalCurrent')),
      reduced_instalment: stripRand(elText('totalReduced')),
      debit_order_date: val('debit_order_date'),
      debit_order_amount: val('debit_order_amount'),
      own_amount: '',
      call_time: val('call_time'),
      ext_number: val('ext_number'),
    };
  }

  // ── Browser actions ──────────────────────────────────────────────────────

  // Download the whole tracker CSV (no row is added). Returns true when a
  // download happened, false when the tracker is empty (mirrors the original,
  // which alerts in that case).
  function downloadCsv() {
    const rows = getTracker();
    if (!rows.length) {
      if (typeof alert === 'function') {
        alert('There are no submitted applications in the tracker yet.');
      }
      return false;
    }
    const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8;' });
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
    downloadCsv();
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
    downloadCsv();
    alert('Application submitted successfully and added to the Khusela Sales Tracker. The updated tracker has been downloaded as an Excel-compatible CSV file.');
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
    TRACKER_KEY, TRACKER_FILE, TRACKER_HEADERS, SOURCE_BY_HEADER,
    buildRow, csvCell, toCsv, getTracker, setTracker,
    collectSources, downloadCsv, submitFromForm, exportTracker, wire, clearStatus,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = ITCTracker;
  else if (typeof window !== 'undefined') window.ITCTracker = ITCTracker;
})();
