// Email of the generated PDF. The browser never hands the PDF to a form-to-email
// service: it POSTs it to the Khusela backend named by signatureApiBase, which
// stores it in the report bucket before trying any delivery and then answers with
// a real HTTP status. That status is the only thing this file uses to decide what
// to tell the consultant.
//
// The old hidden-iframe path to FormSubmit is gone. It could not read the
// provider's response, so a 500/522 looked exactly like a success, and the first
// send to a new recipient only produced an activation email. If the backend is
// not configured, this file refuses the send and says so; it never falls back to
// a service that cannot confirm delivery.
//
// The recipient is NOT in this file or in the request: the backend owns it
// (MAIL_TO), so a copied request cannot be used to mail anyone else.
(function () {
  'use strict';

  // The backend accepts up to MAX_EMAIL_MB (20 MB by default — see the service's
  // .env.example). js/app.js reads this to decide whether a smaller PDF has to be
  // rendered before sending.
  const BACKEND_MAX_BYTES = 20 * 1024 * 1024;
  // Generous timeout: the PDF is a few MB and can take a while over mobile data.
  // It also has to outlast a sleeping Render instance waking up (up to a minute).
  const UPLOAD_TIMEOUT_MS = 120000;

  const backendBase = (cfg) => String((cfg && cfg.signatureApiBase) || '').replace(/\/+$/, '');

  // The backend's ceiling is the only one that applies now. js/app.js reads this
  // to decide whether a smaller PDF has to be rendered, so the number and the
  // wording live in one place.
  const MAX_ATTACHMENT_BYTES = BACKEND_MAX_BYTES;
  const MAX_ATTACHMENT_MB = Math.round(MAX_ATTACHMENT_BYTES / 1048576);

  // Which applicant boxes actually hold a signature image. The PDF carries the
  // images; this label lets the office/report bucket say which signer they belong
  // to, which is what makes a backed-up report easy to identify later.
  function signedLabels() {
    const labels = [];
    [1, 2].forEach((n) => {
      const img = document.getElementById('sigimg' + n);
      if (img && typeof img.getAttribute === 'function' && img.getAttribute('src')) {
        labels.push('Applicant ' + n);
      }
    });
    return labels.join(', ');
  }

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
      signerLabel: signedLabels(),
      date: get('fDate'),
    };
  }

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

  // A plain fetch() with FormData: this is a JSON-answering API, so the status is
  // the whole point. The PDF arrives as the multipart field "attachment";
  // everything else is descriptive. The backend stores the PDF in its report
  // bucket before emailing, so 503 (no mailbox) and 502 (refused) both carry
  // stored:true — the consultant is told the application is safe rather than
  // handed to a service that cannot confirm delivery.
  async function sendViaBackend(blob, filename, cfg, applicant, recording) {
    const form = new FormData();
    form.append('attachment', blob, filename);
    if (applicant.name) form.append('applicant', applicant.name);
    if (applicant.id) form.append('idNumber', applicant.id);
    if (applicant.signerLabel) form.append('signerLabel', applicant.signerLabel);
    if (applicant.date) form.append('date', applicant.date);
    // Only the reply address: the service decides the recipient and ignores any
    // address a request names (a browser-callable route must not be a mail relay).
    if (applicant.email) form.append('replyTo', applicant.email);
    // Optional voice evidence. The backend stores it on the SAME submission as
    // the PDF and either attaches it to the office email or sends a signed link
    // when the message would be too large. It is never a separate record.
    if (recording && recording.blob && recording.blob.size) {
      form.append('recording', recording.blob, recording.filename || 'call-recording.mp3');
      form.append('recordingName', recording.filename || 'call-recording.mp3');
    }

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
      const detail = (data && (data.error || data.message)) || 'the mail service answered with an error';
      const stored = !!(data && data.stored);

      if (res.ok) {
        // linkOnly is set when the delivery provider could not carry the file and
        // the office's email carries a secure download link instead. Do not tell
        // the consultant the PDF was attached when it was not.
        const recLine = recording
          ? (data && data.recordingLinkOnly
            ? ' The call recording is included as a secure link.'
            : ' The call recording is attached as well.')
          : ' No call recording was supplied with this application.';
        if (data && data.linkOnly) {
          return {
            ok: true,
            reason: 'sent',
            msg: 'Your application has been emailed to the Khusela office. The email carries a secure link to the completed PDF.' + recLine + ' Your draft is still saved in this browser.',
          };
        }
        return {
          ok: true,
          reason: 'sent',
          msg: 'Your application has been emailed to the Khusela office, with the completed PDF attached.' + recLine + ' Your draft is still saved in this browser.',
        };
      }
      if (res.status === 503) {
        // "email_not_configured": this service has no delivery path set up, so it
        // could not email anything — but it stores the PDF before that check, so
        // stored:true means the application is in the report bucket. Say exactly
        // which of those happened; never claim it was emailed.
        return {
          ok: false,
          reason: 'stored_not_emailed',
          stored: stored,
          msg: stored
            ? 'Your application has been saved to the office\'s report bucket, but no delivery service is set up on it yet, so it was not emailed. Tell the office to finish setting up email — they can download the PDF from the bucket meanwhile. Your draft is still saved in this browser.'
            : 'No delivery service is set up on the office server, so the application was not emailed or saved. Tell the office to finish setting up email, then press Submit & Email again. Your draft is still saved in this browser.',
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
      // not deliver it. If stored:true the PDF is in the bucket, so nothing is
      // lost; if it is false (for example a rejected upload), say that instead of
      // pretending a copy exists.
      return {
        ok: false,
        reason: 'refused',
        stored: stored,
        msg: stored
          ? 'The application was NOT emailed: ' + plainReason(detail) +
            ' It has been saved to the office\'s report bucket, so the office can still download it — tell the office, and press Submit & Email to retry. Your draft is still saved in this browser.'
          : 'The application was NOT emailed: ' + plainReason(detail) +
            ' It was not saved either — press Submit & Email to try again. Your draft is still saved in this browser.',
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
  // The backend is the only path. If it is not configured there is nothing that
  // can honestly report delivery, so the send is refused before any request.
  async function send(blob, filename, cfg, recording) {
    const fail = (reason, msg) => ({ ok: false, reason: reason, msg: msg });

    // Checked here rather than inside the transport: every failure would look the
    // same to the consultant.
    if (!blob || !blob.size) {
      return fail('empty_pdf', 'The PDF could not be generated. Nothing was sent — your draft is still saved in this browser.');
    }
    if (location.protocol === 'file:') {
      return fail('file_protocol', 'This page is open directly from the disk (file://). Serve it over http:// or https:// — an email cannot be sent from a file:// page. Nothing was sent; your draft is still saved in this browser.');
    }
    if (blob.size > MAX_ATTACHMENT_BYTES) {
      return fail('too_large', 'The PDF is ' + (blob.size / 1048576).toFixed(1) + ' MB — over the ' + MAX_ATTACHMENT_MB + ' MB email attachment limit. Nothing was sent; your draft is still saved in this browser.');
    }
    if (recording && recording.blob && recording.blob.size > 15 * 1024 * 1024) {
      return fail('recording_too_large', 'The call recording is ' + (recording.blob.size / 1048576).toFixed(1) + ' MB — over the 15 MB recording limit. Nothing was sent; your draft is still saved in this browser.');
    }
    if (!backendBase(cfg)) {
      return fail('not_configured', 'Email is not configured: set signatureApiBase in js/config.js to the Khusela office server. Nothing was sent — your draft is still saved in this browser.');
    }

    return sendViaBackend(blob, filename, cfg, readApplicant(), recording);
  }

  window.ITCEmail = { send, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_MB };
})();
