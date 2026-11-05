// Regression test for how an application is emailed (js/email.js).
//
// The failure this locks down: on 2026-09-30 FormSubmit answered every submission
// with HTTP 500 — its own documentation page did too — while the app, which posted
// through a hidden cross-origin iframe, could not read that answer and told the
// consultant the application had been sent. On 2026-11-05 the same endpoint
// answered 522. Nothing arrived and nothing said so.
//
// The app now has one transport: POST the PDF to the Khusela backend, which stores
// it first and answers with a real HTTP status. This file loads js/email.js into a
// stub global scope and checks every status the consultant can see, plus the fact
// that the old hidden form no longer exists. No browser and no network.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/email.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const CONFIG_SRC = fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8');
const BACKEND = 'https://khusela-signature-backend.test';
const CFG = { signatureApiBase: BACKEND };

// A PDF-sized blob. Only its size matters here, but it has to be a real Blob for
// FormData to carry it the way a browser would.
const pdfBlob = (bytes) => new Blob([Buffer.alloc(bytes)], { type: 'application/pdf' });

// ── One loaded copy of js/email.js, with its stubs ───────────────────────────
// `answers` is what fetch() does: given the URL, return { status, body }, the
// string 'hang' (a service that never answers), or throw (never reached at all).
// `opts.location` lets a case pretend the page was opened from the disk.
function load(config, answers, opts) {
  const sent = [];         // every fetch() call: { url, options, form }
  const pending = new Map();
  let nextTimer = 1;

  const applicant = {
    name: 'Thandi',
    surname: 'Mokoena',
    email: 'thandi@example.test',
    id: '9001015800088',
    fDate: '2026-09-30',
  };

  const elements = {};
  Object.keys(applicant).forEach((id) => { elements[id] = { value: applicant[id] }; });
  // A signature box with an image is what tells the email which signer(s) the
  // report carries. Cases that do not ask for this leave the boxes absent.
  ((opts && opts.signed) || []).forEach((n) => {
    elements['sigimg' + n] = { getAttribute: () => 'data:image/png;base64,AAAA' };
  });

  const sandbox = {
    console,
    Promise,
    Math,
    URL,
    FormData,          // the real thing: the multipart body is inspected through it
    Blob,
    AbortController,
    document: { getElementById: (id) => elements[id] || null },
    location: (opts && opts.location) || { protocol: 'https:', href: 'https://itc-extractor.test/' },
    // The upload timeout is controlled here so it can be reached without waiting,
    // and so a finished send leaves nothing pending behind it.
    setTimeout: (fn) => { const id = nextTimer++; pending.set(id, fn); return id; },
    clearTimeout: (id) => { pending.delete(id); },
    fetch: async (url, options) => {
      sent.push({ url, options, form: options && options.body });
      const answer = answers(url);
      if (answer === 'hang') {
        // A service that accepts the connection and then says nothing: only the
        // upload timeout ends this, exactly as a sleeping instance does live.
        return await new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const e = new Error('The operation was aborted');
            e.name = 'AbortError';
            reject(e);
          });
        });
      }
      if (answer instanceof Error) throw answer;
      return {
        ok: answer.status >= 200 && answer.status < 300,
        status: answer.status,
        json: async () => answer.body,
      };
    },
  };
  sandbox.window = sandbox;
  sandbox.ITC_CONFIG = config;
  vm.runInNewContext(SRC, sandbox, { filename: 'js/email.js' });

  // Fires whatever setTimeout()s js/email.js is waiting on (its upload timeout).
  const flushTimers = () => {
    const due = [...pending.values()];
    pending.clear();
    due.forEach((fn) => fn());
  };

  return { email: sandbox.window.ITCEmail, sent, applicant, flushTimers };
}

let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label
    + (ok ? '' : ' — got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected)));
}

const sentTo = (r) => ({ ok: r.ok, reason: r.reason });
const part = (r, name) => (r.sent[0] ? r.sent[0].form.get(name) : null);
const parts = (r) => (r.sent[0] ? [...r.sent[0].form.keys()] : []);

