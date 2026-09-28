// ── App configuration ─────────────────────────────────────────────
// Set the recipient address below. When empty, "Submit & Email" won't send
// anything — the draft stays autosaved in the browser, ready to retry.
window.ITC_CONFIG = {
  recipientEmail: 'khuselamanagement@gmail.com',
  subject: 'Khusela Credit Application - ITC report',
  fileNamePrefix: 'Khusela-Credit-Application',
  // Base URL of the Khusela signature backend (khusela-backend), with no
  // trailing slash — e.g. 'https://khusela-signature.example.com'. While this
  // is empty the application works exactly as before: the Signature section
  // stays a plain pair of boxes and no signing requests can be sent. Ask the
  // backend's host for the URL, and add this site's address to the backend's
  // ALLOWED_ORIGINS so the requests are accepted.
  signatureApiBase: '',
};
