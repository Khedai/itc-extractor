// ── App configuration ─────────────────────────────────────────────
// The office recipient is NOT set here. It belongs to the backend
// (MAIL_TO in khusela-signature-backend), so a copied request cannot name a
// different address.
//
// signatureApiBase is required for "Submit & Email" and for the signing links.
// With it empty the app still opens and drafts/prints, but it refuses to send
// and says email is not configured — it never claims delivery.
window.ITC_CONFIG = {
  fileNamePrefix: 'Khusela-Credit-Application',
  // Base URL of the Khusela signature backend, with no trailing slash — the
  // Render service created for this PWA. This site's address
  // (https://itc-extractor.vercel.app) is already in the backend's
  // ALLOWED_ORIGINS, so the requests below are accepted from here.
  //
  // "Submit & Email" POSTs the finished PDF to <signatureApiBase>/api/email.
  // That service stores it in the office's report bucket first, then delivers it
  // over SMTP, Brevo or Formspree and answers with a real status. The app shows
  // exactly what that status says — emailed, saved-but-not-emailed, refused, or
  // unreachable — and there is no FormSubmit fallback.
  //
  // The free Render instance sleeps after ~15 minutes idle and takes up to a
  // minute to wake; js/signature.js wakes it with a repeated /health read before
  // the first write, then sends that write exactly once.
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

  // ── Optional: Vicidial call recording as evidence ────────────────────────
  // This app never talks to Vicidial and never holds a Vicidial password: the
  // consultant's login and date go to our backend, which looks up the call and
  // fetches the MP3. Add the pilot group's Vicidial logins here to give the
  // consultant a pick-list; free text works too, so this may be left empty.
  // (e.g. vicidialConsultants: ['1001', '1002', '1003'])
  vicidialConsultants: [
    '1015', '1005', '1024', '1010', '3014', '1014', '1071', '1028',
    '1016', '1022', '3015', '1072', '1070', '3016', '1064', '3019',
    '1033', '3023', '1018', '1063', '1019', '1027',
  ],
};
