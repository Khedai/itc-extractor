// ── App configuration ─────────────────────────────────────────────
// Set the recipient address below. When empty, "Submit & Email" won't send
// anything — the draft stays autosaved in the browser, ready to retry.
window.ITC_CONFIG = {
  recipientEmail: 'khuselamanagement@gmail.com',
  subject: 'Khusela Credit Application - ITC report',
  fileNamePrefix: 'Khusela-Credit-Application',
  // Base URL of the Khusela signature backend (khusela-backend), with no
  // trailing slash — the Render service created for this PWA. While this is
  // empty the application works exactly as before: the Signature section stays
  // a plain pair of boxes and no signing requests can be sent. This site's
  // address (https://itc-extractor.vercel.app) is already in the backend's
  // ALLOWED_ORIGINS, so the requests below are accepted from here.
  //
  // The free Render instance sleeps after ~15 minutes idle and takes up to a
  // minute to wake; js/signature.js wakes it with a repeated /health read
  // before the first write, then sends that write exactly once.
  signatureApiBase: 'https://khusela-signature-backend.onrender.com',
};
