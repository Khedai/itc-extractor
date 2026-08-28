// Email of the generated PDF (the app intentionally never downloads PDFs —
// drafts live only in the browser's localStorage; see js/app.js).
//
// Sending is done through FormSubmit (https://formsubmit.co) — a free
// no-backend service that works from any static host. Configure the recipient
// in js/config.js.
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
// Transport: we POST multipart/form-data to FormSubmit's AJAX endpoint
// (https://formsubmit.co/ajax/…) with fetch(). It accepts the PDF attachment,
// works cross-origin (including on phones) and returns a real JSON response —
// unlike a hidden-iframe form POST whose onload is unreliable on mobile.
(function () {
  'use strict';

  // FormSubmit hard limit for the sum of all uploaded files.
  const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
  // Generous timeout: the PDF is a few MB and can take a while over mobile data.
  const SEND_TIMEOUT_MS = 60000;

  function readApplicant() {
    const get = (id) => {
      const el = document.getElementById(id);
      return el ? String(el.value || '').trim() : '';
    };
    const first = get('fFirst');
    const surname = get('fSurname');
    const name = [first, surname].filter(Boolean).join(' ');
    return {
      name: name,
      email: get('fEmail'),
      id: get('fId'),
      date: get('fDate'),
    };
  }

  function send(blob, filename, cfg) {
    return new Promise((resolve) => {
      const fail = (reason, msg) => resolve({ ok: false, reason: reason, msg: msg });

      if (!cfg || !cfg.recipientEmail) {
        return fail('not_configured', 'Email is not configured (set recipientEmail in js/config.js). Nothing was sent — your draft is still saved in this browser.');
      }
      if (!blob || !blob.size) {
        return fail('empty_pdf', 'The PDF could not be generated. Nothing was sent — your draft is still saved in this browser.');
      }
      if (blob.size > MAX_ATTACHMENT_BYTES) {
        return fail('too_large', 'The PDF is ' + (blob.size / 1048576).toFixed(1) + ' MB — over FormSubmit\'s 10 MB attachment limit. Nothing was sent; your draft is still saved in this browser.');
      }
      if (location.protocol === 'file:') {
        return fail('file_protocol', 'This page is open directly from the disk (file://). Serve it over http:// or https:// — FormSubmit rejects file:// pages. Nothing was sent; your draft is still saved in this browser.');
      }

      const fd = new FormData();
      const add = (name, value) => { if (value) fd.append(name, value); };

      add('_subject', cfg.subject || 'Khusela Credit Application - ITC report');
      fd.append('_template', 'table');   // readable table layout in the email body
      fd.append('_captcha', 'false');
      add('_url', location.href);        // helps FormSubmit record where the submission came from

      // Applicant details in the body make the notification email useful, and
      // the "email"/"_replyto" fields let the recipient reply straight to the
      // applicant (FormSubmit cannot customise "From").
      const applicant = readApplicant();
      if (applicant.email) {
        fd.append('email', applicant.email);
        fd.append('_replyto', applicant.email);
      }
      if (applicant.name) fd.append('Applicant', applicant.name);
      if (applicant.id) fd.append('ID Number', applicant.id);
      if (applicant.date) fd.append('Date', applicant.date);

      // Attach the generated PDF — field MUST be named "attachment" for FormSubmit.
      fd.append('attachment', blob, filename);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

      fetch('https://formsubmit.co/ajax/' + encodeURIComponent(cfg.recipientEmail), {
        method: 'POST',
        body: fd,
        signal: controller.signal,
      })
        .then(async (res) => {
          clearTimeout(timer);
          let data = null;
          try { data = await res.json(); } catch (e) { data = null; }

          if (res.ok && data && String(data.success) === 'true') {
            resolve({ ok: true, msg: 'Email sent to ' + cfg.recipientEmail + '. The filled form is attached as a PDF.' });
            return;
          }

          // FormSubmit answered but refused the submission — the most common
          // cause is the recipient not having clicked the one-time activation
          // link yet.
          const text = (data && data.message)
            ? data.message
            : ('The email service refused the submission (HTTP ' + res.status + ').');
          if (/activat/i.test(text)) {
            resolve({ ok: false, reason: 'activation', msg: 'The email service sent the recipient a one-time activation notification — the PDF is only delivered after they click its activation link. Click it, then press Submit & Email again. Your draft is still saved.' });
            return;
          }
          resolve({ ok: false, reason: 'refused', msg: text + ' Nothing was sent; your draft is still saved in this browser.' });
        })
        .catch((err) => {
          clearTimeout(timer);
          if (err && err.name === 'AbortError') {
            resolve({ ok: false, reason: 'timeout', msg: 'Timed out contacting the email service — the PDF is large and mobile uploads can be slow. Nothing was sent; your draft is still saved in this browser. Try again.' });
            return;
          }
          resolve({ ok: false, reason: 'network', msg: 'Could not contact the email service (' + (err && err.message ? err.message : 'network error') + '). Nothing was sent — your draft is still saved in this browser. Check your connection and try again.' });
        });
    });
  }

  window.ITCEmail = { send, MAX_ATTACHMENT_BYTES };
})();
