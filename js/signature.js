// Remote signature requests — the design of the signature section (the two
// Applicant boxes and their labels) is unchanged; this module gives each box a
// purpose.
//
// The consultant works in the **Client Digital Signing** panel below the form,
// one per applicant: press "Generate Signing Link" and the app asks the Khusela
// signature backend for a secure one-time link, shows it and copies it. Then
// "Send via WhatsApp" opens WhatsApp to the number in that panel with the link
// pre-typed, "Send via Email" opens the consultant's own mail app with the link
// written and addressed to the client, and "Copy Link" is there for delivering it
// some other way (a second number, SMS, a call) or when the browser blocks the
// pop-up. Both sends are a redirect that the consultant completes with one press
// in WhatsApp or their mail app — neither sends anything by itself.
// The
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

  // Everything one panel is made of. The panel sits outside #formPage, so none of
  // it is ever in the PDF or the printed application, and none of it is part of
  // the autosaved draft — it is all rebuilt from the form on load.
  const ui = (n) => ({
    panel: $('signingPanel' + n),
    phone: $('sigPhone' + n),
    mail: $('sigMail' + n),
    link: $('sigLink' + n),
    gen: $('genSig' + n),
    copy: $('copySig' + n),
    whatsapp: $('waSig' + n),
    email: $('mailSig' + n),
  });

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
  // the client, so the consultant never types them twice. Slot 2 reads the
  // spouse fields (name-only inputs, so by name) and falls back to the main
  // applicant where a spouse value is empty.
  function fieldVal(idOrName) {
    const byId = $(idOrName);
    if (byId && typeof byId.value === 'string' && byId.value.trim()) {
      return byId.value.trim();
    }
    try {
      const byName = document.querySelector('[name="' + idOrName + '"]');
      if (byName && typeof byName.value === 'string') return String(byName.value).trim();
    } catch (e) { /* stub DOM in tests — fall through to empty */ }
    return byId ? String(byId.value || '').trim() : '';
  }

// wa.me needs digits only, international format without "+". South African
// mobiles arrive as 082… (extractor + hand-typed), +2782… or 2782… — all become
// 2782…. Anything else keeps its digits (00 prefix and "+" stripped) so
// non-SA numbers still work; returns '' when there is nothing sendable.
function normalizeZaPhone(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/^(00|\+)/, '');
  s = s.replace(/\D/g, '');
  if (!s) return '';
  if (/^0\d{9}$/.test(s)) return '27' + s.slice(1);
  return (s.length >= 10 && s.length <= 15) ? s : '';
}

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

function whatsappUrl(phoneDigits, text) {
  return 'https://wa.me/' + phoneDigits + '?text=' + encodeURIComponent(text);
}

// What is on the FORM, which is what the ITC extractor fills: slot 1 is the
// applicant's own Cell/Whatsapp, slot 2 the spouse's.
function formPhone(n) {
  if (n === 2) return fieldVal('spouse_cell') || fieldVal('spouse_whatsapp');
  return fieldVal('cell') || fieldVal('whatsapp');
}

function formEmail(n) {
  if (n === 2) return fieldVal('spouse_email');
  return fieldVal('email');
}

// What the panel will actually use: whatever the consultant typed in the panel,
// and otherwise the form's value (which prefill() copies in). A panel that is
// filled in by hand must win, because correcting a mistyped number there is the
// whole reason those boxes are editable.
function panelValue(box, fromForm) {
  const typed = box ? String(box.value || '').trim() : '';
  return typed || fromForm;
}

function clientDetails(n) {
  const val = (idOrName) => fieldVal(idOrName);
  const box = ui(n);
  const spouseName = [val('spouse_name'), val('spouse_surname')].filter(Boolean).join(' ');
  const mainName = [val('name'), val('surname')].filter(Boolean).join(' ');
  return {
    clientName: (n === 2 && spouseName) ? spouseName : mainName,
    idNumber: (n === 2 && val('spouse_id')) ? val('spouse_id') : val('id'),
    phone: panelValue(box.phone, formPhone(n)),
    email: panelValue(box.mail, formEmail(n)),
    address: val('address'),
    applicationRef: val('fAppRef'),
  };
}

// Copy the form's numbers into empty panel boxes — after an ITC extraction, and
// again whenever the app restores a draft. Only ever into an EMPTY box: a number
// the consultant corrected or typed for this applicant must survive the next
// extraction and the next reload.
function prefill(n) {
  const box = ui(n);
  if (!box.phone || !box.mail) return;
  if (!String(box.phone.value || '').trim()) box.phone.value = formPhone(n);
  if (!String(box.mail.value || '').trim()) box.mail.value = formEmail(n);
}