(async () => {
  // ── 1. The backend carries it, with everything the office needs ────────────
  // The recipient is NOT in here and must never be: the service owns MAIL_TO, so
  // a page anyone can open cannot be turned into a mail relay.
  const good = load(CFG, () => ({ status: 200, body: { ok: true, messageId: '<1@test>' } }));
  const goodRes = await good.email.send(pdfBlob(2048), 'app.pdf', CFG);

  check('a configured backend is asked exactly once', good.sent.length, 1);
  check('at the /api/email route of that service', good.sent[0].url, BACKEND + '/api/email');
  check('by POST', good.sent[0].options.method, 'POST');
  check('carrying only the fields the service reads', parts(good),
    ['attachment', 'applicant', 'idNumber', 'date', 'replyTo']);
  check('the PDF under the filename the app gave it',
    (part(good, 'attachment') || {}).name, 'app.pdf');
  check('with its real size', (part(good, 'attachment') || {}).size, 2048);
  check('the applicant is named', part(good, 'applicant'), 'Thandi Mokoena');
  check('the ID number is sent, so the mail can be filed',
    part(good, 'idNumber'), '9001015800088');
  check('the date is sent', part(good, 'date'), '2026-09-30');
  check('the applicant is only the reply address',
    part(good, 'replyTo'), 'thandi@example.test');
  check('no recipient is named by the request', part(good, 'to'), null);
  check('no signer label is invented when nothing is signed', part(good, 'signerLabel'), null);
  check('the send is reported as a success', sentTo(goodRes), { ok: true, reason: 'sent' });
  check('and says the office has been emailed',
    /emailed to the Khusela office/.test(goodRes.msg), true);
  check('the backend path allows 20 MB', good.email.MAX_ATTACHMENT_BYTES, 20 * 1024 * 1024);
  check('which is the figure app.js quotes, in MB', good.email.MAX_ATTACHMENT_MB, 20);

  // The report bucket records the signer label so a stranded report can be
  // matched to the signature it carries. Both boxes signed is the joint case.
  const signed = load(CFG, () => ({ status: 200, body: { ok: true } }), { signed: [1, 2] });
  await signed.email.send(pdfBlob(2048), 'app.pdf', CFG);
  check('a signed report names the applicant boxes that carry signatures',
    part(signed, 'signerLabel'), 'Applicant 1, Applicant 2');
  check('and the label travels with the other identifying fields',
    parts(signed), ['attachment', 'applicant', 'idNumber', 'signerLabel', 'date', 'replyTo']);

  // When Formspree's free plan refuses the PDF, the backend still emails the
  // office with a secure link. The message must not claim a file was attached.
  const linkSent = load(CFG, () => ({ status: 200, body: { ok: true, stored: true, linkOnly: true } }));
  const linkRes = await linkSent.email.send(pdfBlob(2048), 'app.pdf', CFG);
  check('a link-only delivery is still reported as sent', sentTo(linkRes), { ok: true, reason: 'sent' });
  check('and the message says the email carries a secure link',
    /secure link to the completed PDF/.test(linkRes.msg), true);
  check('and never says the PDF was attached when it was not',
    /attached/.test(linkRes.msg), false);

  // ── 2. A service with no delivery path stores the PDF in the bucket ────────
  // 503 email_not_configured + stored:true means the PDF is safe in the office's
  // report bucket even though nothing was emailed.
  const noMailbox = load(CFG, () => ({ status: 503, body: { error: 'email_not_configured', stored: true } }));
  const noMailboxRes = await noMailbox.email.send(pdfBlob(2048), 'app.pdf', CFG);

  check('a service with no delivery path is not retried anywhere else', noMailbox.sent.length, 1);
  check('the send is reported as not emailed', sentTo(noMailboxRes), { ok: false, reason: 'stored_not_emailed' });
  check('the result says the PDF was stored', noMailboxRes.stored, true);
  check('the consultant is told it was saved to the report bucket', /report bucket/.test(noMailboxRes.msg), true);
  check('and that it was not emailed', /not emailed/.test(noMailboxRes.msg), true);
  check('and names no email provider at all — a consultant has no use for one',
    /FormSubmit|backup email service|own mail service/.test(noMailboxRes.msg), false);

  // A service that accepts the connection and then goes quiet (the free instance
  // sleeps) is unreachable: nothing can be stored there, so the message says to
  // retry rather than claiming anything was sent.
  const asleep = load(CFG, () => 'hang');
  const asleepSend = asleep.email.send(pdfBlob(2048), 'app.pdf', CFG);
  asleep.flushTimers();            // the 120 s upload timeout, reached instantly
  const asleepRes = await asleepSend;

  check('a service that never answers makes exactly one attempt', asleep.sent.length, 1);
  check('the send fails honestly', sentTo(asleepRes), { ok: false, reason: 'timeout' });
  check('and tells them the draft is still saved', /draft is still saved/.test(asleepRes.msg), true);
  check('and asks for a retry', /try again/.test(asleepRes.msg), true);

  // ── 3. A message the service tried and could not deliver is NOT hidden ─────
  // This is the September failure itself: a refusal that reached the consultant as
  // a success. A wrong mailbox password arrives as a 502 exactly like this one —
  // and now it also carries stored:true, because the PDF is safe in the bucket.
  const refused = load(CFG, () => ({ status: 502, body: { error: 'The application could not be emailed: Invalid login: 535-5.7.8', stored: true } }));
  const refusedRes = await refused.email.send(pdfBlob(2048), 'app.pdf', CFG);

  check('a refusal is a failure', sentTo(refusedRes), { ok: false, reason: 'refused' });
  check('exactly one attempt was made', refused.sent.length, 1);
  check('the consultant is told it was NOT emailed', /NOT emailed/.test(refusedRes.msg), true);
  check('and that it is safe in the report bucket', /report bucket/.test(refusedRes.msg), true);
  check('and told to tell the office, which is the only thing they can act on',
    /tell the office/.test(refusedRes.msg), true);
  check('the raw SMTP code is NOT put in front of them', /535/.test(refusedRes.msg), false);
  check('but it is still recognisable as a sign-in problem',
    /sign-in details/.test(refusedRes.msg), true);

  // A rate limit is a refusal too — retrying it is exactly what the limit is
  // there to stop.
  const limited = load(CFG, () => ({ status: 429, body: { error: 'Too many applications from this address — try again in a minute.' } }));
  const limitedRes = await limited.email.send(pdfBlob(2048), 'app.pdf', CFG);
  check('a rate limit is reported as one', sentTo(limitedRes), { ok: false, reason: 'rate_limited' });
  check('it says to wait and try again',
    /wait a minute and press Submit & Email again/.test(limitedRes.msg), true);
  check('and does not quote the service verbatim', /Too many applications from this address/.test(limitedRes.msg), false);
  check('and makes exactly one attempt', limited.sent.length, 1);

  // An app the service will not talk to is a setup mistake, and the message has to
  // say so rather than blame the mailbox.
  const refusedApp = load(CFG, () => ({ status: 401, body: { error: 'This endpoint emails Khusela applications to the Khusela office only.' } }));
  const refusedAppRes = await refusedApp.email.send(pdfBlob(2048), 'app.pdf', CFG);
  check('an app the service refuses is a failure', sentTo(refusedAppRes),
    { ok: false, reason: 'not_allowed' });
  check('the message says this site is not accepted',
    /would not accept this app/.test(refusedAppRes.msg), true);
  check('and points at the office, not the applicant',
    /not on their list of approved sites/.test(refusedAppRes.msg), true);

  // No status at all: the service is unreachable, so nothing can be stored there.
  // The only copy is still on the device, and the message asks for a retry.
  const unreachable = load(CFG, () => new TypeError('fetch failed'));
  const unreachableRes = await unreachable.email.send(pdfBlob(2048), 'app.pdf', CFG);
  check('an unreachable service fails honestly', sentTo(unreachableRes), { ok: false, reason: 'unreachable' });
  check('with no mention of the plumbing behind it',
    /own mail service|could not be reached/.test(unreachableRes.msg), false);
  check('and the draft is still saved', /draft is still saved/.test(unreachableRes.msg), true);
  check('and asks for a retry', /try again/.test(unreachableRes.msg), true);

  // A failure after storage still says the PDF is in the bucket; a failure before
  // storage (a rejected upload) must not pretend a copy exists.
  const notStored = load(CFG, () => ({ status: 413, body: { error: 'The file is too large', stored: false } }));
  const notStoredRes = await notStored.email.send(pdfBlob(2048), 'app.pdf', CFG);
  check('a refusal without a stored copy does not claim one', notStoredRes.stored, false);
  check('and says it was not saved either', /not saved either/.test(notStoredRes.msg), true);

  // ── 4. The size ceiling is the one that will actually apply ───────────────
  // js/app.js renders a smaller PDF against whatever this file reports.
  const big = load(CFG, () => ({ status: 200, body: { ok: true } }));
  const bigRes = await big.email.send(pdfBlob(21 * 1024 * 1024), 'app.pdf', CFG);
  check('a PDF over the backend\'s ceiling is refused here', sentTo(bigRes),
    { ok: false, reason: 'too_large' });
  check('so it is never uploaded at all', big.sent.length, 0);
  check('the message names the limit that applies',
    /over the 20 MB email attachment limit/.test(bigRes.msg), true);
  check('and the size, so the consultant can see how far over it is',
    /21\.0 MB/.test(bigRes.msg), true);

  // ── 5. With no backend configured, the app refuses honestly ───────────────
  const noBackend = load({}, () => {
    throw new Error('the backend must not be called when none is configured');
  });
  const noBackendRes = await noBackend.email.send(pdfBlob(2048), 'app.pdf', {});
  check('no fetch is made without a configured service', noBackend.sent.length, 0);
  check('and the consultant is told email is not configured', sentTo(noBackendRes),
    { ok: false, reason: 'not_configured' });
  check('the message names the setting to fix', /signatureApiBase/.test(noBackendRes.msg), true);
  check('and never claims it was handed to a provider',
    /FormSubmit|Submitted|handed over/.test(noBackendRes.msg), false);

  // ── 6. A send that could never work is refused before any request ─────────
  const fromDisk = load(CFG, () => ({ status: 200, body: { ok: true } }),
    { location: { protocol: 'file:', href: 'file:///C:/khusela/index.html' } });
  const fromDiskRes = await fromDisk.email.send(pdfBlob(2048), 'app.pdf', CFG);
  check('a file:// page cannot email', sentTo(fromDiskRes),
    { ok: false, reason: 'file_protocol' });
  check('nothing is uploaded from the disk', fromDisk.sent.length, 0);
  check('the message says how to fix it (serve over http)',
    /Serve it over http:\/\/ or https:\/\//.test(fromDiskRes.msg), true);

  const empty = load(CFG, () => ({ status: 200, body: { ok: true } }));
  const emptyRes = await empty.email.send(null, 'app.pdf', CFG);
  check('an empty PDF is refused before any request', sentTo(emptyRes),
    { ok: false, reason: 'empty_pdf' });
  check('and nothing is uploaded', empty.sent.length, 0);

  // ── 7. The old FormSubmit transport is gone, not merely unused ────────────
  check('no FormSubmit URL remains in js/email.js', /formsubmit\.co/i.test(SRC), false);
  check('no hidden email form remains in js/email.js', /emailForm|emailFrame/.test(SRC), false);
  check('the hidden FormSubmit form is gone from index.html',
    /emailForm|emailFrame|formsubmit\.co/i.test(INDEX), false);
  check('the client no longer carries a recipient address',
    /recipientEmail/.test(CONFIG_SRC), false);

  console.log(failed ? 'email routing FAILURES: ' + failed : 'email routing OK');
  process.exit(failed ? 1 : 0);
})();
