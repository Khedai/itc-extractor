// App wiring — ITC extraction, loans table + live totals, name-based drafts,
// PDF export and email. The email SEND pipeline lives in js/email.js and is
// intentionally untouched; this module only feeds it the form it renders.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const CONFIG = window.ITC_CONFIG || {};

  // Autosaved draft — stored ONLY in this browser's localStorage. Never uploaded,
  // never stored on a server, never written to git, never downloadable. Cleared by "New Application".
  const DRAFT_KEY = 'khusela-itc-draft-v1';

  const za = (n) => Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (n) => 'R ' + za(n);

  // Notifications remove themselves: success/info after ~8s, errors after ~15s.
  let statusTimer = null;
  let resultTimer = null;
  let itcStatusDefault = '';

  function setStatus(type, text) {
    const el = $('itcStatus');
    clearTimeout(statusTimer);
    el.innerHTML = text;
    el.className = 'itc-status' + (type ? ' ' + type : '');
    if (type) {
      statusTimer = setTimeout(() => {
        el.className = 'itc-status';
        el.innerHTML = itcStatusDefault;
      }, type === 'err' ? 15000 : 8000);
    }
  }

  function showResult(ok, text) {
    const el = $('resultPanel');
    clearTimeout(resultTimer);
    el.className = 'result-panel show ' + (ok ? 'ok' : 'err');
    el.textContent = text;
    resultTimer = setTimeout(() => {
      el.className = 'result-panel';
      el.textContent = '';
    }, ok ? 8000 : 15000);
  }

  function hideResult() {
    clearTimeout(resultTimer);
    $('resultPanel').className = 'result-panel';
    $('resultPanel').textContent = '';
  }

  // Drop any stale tracker notification when the user starts a new workflow.
  function clearTrackerStatus() {
    if (window.ITCTracker && window.ITCTracker.clearStatus) window.ITCTracker.clearStatus();
  }

  // ── Sending overlay (PDF prep + email send) ──────────────────────────────
  const SEND_TIPS = [
    'This can take up to a minute on slower connections — keep this page open.',
    'Your draft is saved on this device. If anything fails you can simply press Submit & Email again.',
    'The recipient receives the completed form as a PDF attachment.',
  ];
  let sendTipTimer = null;

  function showSending(title, sub, hint) {
    $('sendTitle').textContent = title;
    $('sendSub').textContent = sub || '';
    $('sendHint').textContent = hint || '';
    $('sendOverlay').classList.add('show');
    $('sendOverlay').setAttribute('aria-hidden', 'false');
  }

  function startSendTips() {
    clearInterval(sendTipTimer);
    let i = 0;
    sendTipTimer = setInterval(() => {
      i = (i + 1) % SEND_TIPS.length;
      $('sendHint').textContent = SEND_TIPS[i];
    }, 4500);
  }

  function hideSending() {
    clearInterval(sendTipTimer);
    sendTipTimer = null;
    $('sendOverlay').classList.remove('show');
    $('sendOverlay').setAttribute('aria-hidden', 'true');
  }

  // ── Form fields — the original Khusela application uses name= fields ──────
  function qs(name) {
    return document.querySelector('[name="' + CSS.escape(name) + '"]');
  }
  function set(name, value) {
    const el = qs(name);
    if (el && value !== undefined) el.value = value || '';
  }
  function select(name, value) {
    const el = qs(name);
    if (!el || !value) return;
    const hit = Array.from(el.options).find(
      (o) => o.textContent.trim().toLowerCase() === String(value).trim().toLowerCase(),
    );
    if (hit) el.value = hit.value;
  }

  // ── Loans and accounts table (12 rows, exactly like the original) ────────
  const LOAN_TYPES = ['Unsecured', 'Home Loan', 'Vehicle Finance', 'Other'];

  function buildLoansRows() {
    const body = document.querySelector('#loans tbody');
    if (!body || body.children.length) return;
    for (let i = 1; i <= 12; i++) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="rowno">' + i + '</td>' +
        '<td><input name="creditor_' + i + '"></td>' +
        '<td><input name="acc_' + i + '"></td>' +
        '<td><input class="loan-balance money" name="balance_' + i + '" type="number" step="0.01"></td>' +
        '<td><input class="loan-current money" name="current_' + i + '" type="number" step="0.01"></td>' +
        '<td><input class="loan-reduced money" name="reduced_' + i + '" type="number" step="0.01" readonly></td>' +
        '<td><select class="loan-type" name="type_' + i + '">' +
        LOAN_TYPES.map((t) => '<option>' + t + '</option>').join('') +
        '</select></td>';
      body.appendChild(tr);
    }
  }

  function n(v) { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; }
  function reduction(type) {
    if (type === 'Home Loan') return 0.8;
    if (type === 'Vehicle Finance') return 0.7;
    return 0.5;
  }

  // Live totals: reduced instalments (80/70/50%), the three table totals, the
  // debit-order amount and the expense total — identical behaviour to the
  // original single-file app.
  function calc() {
    let b = 0, c = 0, r = 0;
    document.querySelectorAll('#loans tbody tr').forEach((tr) => {
      const bal = n(tr.querySelector('.loan-balance').value);
      const cur = n(tr.querySelector('.loan-current').value);
      const type = tr.querySelector('.loan-type').value;
      const reduced = cur * reduction(type);
      const reducedEl = tr.querySelector('.loan-reduced');
      if (reducedEl) reducedEl.value = cur ? reduced.toFixed(2) : '';
      b += bal; c += cur; r += reduced;
    });
    $('totalBalance').textContent = money(b);
    $('totalCurrent').textContent = money(c);
    $('totalReduced').textContent = money(r);
    const doa = $('debitOrderAmount');
    if (doa) doa.value = r ? money(r) : '';
    let e = 0;
    document.querySelectorAll('.expense').forEach((x) => { e += n(x.value); });
    const et = $('expenseTotal');
    if (et) et.value = e ? money(e) : '';
  }

  // ── Drafts (browser-local autosave) ──────────────────────────────────────
  // Serialise every editable form field by its name attribute (readonly review
  // values and the ITC upload/password controls are derived/chrome — excluded).
  function draftFields() {
    return Array.from(document.querySelectorAll('#formPage input, #formPage select, #formPage textarea'))
      .filter((el) => el.name && !el.readOnly && !el.closest('.itc-panel'));
  }

  function saveDraft() {
    try {
      const fields = {};
      draftFields().forEach((el) => {
        fields[el.name] = el.type === 'checkbox' ? el.checked : el.value;
      });
      localStorage.setItem(DRAFT_KEY, JSON.stringify(fields));
    } catch (e) { /* storage unavailable/full — drafts simply won't persist */ }
  }

  let draftTimer = null;
  function queueDraftSave() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 400);
  }

  function restoreDraft() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch (e) { data = null; }
    if (!data || typeof data !== 'object') return false;
    let applied = 0;
    draftFields().forEach((el) => {
      if (!(el.name in data)) return;
      if (el.type === 'checkbox') el.checked = !!data[el.name];
      else el.value = data[el.name] == null ? '' : String(data[el.name]);
      applied++;
    });
    if (!applied) { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} return false; }
    calc();
    return true;
  }

  // ── ITC extraction → form fill ───────────────────────────────────────────
  function fillAccounts(accounts) {
    const rows = document.querySelectorAll('#loans tbody tr');
    rows.forEach((tr, i) => {
      ['creditor', 'acc', 'balance', 'current', 'reduced'].forEach((k) => {
        const inp = tr.querySelector('[name="' + k + '_' + (i + 1) + '"]');
        if (inp) inp.value = '';
      });
    });
    accounts.forEach((a, i) => {
      const row = rows[i];
      if (!row) return;
      const put = (k, v) => {
        const inp = row.querySelector('[name="' + k + '_' + (i + 1) + '"]');
        if (inp) inp.value = v == null ? '' : v;
      };
      put('creditor', a.sub);
      put('acc', a.acct);
      put('balance', a.balance != null ? a.balance.toFixed(2) : '');
      put('current', a.instalment != null ? a.instalment.toFixed(2) : '');
      // reduced is recomputed by calc() from current × reduction(type)
      const typeSel = row.querySelector('[name="type_' + (i + 1) + '"]');
      if (typeSel && a.category) typeSel.value = a.category;
    });
  }

  function fillForm(d) {
    // Applicant fields (the original puts First + Second Name into Name)
    set('name', [d.first, d.second].filter(Boolean).join(' '));
    set('surname', d.surname);
    set('id', d.id);
    set('email', d.email);
    set('cell', d.cell);
    set('employer', d.employer);
    set('address', d.residential);
    select('marital_status', d.marital);

    // ITC report details — on-screen review only (never part of the emailed PDF)
    const views = [
      ['itcReportRefView', d.reportRef], ['itcSearchDateView', d.searchDate],
      ['itcSecondNameView', d.second], ['itcMaidenView', d.maiden],
      ['itcTitleView', d.title], ['itcGenderView', d.gender],
      ['itcBirthView', d.birth], ['itcHomeView', d.home],
      ['itcWorkView', d.work], ['itcPostalView', d.postal],
      ['itcScoreView', d.score], ['itcRiskView', d.risk],
      ['itcDebtReviewView', d.debtReview],
      ['itcTotalInstView', d.totalInst], ['itcTotalDebtView', d.totalDebt],
      ['itcTotalArrearsView', d.totalArrears],
    ];
    views.forEach(([id, v]) => {
      const el = $(id);
      if (el) el.value = (v === undefined || v === null) ? '' : String(v);
    });

    fillAccounts(d.accounts || []);

    if (!$('fDate').value) $('fDate').value = new Date().toISOString().split('T')[0];
    calc();
    saveDraft(); // programmatic fill — persist it now
  }

  async function handleExtract() {
    hideResult();
    clearTrackerStatus();

    const file = $('itcFile').files[0];
    if (!file) { setStatus('err', 'Please select the Datanamix ITC PDF first.'); return; }

    const btn = $('btnExtract');
    btn.disabled = true;
    btn.textContent = 'Extracting…';
    setStatus('', 'Decrypting and reading every page of the Datanamix report…');

    try {
      const d = await window.ITCExtractor.extract(file, $('itcPassword').value);
      fillForm(d);
      const cur = (d.accounts || []).reduce((s, a) => s + (a.instalment || 0), 0);
      const red = (d.accounts || []).reduce((s, a) => s + (a.reduced || 0), 0);
      setStatus(
        'ok',
        'ITC extracted — <b>' + d.pages + '</b> page(s) read, <b>' + (d.accounts || []).length +
        '</b> qualifying creditor account(s) imported. Current instalments R ' + za(cur) +
        '; Reduced instalments R ' + za(red) + '; Debit Order R ' + za(red) +
        '. R0 and insurance accounts excluded. Review it, then press <b>Submit &amp; Email</b>.',
      );
      showResult(true, 'ITC report extracted — the application form has been filled.');
    } catch (e) {
      setStatus('err', (e && e.message) ? e.message : 'The report could not be extracted.');
      if (e && e.code === 'PASSWORD_REQUIRED') $('itcPassword').focus();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Extract ITC Report';
    }
  }

  function makeFilename() {
    const cfg = window.ITC_CONFIG || {};
    const prefix = (cfg.fileNamePrefix || 'Khusela-Credit-Application').replace(/[^\w-]+/g, '-');
    return prefix + '-' + new Date().toISOString().split('T')[0] + '.pdf';
  }

  // FormSubmit's hard attachment limit is 10 MB (see js/email.js).
  const MAX_ATTACH_BYTES = (window.ITCEmail && window.ITCEmail.MAX_ATTACHMENT_BYTES) || 10 * 1024 * 1024;

  async function generatePdf(opts) {
    return await window.ITCPdf.generate($('formPage'), opts);
  }

  async function handleSubmit() {
    hideResult();
    clearTrackerStatus();
    const btn = $('btnSubmit');
    btn.disabled = true;
    btn.textContent = 'Preparing PDF…';
    showSending('Preparing your PDF…', 'Rendering the application form');
    try {
      let blob = await generatePdf();
      if (blob.size > MAX_ATTACH_BYTES) {
        btn.textContent = 'Compressing PDF…';
        showSending('Compressing your PDF…', 'Shrinking the file so it fits the email attachment limit');
        blob = await generatePdf({ scale: 1.4, quality: 0.65 });
        if (blob.size > MAX_ATTACH_BYTES) {
          hideSending();
          showResult(false, 'The PDF is ' + (blob.size / 1048576).toFixed(1) + ' MB — over the email service\'s 10 MB limit. Nothing was sent; your draft is still saved in this browser.');
          return;
        }
      }
      const filename = makeFilename();
      btn.textContent = 'Sending email…';
      showSending('Sending your email…', 'Uploading the PDF to the email service', SEND_TIPS[0]);
      startSendTips();
      const res = await window.ITCEmail.send(blob, filename, CONFIG);
      hideSending();
      showResult(res.ok, res.msg);
    } catch (e) {
      hideSending();
      showResult(false, 'Failed to generate the PDF: ' + (e && e.message ? e.message : e));
    } finally {
      btn.disabled = false;
      btn.textContent = '📧 Submit & Email';
    }
  }

  // ── New Application / Print / Save Draft ─────────────────────────────────
  const RESET_DEFAULTS = {
    application_type: 'Mediation',
    marital_status: 'Single',
    debt_review_status: 'Not Under Debt Review',
    account_type: 'Savings',
    dr_status: 'A',
  };

  function handleReset() {
    if (!window.confirm('Clear this application?')) return;
    document.querySelectorAll('#formPage input, #formPage textarea, #formPage select').forEach((el) => {
      if (el.type === 'checkbox') el.checked = false;
      else el.value = '';
    });
    Object.keys(RESET_DEFAULTS).forEach((name) => {
      const el = qs(name);
      if (el && el.tagName === 'SELECT') el.value = RESET_DEFAULTS[name];
    });
    $('itcFile').value = '';
    $('itcPassword').value = '';
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
    calc();
    setStatus('ok', 'Form and saved draft cleared. Upload a Datanamix ITC PDF to fill it automatically.');
    hideResult();
    clearTrackerStatus();
  }

  // Print — prints the current application form (toolbar/panels are hidden by
  // the print stylesheet), exactly like the original toolbar's Print button.
  function handlePrint() {
    window.print();
  }

  // Manual draft save — drafts are already autosaved as you type, but the
  // original toolbar had an explicit Save Draft button; keep it for parity.
  function handleSaveDraft() {
    saveDraft();
    alert('Draft saved on this device.');
  }

  // Wire up
  document.addEventListener('DOMContentLoaded', () => {
    itcStatusDefault = $('itcStatus').innerHTML;
    buildLoansRows();
    if (!$('fDate').value) $('fDate').value = new Date().toISOString().split('T')[0];

    document.addEventListener('input', calc);
    document.addEventListener('change', calc);

    $('btnExtract').addEventListener('click', handleExtract);
    $('btnSubmit').addEventListener('click', handleSubmit);
    $('btnReset').addEventListener('click', handleReset);
    $('btnPrint').addEventListener('click', handlePrint);
    $('btnSaveDraft').addEventListener('click', handleSaveDraft);
    $('itcPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleExtract(); });
    $('itcFile').addEventListener('change', clearTrackerStatus);

    // Draft autosave — every edit is persisted to this device only.
    $('formPage').addEventListener('input', queueDraftSave);
    $('formPage').addEventListener('change', queueDraftSave);

    calc();
    if (restoreDraft()) {
      setStatus('ok', 'Restored your autosaved draft (kept only on this device). Review it, then press <b>Submit &amp; Email</b>.');
    }
  });
})();
