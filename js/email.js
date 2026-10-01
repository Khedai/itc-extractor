// Email of the generated PDF (the app intentionally never downloads PDFs —
// drafts live only in the browser's localStorage; see js/app.js).
//
// ── Two transports, in this order ─────────────────────────────────────────
// 1. THE KHUSELA BACKEND — POST <signatureApiBase>/api/email, the service named
//    in js/config.js. It mails the PDF from the office's own mailbox (the
//    recipient is the service's own setting, so the request cannot name one) and
//    answers with a real HTTP status, which is what lets this file tell the
//    truth about whether the application went. Used whenever signatureApiBase is
//    configured.
// 2. FORMSUBMIT (https://formsubmit.co) — the original no-backend path, kept as
//    the fallback for the states transport 1 cannot cover: no signatureApiBase,
//    the service answering 503 "email_not_configured" (its mailbox has not been
//    set up yet), or the service not answering at all (the free Render instance
//    sleeps after ~15 minutes idle). Every message from this path says which one
//    it was, because FormSubmit's answer cannot be read (see below) and on
//    2026-09-30 it answered every submission with a 500 — its own documentation
//    page did too — while the app reported success. That is why the backend path
//    exists; a send through the old path is never described as delivered.
//
// ── How FormSubmit behaves (important for the PDF to actually arrive) ──────
// 1. The FIRST submission to a new recipient address only sends that address a
//    one-time ACTIVATION / notification email. The recipient must click the
//    activation link inside it. Until then the PDF is NOT delivered.
// 2. After activation, every submission arrives with the PDF attached (the file
//    input MUST be named "attachment"). Total uploads must stay under 10 MB.
// 3. The "From" cannot be customised — emails come from FormSubmit's own
//    address. We set the applicant's address via "_replyto" / an "email" field
//    so replying to the notification goes straight back to the applicant.
//
// Transport (FormSubmit only): the PDF is posted by a REAL hidden <form> (in
// index.html: #emailForm → #emailFrame) with enctype="multipart/form-data" and
// a real file input named "attachment". FormSubmit keeps uploaded files only for
// a genuine form POST (a navigation) — a fetch()/XHR post is treated as AJAX: the
// email still arrives, but the PDF is silently dropped. Do NOT change this back
// to fetch() + FormData; that is exactly what lost the attachment before.
//
// Because the reply lands in a hidden cross-origin iframe, FormSubmit's answer
// page cannot be read. We can tell that FormSubmit replied (the frame navigates
// away from about:blank) but not whether it was the "Thanks" page or the
// "needs activation" page, so a message from this path claims only that the
// application was handed over — never that it arrived.
(function () {
  'use strict';

  // The backend's own ceiling (MAX_EMAIL_MB, 20 MB by default — see the service's
  // .env.example). It is the limit its /api/email route accepts a PDF at.
  const BACKEND_MAX_BYTES = 20 * 1024 * 1024;
  // FormSubmit hard limit for the sum of all uploaded files.
  const FORMSUBMIT_MAX_BYTES = 10 * 1024 * 1024;
  // Generous timeout: the PDF is a few MB and can take a while over mobile data.
  // It also has to outlast a sleeping Render instance waking up (up to a minute).
  const UPLOAD_TIMEOUT_MS = 120000;

  const backendBase = (cfg) => String((cfg && cfg.signatureApiBase) || '').replace(/\/+$/, '');

  // Which limit applies depends on which transport will carry the file, and the
  // backend allows twice what FormSubmit ever did. js/app.js reads this to decide
  // whether a smaller PDF has to be rendered, so it is decided here, from the same
  // config the send itself uses, rather than assumed.
  const MAX_ATTACHMENT_BYTES = backendBase(window.ITC_CONFIG) ? BACKEND_MAX_BYTES : FORMSUBMIT_MAX_BYTES;
  const MAX_ATTACHMENT_MB = Math.round(MAX_ATTACHMENT_BYTES / 1048576);

  function readApplicant() {
    const get = (id) => {
      const el = document.getElementById(id);
      return el ? String(el.value || '').trim() : '';
    };
    const name = [get('name'), get('surname')].filter(Boolean).join(' ');
    return {
      name: name,
      email: get('email'),
      id: get('id'),
      date: get('fDate'),
    };
  }

  // ── Transport 2: FormSubmit ───────────────────────────────────────────────
  // Reached only when the backend cannot carry the file (see send() below). Its
  // checks are its own, because its limits are: an empty PDF or a file:// page
  // would be a mistake on either path, and those are answered by send() before
  // either transport runs, but the size ceiling here is 10 MB, not 20.
  function sendViaFormSubmit(blob, filename, cfg) {
    return new Promise((resolve) => {
      const fail = (reason, msg) => resolve({ ok: false, reason: reason, msg: msg });

      if (!cfg || !cfg.recipientEmail) {
        return fail('not_configured', 'Email is not configured (set recipientEmail in js/config.js). Nothing was sent — your draft is still saved in this browser.');
      }
      if (blob.size > FORMSUBMIT_MAX_BYTES) {
        return fail('too_large', 'The PDF is ' + (blob.size / 1048576).toFixed(1) + ' MB — over the backup email service\'s 10 MB attachment limit. Nothing was sent; your draft is still saved in this browser.');
      }

      // One hidden <form> per submission: the PDF must travel as a real file on
      // a real form post — the only transport FormSubmit keeps the attachment
      // for (see the transport note at the top of this file).
      const form = document.getElementById('emailForm');
      const frame = document.getElementById('emailFrame');
      if (!form || !frame) {
        return fail('no_transport', 'The email form is missing from the page. Nothing was sent — your draft is still saved in this browser.');
      }

      // The generated PDF has to become a real File for the file input.
      let file = null;
      try {
        file = new File([blob], filename, { type: 'application/pdf' });
      } catch (e) {
        file = null;
      }
      if (!file) {
        return fail('no_file_api', 'This browser cannot build the PDF attachment. Nothing was sent — your draft is still saved in this browser. Open the app in a current version of Chrome, Edge or Safari and try again.');
      }

      form.innerHTML = '';
      form.action = 'https://formsubmit.co/' + encodeURIComponent(cfg.recipientEmail);
      form.method = 'POST';
      form.enctype = 'multipart/form-data';   // required — FormSubmit drops files without it
      form.target = frame.name || 'emailFrame';

      const add = (name, value) => {
        if (!value) return;
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value;
        form.appendChild(input);
      };

      add('_subject', cfg.subject || 'Khusela Credit Application - ITC report');
      add('_template', 'table');   // readable table layout in the email body
      add('_captcha', 'false');    // a send driven from JS cannot solve a reCAPTCHA
      add('_url', location.href);  // FormSubmit needs to know which page posted

      // Applicant details in the body make the notification email useful, and
      // the "email"/"_replyto" fields let the recipient reply straight to the
      // applicant (FormSubmit cannot customise "From").
      const applicant = readApplicant();
      if (applicant.email) {
        add('email', applicant.email);
        add('_replyto', applicant.email);
      }
      add('Applicant', applicant.name);
      add('ID Number', applicant.id);
      add('Date', applicant.date);

      // The attachment itself — the field MUST be named "attachment".
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.name = 'attachment';
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;   // programmatic .files is the only way to send a generated file
      } catch (e) {
        return fail('no_file_api', 'This browser cannot attach the PDF to the email. Nothing was sent — your draft is still saved in this browser. Open the app in a current version of Chrome, Edge or Safari and try again.');
      }
      form.appendChild(fileInput);

      let settled = false;
      let timer = null;

      const cleanup = () => {
        clearTimeout(timer);
        frame.removeEventListener('load', onLoad);
      };
      const finish = (result) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };

      // FormSubmit's answer page is cross-origin, so it cannot be read. A `load`
      // event whose document is no longer about:blank does prove that FormSubmit
      // answered the post — i.e. the upload finished.
      function onLoad() {
        try {
          if (frame.contentWindow.location.href === 'about:blank') return;
        } catch (e) { /* cross-origin — the answer page is here */ }
        finish({ ok: true, msg: 'Submitted through the backup email service (FormSubmit), which cannot confirm delivery.' });
      }

      timer = setTimeout(() => finish({
        ok: false,
        reason: 'timeout',
        msg: 'The upload to the email service did not finish in time — a few MB over mobile data can take a while. Your draft is still saved; check with the office before sending again.',
      }), UPLOAD_TIMEOUT_MS);

      frame.addEventListener('load', onLoad);
      form.submit();
    });
  }

  // ── Transport 1: the Khusela backend ──────────────────────────────────────
  // A plain fetch() with FormData, the opposite of the FormSubmit rule above: this
  // is a JSON-answering API, so the status is the whole point. The PDF arrives as
  // the multipart field "attachment"; everything else is descriptive. `fallback`
  // in the answer is what tells send() the old path may still be tried — it is set
  // only where the backend has said (or shown) that it cannot send at all, never
  // where it tried and failed.
  async function sendViaBackend(blob, filename, cfg, applicant) {
    const form = new FormData();
    form.append('attachment', blob, filename);
    if (applicant.name) form.append('applicant', applicant.name);
    if (applicant.id) form.append('idNumber', applicant.id);
    if (applicant.date) form.append('date', applicant.date);
    // Only the reply address: the service decides the recipient and ignores any
    // address a request names (a browser-callable route must not be a mail relay).
    if (applicant.email) form.append('replyTo', applicant.email);

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS) : null;
    try {
      const res = await fetch(backendBase(cfg) + '/api/email', {
        method: 'POST',
        body: form,
        signal: controller ? controller.signal : undefined,
      });
      // A refusal still carries a reason, and that reason is what the consultant
      // can act on — a wrong mailbox password and a rate limit read very
      // differently to whoever has to fix it.
      let data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      const detail = (data && (data.error || data.message)) || ('the mail service answered HTTP ' + res.status);

      if (res.ok) {
        return {
          ok: true,
          reason: 'sent',
          msg: 'Your application has been emailed to the Khusela office, with the completed PDF attached. Your draft is still saved in this browser.',
        };
      }
      if (res.status === 503) {
        // "email_not_configured": this service has no mailbox set up. It did not
        // try to send anything, which is exactly the case the old path is for.
        return { ok: false, fallback: true, why: 'is not set up yet', reason: 'no_mailbox' };
      }
      if (res.status === 429) {
        return {
          ok: false,
          reason: 'rate_limited',
          msg: detail + ' Nothing was sent — your draft is still saved in this browser.',
        };
      }
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          reason: 'not_allowed',
          msg: 'The office\'s mail service refused this app: ' + detail + ' Nothing was sent — tell the office, because this app is not on the list of sites that mail service accepts. Your draft is still saved in this browser.',
        };
      }
      // 400/413/500/502 and anything else: the service took the request and could
      // not deliver it. Falling back here would trade a message that says the
      // application did not go for one that cannot be read at all.
      return {
        ok: false,
        reason: 'refused',
        msg: 'The application was NOT emailed: ' + detail + ' Nothing was sent — check with the office before sending again, and press Submit & Email to retry. Your draft is still saved in this browser.',
      };
    } catch (e) {
      // No status at all: the service is unreachable, still waking up, or its
      // CORS answer never arrived (a refused origin looks like this too). The
      // older path is worth trying, and the message will say it was used.
      return {
        ok: false,
        fallback: true,
        why: (e && e.name === 'AbortError') ? 'did not answer in time' : 'could not be reached',
        reason: (e && e.name === 'AbortError') ? 'timeout' : 'unreachable',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // ── The send itself ───────────────────────────────────────────────────────
  // The backend first, the old path only for the states it cannot cover, and a
  // message that always says which of the two carried the application.
  async function send(blob, filename, cfg) {
    const fail = (reason, msg) => ({ ok: false, reason: reason, msg: msg });

    // Checked here rather than in either transport: both would fail the same way.
    if (!blob || !blob.size) {
      return fail('empty_pdf', 'The PDF could not be generated. Nothing was sent — your draft is still saved in this browser.');
    }
    if (location.protocol === 'file:') {
      return fail('file_protocol', 'This page is open directly from the disk (file://). Serve it over http:// or https:// — an email cannot be sent from a file:// page. Nothing was sent; your draft is still saved in this browser.');
    }
    if (blob.size > MAX_ATTACHMENT_BYTES) {
      return fail('too_large', 'The PDF is ' + (blob.size / 1048576).toFixed(1) + ' MB — over the ' + MAX_ATTACHMENT_MB + ' MB email attachment limit. Nothing was sent; your draft is still saved in this browser.');
    }

    if (backendBase(cfg)) {
      const res = await sendViaBackend(blob, filename, cfg, readApplicant());
      if (!res.fallback) return res;
      const res2 = await sendViaFormSubmit(blob, filename, cfg);
      if (!res2.ok) {
        // The one failure that needs explaining: the backup path has a smaller
        // ceiling, and app.js only re-rendered a smaller PDF against the limit
        // this file reported, which was the backend's.
        if (res2.reason === 'too_large') {
          return fail('too_large', 'The office\'s own mail service ' + res.why + ', and the backup email service only accepts ' + (FORMSUBMIT_MAX_BYTES / 1048576) + ' MB — this PDF is larger. Nothing was sent; your draft is still saved in this browser.');
        }
        return res2;
      }
      return {
        ok: true,
        reason: 'sent_backup',
        msg: 'The office\'s own mail service ' + res.why + ', so the application was handed to the backup email service (FormSubmit). That service cannot confirm delivery — please check with the office that it arrived. Your draft is still saved in this browser.',
      };
    }

    return sendViaFormSubmit(blob, filename, cfg);
  }

  window.ITCEmail = { send, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_MB };
})();