function prefillAll() {
  SLOTS.forEach((slot) => prefill(slot.n));
}

// ── Rendering ───────────────────────────────────────────────────────────
function setLink(n, link) {
  const box = ui(n).link;
  if (box) box.value = link || '';
}

// keepNote: the action that triggered this render has already written its own
// message ("Link created and copied…", "the link could not be emailed…") and that
// is the more useful line. Without this the status line below would overwrite it
// the instant it was written — which is exactly what happened before: generate()
// said what it had done and then immediately replaced that with "Waiting for the
// signature…", so the confirmation was never seen.
function render(n, keepNote) {
  const box = ui(n);
  const img = $('sigimg' + n);
  const sigbox = $('sigbox' + n);
  if (!box.panel || !box.gen || !box.copy || !box.whatsapp || !box.email) return;

  const s = state[n] || null;

  // Not configured: no signing requests can be made, so the panel has nothing to
  // offer and the form looks exactly like the original design.
  if (!enabled()) {
    box.panel.hidden = true;
    if (img) { img.removeAttribute('src'); img.hidden = true; }
    if (sigbox) sigbox.classList.remove('signed');
    note(n, '');
    return;
  }

  box.panel.hidden = false;
  const has = !!(s && s.signingLink);
  // Copy / WhatsApp / Email act on a link that exists; without one they are
  // hidden rather than left to fail when pressed.
  box.copy.hidden = !has;
  box.whatsapp.hidden = !has;
  box.email.hidden = !has;
  setLink(n, has ? s.signingLink : '');

  const shown = !!(img && img.getAttribute('src'));
  if (img) img.hidden = !shown;
  if (sigbox) sigbox.classList.toggle('signed', shown);

  [box.gen, box.copy, box.whatsapp, box.email].forEach((b) => { b.disabled = !!busy[n]; });
  if (keepNote) return;
  if (busy[n]) return;
  if (!s) { note(n, 'No signing link generated yet.'); return; }

  if (s.status === 'signed') {
    note(n, 'Signed' + (s.signedAt ? ' ' + new Date(s.signedAt).toLocaleString() : '') + '.', 'ok');
  } else if (s.status === 'expired') {
    note(n, 'This link expired before it was signed — generate a new one.', 'err');
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
    const box = ui(n);
    if (!enabled()) {
      note(n, 'Set signatureApiBase in js/config.js to send signing links.', 'err');
      return;
    }

    // Read what the panel holds NOW, not at the end: an invite stores the
    // address the link was created for, and the backend mails the link to that
    // stored address. An address corrected after generating would then be a
    // different one from the one the client already has — so a changed number
    // means a new link, which is what the note below says.
    const details = clientDetails(n);
    if (!details.clientName || !details.idNumber) {
      note(n, 'Enter the applicant Name, Surname and ID on the form first.', 'err');
      return;
    }
    // No email is demanded here: a link is still perfectly good to send over
    // WhatsApp, and making the consultant invent an address they do not have
    // would be the wrong reason to refuse. One is needed only at Send via Email.

    const btn = box.gen;
    const gen = generation;
    let stale = false;
    busy[n] = true;
    btn.disabled = true;
    render(n);
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

      note(n, 'Link created' + (copied ? ' and copied' : '') + ' — send it to ' +
        slot.label + ' with WhatsApp or email.', 'ok');
    } catch (e) {
      note(n, (e && e.message) || 'Could not create the signing link.', 'err');
    } finally {
      busy[n] = false;
      // keepNote: what was just said is the answer to what the consultant did.
      render(n, true);
      // render() has its say first, so this reads as the reason the box is empty.
      if (stale) {
        note(n, 'The application was sent before this link was created — generate a new link for the next applicant.', 'err');
      }
    }
  }

  async function copyLink(n) {
    const s = state[n];
    if (!s || !s.signingLink) return;
    setLink(n, s.signingLink);
    try {
      await navigator.clipboard.writeText(s.signingLink);
      note(n, 'Signing link copied.', 'ok');
    } catch (e) {
      // Clipboard blocked (older browser, or the page is not on https) — the link
      // is in the box above it, ready to be copied by hand.
      note(n, 'The link is in the box above — copy it from there.', 'err');
    }
  }

  // Send via WhatsApp: one click opens WhatsApp with the link already typed, and
  // the consultant presses Send there. Nothing leaves this device by itself —
  // the client still has to be sent the message deliberately.
  function sendWhatsApp(n) {
    const s = state[n];
    const box = ui(n);
    if (!s || !s.signingLink) {
      note(n, 'Generate a signing link first.', 'err');
      return;
    }
    const digits = normalizeZaPhone(clientDetails(n).phone);
    if (!digits) {
      note(n, 'Enter the client\'s cell or WhatsApp number in this panel first.', 'err');
      if (box.phone) box.phone.focus();
      return;
    }
    const who = clientDetails(n).clientName;
    const msg = 'Hi ' + (who || 'there') + ', please sign here: ' + s.signingLink;
    // A popup opened after an await can be blocked; the link is still in the box,
    // so that case is a message and not a failure.
    let opened = false;
    try {
      const w = window.open(whatsappUrl(digits, msg), '_blank');
      if (w) { try { w.opener = null; } catch (e) {} opened = true; }
    } catch (e) { opened = false; }
    note(n, opened
      ? 'WhatsApp opened with the link — press Send there.'
      : 'The browser blocked the WhatsApp window. Copy Link still works, or open wa.me/' + digits + ' yourself.', opened ? 'ok' : 'err');
  }

  // Send via Email: opens the consultant's own mail app with the link already
  // written, addressed to the client, and they press Send there.
  //
  // This is a redirect rather than a call to the signing service, and that is a
  // decision with a reason behind it: mailing it from a server needs that server
  // to have a working mailbox, and the only host this app talks to is on a free
  // Render instance, which blocks outbound SMTP and has no mailbox configured. A
  // mailto: needs neither — and it keeps the message in the consultant's own
  // sent folder, which is where a client's "I never got it" question can be
  // answered. Nothing is sent without the Send press.
  function sendEmail(n) {
    const s = state[n];
    const box = ui(n);
    if (!s || !s.signingLink) {
      note(n, 'Generate a signing link first.', 'err');
      return;
    }
    const addr = clientDetails(n).email;
    if (!EMAIL_RE.test(addr)) {
      note(n, 'Enter the client\'s email address in this panel first.', 'err');
      if (box.mail) box.mail.focus();
      return;
    }
    const who = clientDetails(n).clientName;
    const body = 'Hi ' + (who || 'there') + ',\n\n'
      + 'Please sign your Khusela credit application here — it only takes a moment:\n\n'
      + s.signingLink + '\n\n'
      + 'Open that link on your own device, draw your signature with your finger and press submit. '
      + 'You only sign once.\n\nThank you.';
    // cc/bcc stay empty: only the client is on this. A mail app that cannot open
    // a mailto: says so itself, and the link is still in the box above.
    const url = 'mailto:' + encodeURIComponent(addr)
      + '?subject=' + encodeURIComponent('Khusela: your signing link')
      + '&body=' + encodeURIComponent(body);
    // This one navigates the CURRENT tab rather than opening a new one, and that
    // is not a style choice: Chrome refuses to navigate a new tab to a mailto:
    // and leaves it sitting blank on about:blank, so window.open('mailto:…')
    // silently does nothing. Assigning location.href is the way the mail handler
    // is actually invoked. WhatsApp above keeps _blank, because that URL is
    // ordinary https and the consultant wants to come straight back to the form.
    let handed = false;
    try {
      window.location.href = url;
      handed = true;
    } catch (e) { handed = false; }
    note(n, handed
      ? 'Your email app should be opening with the link ready for ' + addr + ' — press Send there. '
        + 'Nothing appears? Use Copy Link and write to ' + addr + ' yourself.'
      : 'This browser would not open a mail app for a mailto: link. Use Copy Link, or write to ' + addr + ' yourself.',
      handed ? 'ok' : 'err');
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
      // The panel belongs to the application being cleared too: a link left in
      // its box is a link the next applicant could send, and the number in it is
      // this applicant's. Both are wiped, and prefill() puts the new applicant's
      // back in.
      const box = ui(slot.n);
      if (box.link) box.link.value = '';
      if (box.phone) box.phone.value = '';
      if (box.mail) box.mail.value = '';
    });
    renderAll();
    return forgotten;
  }

  function init() {
    if (!$('sigbox1')) return;

    load();

    SLOTS.forEach((slot) => {
      const box = ui(slot.n);
      if (box.gen) box.gen.addEventListener('click', () => generate(slot.n));
      if (box.copy) box.copy.addEventListener('click', () => copyLink(slot.n));
      if (box.whatsapp) box.whatsapp.addEventListener('click', () => sendWhatsApp(slot.n));
      if (box.email) box.email.addEventListener('click', () => sendEmail(slot.n));
    });
    prefillAll();
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

  // prefill is exported because js/app.js is what knows when the form has just
  // been filled — by an ITC extraction or by a restored draft — and a panel that
  // is empty should not sit there waiting to be typed into.
  window.ITCSignature = { init, clear, refreshAll, enabled, prefill: prefillAll };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
