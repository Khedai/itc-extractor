// Optional Vicidial call recording — one recording belongs to the application
// currently on screen, exactly like a captured signature.
//
// This module deliberately knows nothing about Vicidial credentials: it asks our
// own backend for the consultant's recordings and fetches the chosen MP3 through
// a signed link on that backend. Everything here sits OUTSIDE #formPage, so none
// of the chrome can be captured in the PDF — only the short status line in the
// form footer ("Call recording: attached / not provided") is part of the report.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const CONFIG = window.ITC_CONFIG || {};
  const REMEMBER_KEY = 'khusela-recording-consultant-v1';
  let selected = null;   // { blob, filename, row }
  let previewUrl = null;
  let rows = [];
  let busy = false;

  function base() {
    return String(CONFIG.signatureApiBase || '').replace(/\/+$/, '');
  }
  function enabled() { return !!base(); }

  function setStatus(text, kind) {
    const el = $('recordingStatus');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'recording-status' + (kind ? ' ' + kind : '');
  }

  // The footer line is inside the form, so it is captured in the PDF and printout.
  // It is deliberately plain text: an MP3 cannot be played from a PDF, but the
  // office can see at a glance whether voice evidence was supplied.
  function note() {
    const el = $('recordingPdfNote');
    if (el) el.textContent = selected ? ('attached — ' + selected.filename) : 'not provided';
  }

  function remember(v) { try { localStorage.setItem(REMEMBER_KEY, v); } catch (e) {} }
  function remembered() { try { return localStorage.getItem(REMEMBER_KEY) || ''; } catch (e) { return ''; } }

  function clear() {
    if (previewUrl) { try { URL.revokeObjectURL(previewUrl); } catch (e) {} }
    previewUrl = null;
    selected = null;
    rows = [];
    const list = $('recordingList');
    if (list) { list.innerHTML = ''; list.hidden = false; }
    const box = $('recordingSelected');
    if (box) box.hidden = true;
    const preview = $('recordingPreview');
    if (preview) preview.removeAttribute('src');
    // Back to the search state: no selection, the Find button available.
    const findBtn = $('btnFindRecordings');
    if (findBtn) findBtn.hidden = false;
    const changeBtn = $('btnChangeRecording');
    if (changeBtn) changeBtn.hidden = true;
    const clearBtn = $('btnClearRecording');
    if (clearBtn) clearBtn.hidden = true;
    note();
  }

  // Keep the rows, but go back to the list so another call can be chosen. The
  // previously attached file is released first, so only one ever remains.
  function change() {
    if (previewUrl) { try { URL.revokeObjectURL(previewUrl); } catch (e) {} }
    previewUrl = null;
    selected = null;
    const box = $('recordingSelected');
    if (box) box.hidden = true;
    const preview = $('recordingPreview');
    if (preview) preview.removeAttribute('src');
    const list = $('recordingList');
    if (list) list.hidden = false;
    const findBtn = $('btnFindRecordings');
    if (findBtn) findBtn.hidden = false;
    const changeBtn = $('btnChangeRecording');
    if (changeBtn) changeBtn.hidden = true;
    const clearBtn = $('btnClearRecording');
    if (clearBtn) clearBtn.hidden = true;
    note();
    setStatus('Choose another recording from the list, or press Find recordings to search again.');
  }

  function select(row, blob) {
    if (previewUrl) { try { URL.revokeObjectURL(previewUrl); } catch (e) {} }
    selected = { blob: blob, filename: row.filename || 'call-recording.mp3', row: row };
    previewUrl = URL.createObjectURL(blob);
    const box = $('recordingSelected');
    if (box) box.hidden = false;
    const name = $('recordingSelectedName');
    if (name) name.textContent = selected.filename + (row.start_time ? '  (' + row.start_time + ')' : '');
    const preview = $('recordingPreview');
    if (preview) preview.src = previewUrl;
    // The list collapses so only the chosen recording remains visible. Change
    // reopens it; Remove forgets it entirely.
    const list = $('recordingList');
    if (list) list.hidden = true;
    const findBtn = $('btnFindRecordings');
    if (findBtn) findBtn.hidden = true;
    const changeBtn = $('btnChangeRecording');
    if (changeBtn) changeBtn.hidden = false;
    const clearBtn = $('btnClearRecording');
    if (clearBtn) clearBtn.hidden = false;
    note();
    setStatus('Recording attached to this application. It will be sent with the PDF.', 'ok');
  }

  function render() {
    const list = $('recordingList');
    if (!list) return;
    list.innerHTML = '';
    rows.forEach((row) => {
      const item = document.createElement('div');
      item.className = 'recording-item';

      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = (row.start_time || 'time unknown') +
        '  ·  lead ' + (row.lead_id || '?') +
        (row.duration ? '  ·  ' + row.duration + 's' : '') +
        '\n' + (row.filename || '');
      meta.style.whiteSpace = 'pre-line';
      item.appendChild(meta);

      const audio = document.createElement('audio');
      audio.controls = true;
      audio.preload = 'none';
      if (row.audioUrl) audio.src = row.audioUrl;
      item.appendChild(audio);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn green';
      btn.textContent = 'Use this recording';
      btn.addEventListener('click', () => choose(row));
      item.appendChild(btn);

      list.appendChild(item);
    });
  }

  async function choose(row) {
    if (busy || !row.audioUrl) return;
    busy = true;
    setStatus('Downloading the recording…');
    try {
      const res = await fetch(row.audioUrl);
      if (!res.ok) throw new Error('the office server could not fetch it (HTTP ' + res.status + ')');
      const blob = await res.blob();
      if (!blob.size) throw new Error('the recording was empty');
      select(row, blob);
    } catch (e) {
      setStatus('Could not load that recording: ' + (e && e.message ? e.message : 'unknown error') + '. You can still submit without one.', 'err');
    } finally {
      busy = false;
    }
  }

  async function find() {
    if (busy) return;
    clear();
    const agent = String(($('recConsultant') && $('recConsultant').value) || '').trim();
    const date = String(($('recDate') && $('recDate').value) || '');
    if (!agent) { setStatus('Enter your Vicidial login first.', 'err'); return; }
    if (!date) { setStatus('Choose the call date first.', 'err'); return; }
    remember(agent);

    busy = true;
    setStatus('Looking up ' + agent + '\'s recordings for ' + date + '…');
    try {
      const url = base() + '/api/recordings?agent=' + encodeURIComponent(agent) + '&date=' + encodeURIComponent(date);
      const res = await fetch(url);
      let data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      if (!res.ok) {
        const reason = (data && data.error) || ('HTTP ' + res.status);
        throw new Error(reason);
      }
      rows = (data && data.rows) || [];
      render();
      setStatus(rows.length
        ? rows.length + ' recording(s) found. Preview one, then press "Use this recording".'
        : 'No recordings found for that login and date. Check the login and date, or submit without one.',
        rows.length ? 'ok' : '');
    } catch (e) {
      setStatus('Could not look up recordings: ' + (e && e.message ? e.message : 'unknown error') + '. You can still submit without one.', 'err');
    } finally {
      busy = false;
    }
  }

  function init() {
    const panel = $('recordingPanel');
    if (!panel) return;
    if (!enabled()) {
      // No office backend configured: the whole feature is hidden and the form
      // behaves exactly as it always has.
      panel.hidden = true;
      note();
      return;
    }
    panel.hidden = false;

    const options = $('recConsultantOptions');
    const people = Array.isArray(CONFIG.vicidialConsultants) ? CONFIG.vicidialConsultants : [];
    if (options) {
      people.forEach((p) => {
        const login = typeof p === 'string' ? p : (p && p.login);
        if (!login) return;
        const opt = document.createElement('option');
        opt.value = String(login);
        opt.label = (p && p.label) ? String(p.label) : String(login);
        options.appendChild(opt);
      });
    }

    const input = $('recConsultant');
    if (input) input.value = remembered();
    const dateEl = $('recDate');
    if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().split('T')[0];

    const findBtn = $('btnFindRecordings');
    if (findBtn) findBtn.addEventListener('click', find);
    const changeBtn = $('btnChangeRecording');
    if (changeBtn) changeBtn.addEventListener('click', change);
    const clearBtn = $('btnClearRecording');
    if (clearBtn) clearBtn.addEventListener('click', () => { clear(); setStatus('Recording removed. The email will say no call recording was attached.'); });
    if (input) input.addEventListener('change', remember);
    note();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // The attachment passed to js/email.js. null means "no recording", and the
  // office email will say so explicitly.
  window.ITCRecording = {
    init, find, change, clear, note, enabled,
    hasRecording: () => !!selected,
    getAttachment: () => selected ? { blob: selected.blob, filename: selected.filename } : null,
  };
})();
