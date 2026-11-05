// Email of the generated PDF. The app itself deliberately never downloads PDFs —
// drafts live only in the browser's localStorage, and the office's own copy is
// the report bucket on the backend, which stores every submission before it is
// emailed. So a report is never lost just because an email did not arrive, and
// there is no public download button to expose an applicant's data on a shared
// screen: the PDFs come out only through the backend's admin endpoints.
//
// ── Two transports, in this order ─────────────────────────────────────────
// 1. THE KHUSELA BACKEND — POST <signatureApiBase>/api/email, the service named
//    in js/config.js. It STORES the PDF in its report bucket first, then mails it
//    from the office's own mailbox (the recipient is the service's own setting,
//    so the request cannot name one) and answers with a real HTTP status, which
//    is what lets this file tell the truth about whether the application went:
//    emailed, backed-up-but-not-emailed (no mailbox: 503 email_not_configured +
//    stored:true), refused (502 + stored:true), or unreachable (nothing stored —
//    retry; the draft is still on this device). Used whenever signatureApiBase is
//    configured, and it is the ONLY path used then: there is no FormSubmit
//    fallback, because FormSubmit cannot confirm delivery and has been down
//    anyway.
// 2. FORMSUBMIT (https://formsubmit.co) — the original no-backend path, kept ONLY
//    for a deployment with no signatureApiBase configured. Its answer cannot be
//    read (see below) and on 2026-09-30 it answered every submission with a 500
//    — its own documentation page did too — while the app reported success, and
//    on 2026-11-05 it answered 522. A send through this path is never described
//    as delivered.
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
        finish({ ok: true, msg: 'Submitted. Please check with the office that it arrived.' });
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
  // Turn whatever the mail service said into a sentence a consultant can act on.
  // The raw text is kept for anyone reading the console, but it is not what the
  // screen shows: SMTP codes, HTTP statuses and connection errors are for whoever
  // fixes the service, and the consultant's next step is always the same — tell
  // the office, and try again.
  function plainReason(detail) {
    const s = String(detail || '');
    if (/timeout|timed out|did not respond|ETIMEDOUT|ENOTFOUND|ECONN/i.test(s)) {
      return 'the mail service did not respond.';
    }
    if (/auth|535|password|credential|unauthor/i.test(s)) {
      return 'the office\'s mail service would not accept its own sign-in details.';
    }
    if (/too large|attachment|413|exceed/i.test(s)) {
      return 'the PDF is larger than the mail service allows.';
    }
    if (/not configured|no mailbox|mailbox/i.test(s)) {
      return 'the office\'s mail service is not set up.';
    }
    return 'the mail service could not deliver it.';
  }

  // A plain fetch() with FormData, the opposite of the FormSubmit rule above: this
  // is a JSON-answering API, so the status is the whole point. The PDF arrives as
  // the multipart field "attachment"; everything else is descriptive. The backend
  // stores the PDF in its report bucket before emailing, so 503 (no mailbox) and
  // 502 (refused) both carry stored:true — the consultant is told the application
  // is safe rather than handed to a fallback service that cannot confirm delivery.
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
      // differently to whoever has to fix it. What it must NOT be is raw: the
      // consultant needs to know whether to wait, to tell the office, or to try
      // again, and "Connection timeout" or "5355.7.8" tells them none of that.
      let data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      const detail = (data && (data.error || data.message)) || ('the mail service answered with an error');

      if (res.ok) {
        // linkOnly is set when the delivery provider could not carry the file and
        // the office's email carries a secure download link instead. Do not tell
        // the consultant the PDF was attached when it was not.
        if (data && data.linkOnly) {
          return {
            ok: true,
            reason: 'sent',
            msg: 'Your application has been emailed to the Khusela office. The email carries a secure link to the completed PDF. Your draft is still saved in this browser.',
          };
        }
        return {
          ok: true,
          reason: 'sent',
          msg: 'Your application has been emailed to the Khusela office, with the completed PDF attached. Your draft is still saved in this browser.',
        };
      }
      if (res.status === 503) {
        // "email_not_configured": this service has no mailbox set up, so it could
        // not email anything — but it HAS stored the PDF in its report bucket
        // (stored:true). The consultant is told that, not handed to a fallback
        // service that cannot confirm delivery (and has been down anyway).
        return {
          ok: false,
          reason: 'stored_not_emailed',
          stored: !!(data && data.stored),
          msg: 'Your application has been saved to the office\'s report bucket, but no delivery service is set up on it yet, so it was not emailed. Tell the office to finish setting up email — they can download the PDF from the bucket meanwhile. Your draft is still saved in this browser.',
        };
      }
      if (res.status === 429) {
        return {
          ok: false,
          reason: 'rate_limited',
          msg: 'Too many applications have been emailed in a short time. Nothing was sent — wait a minute and press Submit & Email again. Your draft is still saved in this browser.',
        };
      }
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          reason: 'not_allowed',
          msg: 'The office\'s mail service would not accept this app. Nothing was sent — tell the office, because this app is not on their list of approved sites. Your draft is still saved in this browser.',
        };
      }
      // 400/413/500/502 and anything else: the service took the request and could
      // not deliver it. The PDF is still in the bucket (stored:true), so nothing
      // is lost, and the message says so rather than falling back to a service
      // that cannot confirm delivery.
      return {
        ok: false,
        reason: 'refused',
        stored: !!(data && data.stored),
        msg: 'The application was NOT emailed: ' + plainReason(detail) +
          ' It has been saved to the office\'s report bucket, so the office can still download it — tell the office, and press Submit & Email to retry. Your draft is still saved in this browser.',
      };
    } catch (e) {
      // No status at all: the service is unreachable, still waking up, or its
      // CORS answer never arrived (a refused origin looks like this too). There
      // is nothing to store when the service cannot be reached, so the only copy
      // is still on this device — say so, and ask for a retry.
      return {
        ok: false,
        reason: (e && e.name === 'AbortError') ? 'timeout' : 'unreachable',
        msg: 'Could not reach the office server, so the application was not sent or saved. Your draft is still saved in this browser — try again in a moment.',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // ── The send itself ───────────────────────────────────────────────────────
  // The backend first, and its answer is the whole story: it stores every
  // submission in its report bucket before emailing, so the message always says
  // what actually happened — emailed, backed up but not emailed, refused, or
  // unreachable. The old FormSubmit path is kept ONLY for a deployment with no
  // backend configured at all; it can never confirm delivery.
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
      return sendViaBackend(blob, filename, cfg, readApplicant());
    }

    return sendViaFormSubmit(blob, filename, cfg);
  }

  window.ITCEmail = { send, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_MB };
})();
