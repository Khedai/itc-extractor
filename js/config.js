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
  // js/email.js uses this same base: "Submit & Email" sends the finished PDF to
  // <signatureApiBase>/api/email, which mails it from the office's own mailbox
  // and answers with a real status. It falls back to the FormSubmit path when
  // that service says it has no mailbox configured (503) or does not answer at
  // all (the sleep below), and the message on screen then says so.
  //
  // The free Render instance sleeps after ~15 minutes idle and takes up to a
  // minute to wake; js/signature.js wakes it with a repeated /health read
  // before the first write, then sends that write exactly once.
  signatureApiBase: 'https://khusela-signature-backend.onrender.com',

  // How "Send via Email" delivers the signing link — see js/signature.js.
  //
  // A mailto: is the obvious choice and it is the one that fails most often: it
  // only works if the machine has a program registered as the mail handler, and
  // a Windows box with no Outlook configured answers a click with silence. The
  // webmail composers work in any browser and put the whole draft in front of the
  // consultant, who presses Send — so they are the default here.
  //
  //   'gmail'    mail.google.com compose  (default)
  //   'outlook'  outlook.live.com compose
  //   'mailto'   the operating system's own mail app — use this if the office
  //              has one working and configured, because it keeps the draft in
  //              the desktop client
  //
  // Whatever this says, nothing is sent until the consultant presses Send in that
  // window: the app only fills it in.
  mailWebmail: 'gmail',
};
