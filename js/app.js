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
    totalInst: 'fTotalInst', totalDebt: 'fTotalDebt', totalArrears: 'fTotalArrears',
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
        a.balance != null ? za(a.balance) : '',
        a.instalment != null ? za(a.instalment) : '',
        a.reduced != null ? za(a.reduced) : '',
        a.arrears != null ? za(a.arrears) : '',
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
    setField('fTotalReduced', za(sum('reduced')));

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

  async function generatePdf() {
    return await window.ITCPdf.generate($('formPage'));
  }

  async function handleSubmit() {
    const btn = $('btnSubmit');
    btn.disabled = true;
    btn.textContent = 'Preparing PDF…';
    try {
      const blob = await generatePdf();
      const filename = makeFilename();
      const res = await window.ITCEmail.send(blob, filename, CONFIG);
      showResult(res.ok, res.msg);
    } catch (e) {
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

