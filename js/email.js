// Email of the generated PDF (the app intentionally never downloads PDFs —
// drafts live only in the browser's localStorage; see js/app.js).
//
// Sending is done through FormSubmit (https://formsubmit.co) — a free
// no-backend service that works from any static host. Configure the recipient
// in js/config.js. On the first send the recipient receives an activation
// email that must be confirmed once.
(function () {
  'use strict';

  function send(blob, filename, cfg) {
    return new Promise((resolve) => {
      if (!cfg || !cfg.recipientEmail) {
        return resolve({ ok: false, reason: 'not_configured', msg: 'Email is not configured (set recipientEmail in js/config.js). Nothing was sent — your draft is still saved in this browser.' });
      }

      const form = document.getElementById('emailForm');
      const frame = document.getElementById('emailFrame');
      form.innerHTML = '';

      form.action = 'https://formsubmit.co/' + encodeURIComponent(cfg.recipientEmail);
      form.method = 'POST';
      form.enctype = 'multipart/form-data';

      const hidden = (name, value) => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value;
        form.appendChild(input);
      };
      hidden('_subject', cfg.subject || 'Khusela Credit Application - ITC report');
      hidden('_captcha', 'false');

      // Attach the generated PDF.
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.name = 'attachment';
      const dt = new DataTransfer();
      dt.items.add(new File([blob], filename, { type: 'application/pdf' }));
      fileInput.files = dt.files;
      form.appendChild(fileInput);

      let settled = false;
      const done = (ok, msg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok, msg });
      };
      const timer = setTimeout(() => done(false, 'Timed out contacting the email service. Nothing was sent — your draft is still saved in this browser. Try again.'), 25000);

      frame.onload = () => done(true, 'Email sent to ' + cfg.recipientEmail + '.');

      try {
        form.submit();
      } catch (e) {
        done(false, 'Could not send the email. Nothing was sent — your draft is still saved in this browser.');
      }
    });
  }

  window.ITCEmail = { send };
})();
