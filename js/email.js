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
// Transport: the PDF is posted by a REAL hidden <form> (in index.html:
// #emailForm → #emailFrame) with enctype="multipart/form-data" and a real file
// input named "attachment". FormSubmit keeps uploaded files only for a genuine
// form POST (a navigation) — a fetch()/XHR post is treated as AJAX: the email
// still arrives, but the PDF is silently dropped. Do NOT change this back to
// fetch() + FormData; that is exactly what lost the attachment before.
//
// Because the reply lands in a hidden cross-origin iframe, FormSubmit's answer
// page cannot be read. We can tell that FormSubmit replied (the frame navigates
// away from about:blank) but not whether it was the "Thanks" page or the
// "needs activation" page, so the success message stays deliberately plain.
(function () {
  'use strict';

  // FormSubmit hard limit for the sum of all uploaded files.
  const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
  // Generous timeout: the PDF is a few MB and can take a while over mobile data.
  const UPLOAD_TIMEOUT_MS = 120000;

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
        finish({
          ok: true,
          msg: 'Submitted — the completed application is being emailed to ' + cfg.recipientEmail + ' with the PDF attached.',
        });
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

  window.ITCEmail = { send, MAX_ATTACHMENT_BYTES };
})();
