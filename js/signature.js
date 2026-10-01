// Remote signature requests — the design of the signature section (the two
// Applicant boxes and their labels) is unchanged; this module gives each box a
// purpose.
//
// The consultant presses "Send Signing Link": the app asks the Khusela
// signature backend for a secure one-time link, copies it, and the consultant
// sends it to the applicant however they prefer (WhatsApp, SMS, e-mail). The
// client opens it on their own device, signs, and the backend stores the
// signature. This module then finds the captured signature and shows it inside
// the applicant's box, so it is included in the PDF and the e-mail that follows.
//
// Two tokens come back from POST /api/invite, and they are deliberately
// different capabilities:
//   • signingLink — goes to the client; one-time and expiring.
//   • manageToken — stays on this device; used to poll the status and download
//                   the captured signature. It is never sent to the client, so
//                   the client's own link cannot be used to read the signature.
//
// Configure signatureApiBase in js/config.js (see README). While it is empty
// the buttons stay hidden and the section looks exactly like the original form.
//
// Backend: ../khusela-digital-signature-backend/khusela-backend (Express +
// SQLite) — POST /api/invite, GET /api/manage/:token,
// GET /api/manage/:token/signature.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // Pending requests live on this device only, exactly like the draft: nothing
  // about the applicant is stored anywhere except the signature backend.
  const STORE_KEY = 'khusela-itc-signatures-v1';
  // The client may sign at any time, so the status is polled in the background.
  const POLL_MS = 20000;
  // A request that never answers must not freeze the submit path (refreshAll).
  const REQUEST_TIMEOUT_MS = 12000;
  // The backend's free plan sleeps after about 15 minutes idle and can take a
  // minute to wake, which is longer than a click can afford to wait. A read may
  // be repeated, so the service is woken with one before the first write of a
  // session; the write itself is sent exactly once, because a repeated invite
  // would leave a second invitation behind that nobody ever saw.
  const WAKE_TIMEOUT_MS = 75000;

  const SLOTS = [
    { n: 1, label: 'Applicant 1' },
    { n: 2, label: 'Applicant 2' },
  ];

  const cfg = () => window.ITC_CONFIG || {};
  const base = () => String(cfg().signatureApiBase || '').replace(/\/+$/, '');
  const enabled = () => !!base();

  // n → { invitationId, manageToken, signingLink, expiresAt, status, signedAt }
  let state = {};
  let pollTimer = null;
  const busy = {};
  // Bumped by clear(). A request that comes back after the application it was made
  // for has been sent (or cleared) must not write itself into the fresh form: the
  // free instance can be asleep, so an invitation can still be in flight more than a
  // minute later, when the consultant has long since pressed Submit & Email.
  let generation = 0;

  // ── Local persistence ────────────────────────────────────────────────────
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY));
      state = (raw && typeof raw === 'object' && raw !== null) ? raw : {};
    } catch (e) { state = {}; }
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) { /* storage full/unavailable — the request still works, it just won't survive a reload */ }
  }

  // ── HTTP ────────────────────────────────────────────────────────────────
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Could not read the signature image.'));
      reader.readAsDataURL(blob);
    });
  }

  // One attempt, with its own deadline: kept separate so the wait for a sleeping
  // service can differ from the wait for a normal reply.
  async function once(pathname, opts, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(base() + pathname, Object.assign({ signal: controller.signal }, opts || {}));
      let data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      if (!res.ok) {
        throw new Error((data && data.error) || ('The signature service replied with ' + res.status + '.'));
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  // Set once this session has heard from the service, which means it is awake.
  let awake = false;

  // The first request of the session is what wakes a sleeping instance, so ask
  // /health and let it wait. It is a plain read: repeating it costs nothing, and a
  // failure here is not reported because the caller's own request says what is
  // wrong with the address or the connection. On a slow wake the caller is told,
  // so a box that sits quiet for a minute explains itself.
  async function wake(onSlow) {
    if (awake || !enabled()) return;
    const slow = setTimeout(() => { if (onSlow) onSlow(); }, 3000);
    try {
      await once('/health', { method: 'GET' }, WAKE_TIMEOUT_MS);
      awake = true;
    } catch (e) {
      // Left asleep: whatever is wrong, the request that follows will report it.
    } finally {
      clearTimeout(slow);
    }
  }

  async function api(pathname, opts, onSlow) {
    // A read can simply be tried again by the caller, so only a write needs the
    // service awake beforehand.
    if (String((opts || {}).method || 'GET').toUpperCase() !== 'GET') await wake(onSlow);
    try {
      const data = await once(pathname, opts, REQUEST_TIMEOUT_MS);
      awake = true;
      return data;
    } catch (e) {
      if (e && e.name === 'AbortError') {
        throw new Error('The signature service did not respond — check the connection, then try again.');
      }
      if (e instanceof TypeError) {
        throw new Error('Could not reach the signature service. Check signatureApiBase in js/config.js.');
      }
      throw e;
    }
  }

  // ── Notification line under each box ────────────────────────────────────
  function note(n, text, kind) {
    const el = $('sigNote' + n);
    if (!el) return;
    el.textContent = text || '';
    el.className = 'sig-note' + (kind ? ' ' + kind : '');
  }

  // The applicant details already on the form are what the signing page shows
  // the client, so the consultant never types them twice.
  function clientDetails() {
    const get = (id) => {
      const el = $(id);
      return el ? String(el.value || '').trim() : '';
    };
    return {
      clientName: [get('name'), get('surname')].filter(Boolean).join(' '),
      idNumber: get('id'),
      phone: get('cell') || get('whatsapp'),
      email: get('email'),
      address: get('address'),
      applicationRef: get('fAppRef'),
    };
  }

  // ── Rendering ───────────────────────────────────────────────────────────
  function render(n) {
    const sendBtn = $('sigSend' + n);
    const copyBtn = $('sigCopy' + n);
    const img = $('sigimg' + n);
    const box = $('sigbox' + n);
    if (!sendBtn || !copyBtn) return;

    // Not configured: leave the section exactly as the original design.
    if (!enabled()) {
      sendBtn.hidden = true;
      copyBtn.hidden = true;
      if (img) { img.removeAttribute('src'); img.hidden = true; }
      if (box) box.classList.remove('signed');
      note(n, '');
      return;
    }

    sendBtn.hidden = false;
    const s = state[n] || null;
    copyBtn.hidden = !(s && s.signingLink);

    const shown = !!(img && img.getAttribute('src'));
    if (img) img.hidden = !shown;
    if (box) box.classList.toggle('signed', shown);

    if (busy[n]) return;
    if (!s) { note(n, 'No signing link sent yet.'); return; }

    if (s.status === 'signed') {
      note(n, 'Signed' + (s.signedAt ? ' ' + new Date(s.signedAt).toLocaleString() : '') + '.', 'ok');
    } else if (s.status === 'expired') {
      note(n, 'This link expired before it was signed — send a new one.', 'err');
    } else {
      note(n, 'Waiting for the signature… link expires ' +
        (s.expiresAt ? new Date(s.expiresAt).toLocaleDateString() : 'soon') + '.');
    }
  }

  function renderAll() {
    SLOTS.forEach((slot) => render(slot.n));
  }

  // ── Actions ─────────────────────────────────────────────────────────────
  async function generate(n) {
    const slot = SLOTS.find((s) => s.n === n);
    if (!enabled()) {
      note(n, 'Set signatureApiBase in js/config.js to send signing links.', 'err');
      return;
    }

    const details = clientDetails();
    if (!details.clientName || !details.idNumber) {
      note(n, 'Enter the applicant Name, Surname and ID on the form first.', 'err');
      return;
    }

    const btn = $('sigSend' + n);
    const gen = generation;
    let stale = false;
    busy[n] = true;
    btn.disabled = true;
    note(n, 'Creating the secure signing link…');
    try {
      const d = await api('/api/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({}, details, { signerLabel: slot.label })),
      }, () => {
        // The first click after a quiet spell may have to wake a sleeping instance.
        note(n, 'Waking the signing service — this can take up to a minute…');
      });

      // The application this link was asked for can be sent (or cleared) while the
      // request is in flight — see `generation`. Recording it afterwards would hand
      // the previous applicant's link, and later their signature, to the next one.
      if (gen !== generation) { stale = true; return; }

      state[n] = {
        invitationId: d.invitationId,
        manageToken: d.manageToken,
        signingLink: d.signingLink,
        expiresAt: d.expiresAt,
        status: 'pending',
        signedAt: null,
      };
      save();

      // The box belongs to the new link — drop anything a previous link captured.
      const img = $('sigimg' + n);
      if (img) { img.removeAttribute('src'); img.hidden = true; }

      let copied = false;
      try {
        await navigator.clipboard.writeText(d.signingLink);
        copied = true;
      } catch (e) { copied = false; }
      note(n, copied
        ? 'Link created and copied — send it to ' + slot.label + '.'
        : 'Link created — use Copy Link to send it to ' + slot.label + '.', 'ok');
    } catch (e) {
      note(n, (e && e.message) || 'Could not create the signing link.', 'err');
    } finally {
      busy[n] = false;
      btn.disabled = false;
      render(n);
      // render() has its say first, so this reads as the reason the box is empty.
      if (stale) {
        note(n, 'The application was sent before this link was created — send a new link for the next applicant.', 'err');
      }
    }
  }

  async function copyLink(n) {
    const s = state[n];
    if (!s || !s.signingLink) return;
    try {
      await navigator.clipboard.writeText(s.signingLink);
      note(n, 'Signing link copied.', 'ok');
    } catch (e) {
      // Clipboard blocked (older browser, or the page is not on https) — show the
      // link so it can still be copied by hand.
      note(n, s.signingLink);
    }
  }

  // Download the captured signature once, then show it inside the applicant's box.
  async function loadImage(n) {
    const s = state[n];
    const img = $('sigimg' + n);
    if (!s || !s.manageToken || !img || img.getAttribute('src')) return;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let res;
      try {
        res = await fetch(
          base() + '/api/manage/' + encodeURIComponent(s.manageToken) + '/signature',
          { signal: controller.signal },
        );
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) return;
      // A data URL keeps the image inside the render, so the PDF never depends
      // on a cross-origin request being allowed at print time.
      const dataUrl = await blobToDataUrl(await res.blob());
      // The box may no longer belong to this request: the application was cleared
      // (sent, or New Application) or a new link was created for the same slot while
      // the image was downloading. Painting here would put a forgotten signature back
      // into the box, and from there into the next applicant's PDF.
      if (state[n] !== s) return;
      img.src = dataUrl;
      render(n);
    } catch (e) { /* the box simply stays empty; the status still reports "Signed" */ }
  }

  // ── Status polling ──────────────────────────────────────────────────────
  async function refresh(n, silent) {
    const s = state[n];
    if (!s || !s.manageToken) return;
    try {
      const d = await api('/api/manage/' + encodeURIComponent(s.manageToken));
      s.status = d.status;
      s.signedAt = d.signedAt;
      s.expiresAt = d.expiresAt || s.expiresAt;
      save();
    } catch (e) {
      if (!silent) note(n, (e && e.message) || 'Could not check the signing status.', 'err');
      return;
    }
    if (s.status === 'signed') await loadImage(n);
    render(n);
  }

  // Called before the PDF is rendered so a signature captured since the last
  // poll is included. Never throws — an application must stay sendable even
  // when the signature service is unreachable.
  async function refreshAll() {
    if (!enabled()) return;
    await Promise.all(SLOTS.map((slot) => (state[slot.n] ? refresh(slot.n, true) : null)));
  }

  // "New Application" — and, from js/app.js, a send that
  // actually happened — forgets every request held on this device: nothing captured
  // for a finished application may reappear in the next applicant's boxes. Returns
  // how many were forgotten, so a caller can say so instead of the box going quiet.
  function clear() {
    const forgotten = Object.keys(state).length;
    generation++;
    state = {};
    SLOTS.forEach((slot) => { delete busy[slot.n]; });
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    SLOTS.forEach((slot) => {
      const img = $('sigimg' + slot.n);
      if (img) { img.removeAttribute('src'); img.hidden = true; }
    });
    renderAll();
    return forgotten;
  }

  function init() {
    if (!$('sigbox1')) return;

    load();

    SLOTS.forEach((slot) => {
      const send = $('sigSend' + slot.n);
      const copy = $('sigCopy' + slot.n);
      if (send) send.addEventListener('click', () => generate(slot.n));
      if (copy) copy.addEventListener('click', () => copyLink(slot.n));
    });
    renderAll();

    if (!enabled()) return;

    // Pick up requests made in an earlier session — the client may well have
    // signed after this page was closed.
    SLOTS.forEach((slot) => { if (state[slot.n]) refresh(slot.n, true); });

    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      SLOTS.forEach((slot) => {
        const s = state[slot.n];
        if (s && s.status !== 'signed') refresh(slot.n, true);
      });
    }, POLL_MS);
  }

  window.ITCSignature = { init, clear, refreshAll, enabled };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
