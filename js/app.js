// App wiring — extraction, form filling, PDF export, email + PWA helpers.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const CONFIG = window.ITC_CONFIG || {};

  // Autosaved draft — stored ONLY in this browser's localStorage. Never uploaded,
  // never stored on a server, never written to git, never downloadable. Cleared by "Reset Form".
  const DRAFT_KEY = 'khusela-itc-draft-v1';

  // parser key -> form field id (simple text fields)
  const FIELD_MAP = {
    reportRef: 'fReportRef', clientRef: 'fClientRef', searchDate: 'fSearchDate',
    score: 'fScore', risk: 'fRisk', scoreDate: 'fScoreDate', exceptionCode: 'fExceptionCode',
    debtReview: 'fDebtReview', homeAffairsVerification: 'fHomeVerification',
    homeAffairsDeceased: 'fHomeDeceased', judgements: 'fJudgements', defaults: 'fDefaults',
    adverse: 'fAdverse',
    first: 'fFirst', second: 'fSecond', surname: 'fSurname', maiden: 'fMaiden',
    id: 'fId', title: 'fTitle', gender: 'fGender', birth: 'fBirth',
    home: 'fHomeTel', work: 'fWorkTel', cell: 'fCell', email: 'fEmail',
    residential: 'fResidential', postal: 'fPostal', employer: 'fEmployer',
    marital: 'fMarital',
    activeAccounts: 'fActiveAccounts', goodStandingAccounts: 'fGoodStanding',
    arrearsAccounts: 'fArrearsAccounts', paidUpAccounts: 'fPaidUpAccounts',
  };

  const za = (n) => Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (n) => 'R ' + za(n);

  function setStatus(type, text) {
    const el = $('itcStatus');
    el.innerHTML = text;
    el.className = 'itc-status' + (type ? ' ' + type : '');
  }

  function showResult(ok, text) {
    const el = $('resultPanel');
    el.className = 'result-panel show ' + (ok ? 'ok' : 'err');
    el.textContent = text;
  }

  // ── Sending overlay (PDF prep + email send) ──────────────────────────────
  // The email upload can take up to a minute on slow connections; the overlay
  // keeps the user informed instead of leaving them staring at a greyed button.
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

  function setField(id, value) {
    const el = $(id);
    if (!el) return;
    el.value = value || '';
    if (value) el.classList.add('filled');
    else el.classList.remove('filled');
  }

  // ── Draft autosave (browser-local only) ─────────────────────────────
  function draftFields() {
    return Array.from(document.querySelectorAll('#formPage input, #formPage select, #formPage textarea'));
  }

  function saveDraft() {
    try {
      const fields = {};
      draftFields().forEach((el, i) => {
        const key = el.id || '__f' + i;
        fields[key] = {
          v: el.type === 'checkbox' ? el.checked : el.value,
          f: el.classList.contains('filled'),
        };
      });
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), fields }));
    } catch (e) { /* storage unavailable/full — drafts simply won't persist */ }
  }

  let draftTimer = null;
  function queueDraftSave() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 400);
  }

  function restoreDraft() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch (e) { raw = null; }
    if (!raw || !raw.fields) return false;
    draftFields().forEach((el, i) => {
      const item = raw.fields[el.id || '__f' + i];
      if (!item) return;
      if (el.type === 'checkbox') el.checked = !!item.v;
      else el.value = item.v == null ? '' : item.v;
      if (item.f) el.classList.add('filled');
    });
    return true;
  }

  function fillForm(d) {
    Object.keys(FIELD_MAP).forEach((key) => setField(FIELD_MAP[key], d[key]));
    setField('fPassport', d['Passport Number'] || '');

    // Creditor accounts → loans table
    const rows = $('loansBody').querySelectorAll('tr');
    rows.forEach((tr) => {
      tr.querySelectorAll('input').forEach((inp) => { inp.value = ''; inp.classList.remove('filled'); });
    });

    (d.accounts || []).forEach((a, i) => {
      if (i >= rows.length) return;
      const inputs = rows[i].querySelectorAll('input');
      const vals = [
        a.sub, a.acct,
        a.balance != null ? money(a.balance) : '',
        a.instalment != null ? money(a.instalment) : '',
        a.reduced != null ? money(a.reduced) : '',
        a.arrears != null ? money(a.arrears) : '',
        a.type, a.status,
      ];
      inputs.forEach((inp, j) => {
        if (vals[j]) { inp.value = vals[j]; inp.classList.add('filled'); }
      });
    });

    // Totals row + side totals
    const sum = (k) => (d.accounts || []).reduce((s, a) => s + (a[k] || 0), 0);
    $('totBalance').textContent = money(sum('balance'));
    $('totInstalment').textContent = money(sum('instalment'));
    $('totReduced').textContent = money(sum('reduced'));
    $('totArrears').textContent = money(sum('arrears'));

    setField('fTotalInst', d.totalInst ? money(d.totalInst) : (sum('instalment') ? money(sum('instalment')) : ''));
    setField('fTotalDebt', d.totalDebt ? money(d.totalDebt) : (sum('balance') ? money(sum('balance')) : ''));
    setField('fTotalArrears', d.totalArrears ? money(d.totalArrears) : (sum('arrears') ? money(sum('arrears')) : ''));
    setField('fTotalReduced', money(sum('reduced')));

    // Debit Order: Reduced Amount is the total of reduced column in Rands; Amount stays empty until manually filled
    setField('fReducedAmount', money(sum('reduced')));
    setField('fDebitAmount', '');

    if (!$('fDate').value) $('fDate').value = new Date().toISOString().split('T')[0];

    saveDraft(); // extraction sets values programmatically — persist them now
  }

  async function handleExtract() {
    const file = $('itcFile').files[0];
    if (!file) { setStatus('err', 'Please select a Datanamix ITC PDF first.'); return; }

    const btn = $('btnExtract');
    btn.disabled = true;
    btn.textContent = 'Extracting…';
    setStatus('', 'Reading every page of the report…');

    try {
      const d = await window.ITCExtractor.extract(file, $('itcPassword').value);
      fillForm(d);
      setStatus('ok', 'Extracted <b>' + d.pages + '</b> pages — <b>' + (d.accounts || []).length + '</b> qualifying account(s). The form has been filled. Review it, then press <b>Submit &amp; Email</b>.');
      showResult(true, 'ITC report extracted. Fields highlighted in green were filled automatically.');
    } catch (e) {
      setStatus('err', (e && e.message) ? e.message : 'Failed to extract the ITC data.');
      if (e && e.code === 'PASSWORD_REQUIRED') $('itcPassword').focus();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Extract & Fill Form';
    }
  }

  function makeFilename() {
    const cfg = window.ITC_CONFIG || {};
    const prefix = (cfg.fileNamePrefix || 'Khusela-Credit-Application').replace(/[^\w-]+/g, '-');
    return prefix + '-' + new Date().toISOString().split('T')[0] + '.pdf';
  }

  // FormSubmit's hard attachment limit is 10 MB (see js/email.js); keep the
  // check in sync with it so a too-large PDF is re-rendered smaller, not dropped.
  const MAX_ATTACH_BYTES = (window.ITCEmail && window.ITCEmail.MAX_ATTACHMENT_BYTES) || 10 * 1024 * 1024;

  async function generatePdf(opts) {
    return await window.ITCPdf.generate($('formPage'), opts);
  }

  async function handleSubmit() {
    const btn = $('btnSubmit');
    btn.disabled = true;
    btn.textContent = 'Preparing PDF…';
    showSending('Preparing your PDF…', 'Rendering the application form');
    try {
      let blob = await generatePdf();

      // The rendered form is normally well under 10 MB, but if it ever exceeds
      // FormSubmit's limit, re-render at a lower resolution/quality instead of
      // failing — a credit-application form still reads fine at that size.
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
      btn.textContent = 'Submit & Email';
    }
  }

  function handleReset() {
    if (!window.confirm('Reset the form? All extracted and manually entered data — including the saved draft — will be cleared.')) return;
    document.querySelectorAll('#formPage input, #formPage textarea, #formPage select').forEach((el) => {
      if (el.type === 'checkbox') el.checked = false;
      else el.value = '';
      el.classList.remove('filled');
    });
    $('itcFile').value = '';
    $('itcPassword').value = '';
    $('totBalance').textContent = '';
    $('totInstalment').textContent = '';
    $('totReduced').textContent = '';
    $('totArrears').textContent = '';
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
    setStatus('', 'Form and saved draft cleared. Upload a Datanamix ITC PDF to fill it automatically.');
    $('resultPanel').className = 'result-panel';
  }

  // Wire up
  document.addEventListener('DOMContentLoaded', () => {
    if (!$('fDate').value) $('fDate').value = new Date().toISOString().split('T')[0];
    $('btnExtract').addEventListener('click', handleExtract);
    $('btnSubmit').addEventListener('click', handleSubmit);
    $('btnReset').addEventListener('click', handleReset);
    $('itcPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleExtract(); });

    // Draft autosave — every edit is persisted to this device only.
    $('formPage').addEventListener('input', queueDraftSave);
    $('formPage').addEventListener('change', queueDraftSave);
    if (restoreDraft()) {
      setStatus('ok', 'Restored your autosaved draft (kept only on this device). Review it, then press <b>Submit &amp; Email</b>.');
    }
  });
})();

