// Regression test for how an application is emailed (js/email.js).
//
// The failure this locks down: on 2026-09-30 FormSubmit answered every submission
// with HTTP 500 — its own documentation page did too — while the app, which posts
// through a hidden cross-origin iframe and so cannot read that answer, told the
// consultant the application had been sent. Nothing arrived and nothing said so.
// The app now posts the PDF to the Khusela backend first, because that answer is a
// real HTTP status it can read, and keeps FormSubmit for the states the backend
// cannot cover. Those states are what this file pins down, because they are
// invisible in production and both ways of getting them wrong are bad: too eager
// and a broken mail service silently "succeeds" again, too reluctant and an
// application is refused that the old path would have carried.
//
// js/email.js is a browser IIFE, so it is loaded into a stub global scope: a DOM
// just large enough for the two transports (the applicant inputs, #emailForm →
// #emailFrame, and the File/DataTransfer pair a generated PDF travels as), plus a
// fetch() that answers whatever the case needs. Everything the module does is then
// observed through those stubs — which request went out, with what in it, and
// whether the hidden form was submitted at all. No browser and no network.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/email.js'), 'utf8');
const BACKEND = 'https://khusela-signature-backend.test';
const FORMSUBMIT = 'https://formsubmit.co/';
const OFFICE = 'office@example.test';
const CFG = { signatureApiBase: BACKEND, recipientEmail: OFFICE };

// A PDF-sized blob. Only its size matters here, but it has to be a real Blob for
// FormData to carry it the way a browser would.
const pdfBlob = (bytes) => new Blob([Buffer.alloc(bytes)], { type: 'application/pdf' });

// ── One loaded copy of js/email.js, with its stubs ───────────────────────────
// `answers` is what fetch() does: given the URL, return { status, body }, the
// string 'hang' (a service that never answers), or throw (never reached at all).
// `opts.location` lets a case pretend the page was opened from the disk.
function load(config, answers, opts) {
  const sent = [];         // every fetch() call: { url, options, form }
  const formPosts = [];    // every hidden-form submission
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

  const listeners = [];
  const frame = {
    name: 'emailFrame',
    contentWindow: { location: { href: 'about:blank' } },
    addEventListener: (type, fn) => { if (type === 'load') listeners.push(fn); },
    removeEventListener: (type, fn) => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
  };
  const form = {
    innerHTML: '',
    action: '',
    method: '',
    enctype: '',
    target: '',
    children: [],
    appendChild(el) { this.children.push(el); return el; },
    // A real browser navigates the hidden iframe, which then fires its load
    // event. The stub navigates it too — to FormSubmit's answer page — because
    // js/email.js treats "no longer about:blank" as the only proof FormSubmit
    // replied to the upload.
    submit() {
      formPosts.push({
        action: this.action,
        method: this.method,
        enctype: this.enctype,
        target: this.target,
        fields: this.children.filter((c) => c.name !== 'attachment')
          .map((c) => [c.name, c.value]),
        attachment: (this.children.find((c) => c.name === 'attachment') || {}).files,
      });
      frame.contentWindow.location.href = FORMSUBMIT + 'thanks';
      listeners.slice().forEach((fn) => fn());
    },
  };
  elements.emailForm = form;
  elements.emailFrame = frame;

  const sandbox = {
    console,
    Promise,
    Math,
    URL,
    FormData,          // the real thing: the multipart body is inspected through it
    Blob,
    AbortController,
    document: {
      getElementById: (id) => elements[id] || null,
      createElement: () => ({ type: '', name: '', value: '', files: null }),
    },
    location: (opts && opts.location) || { protocol: 'https:', href: 'https://itc-extractor.test/' },
    // Both timers are controlled here so the 120 s upload timeout can be reached
    // without waiting, and so a finished send leaves nothing pending behind it.
    setTimeout: (fn) => { const id = nextTimer++; pending.set(id, fn); return id; },
    clearTimeout: (id) => { pending.delete(id); },
    // The generated PDF becomes a File for the file input; a browser has both.
    File: class {
      constructor(parts, name, options) {
        this.name = name;
        this.type = (options && options.type) || '';
        this.size = parts.reduce((n, p) => n + (p && p.size ? p.size : 0), 0);
      }
    },
    DataTransfer: class {
      constructor() {
        this.files = [];
        this.items = { add: (f) => { this.files = [f]; } };
      }
    },
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

  // Fires whatever setTimeout()s js/email.js is waiting on (its upload timeouts).
  const flushTimers = () => {
    const due = [...pending.values()];
    pending.clear();
    due.forEach((fn) => fn());
  };

  return { email: sandbox.window.ITCEmail, sent, formPosts, applicant, flushTimers };
}

let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label
    + (ok ? '' : ' — got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected)));
}

const sentTo = (r) => ({ ok: r.ok, reason: r.reason });

// The recorded form post of a case. Safe when a case that should have posted did
// not: a regression then shows up as failures against placeholder values instead
// of stopping the run with a TypeError halfway down.
const NO_POST = { action: '(the form was never submitted)', method: '', enctype: '', target: '', fields: [], attachment: [] };
const post = (r) => r.formPosts[0] || NO_POST;
const field = (p, name) => {
  const hit = p.fields.find(([n]) => n === name);
  return hit ? hit[1] : null;
};
// The other direction: a field of the recorded request to the backend, and the
// field names that request was built from. Same reason as above — a request that
// should not have been made must still produce readable failures.
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
  check('the hidden form was not used at all', good.formPosts.length, 0);
  check('the send is reported as a success', sentTo(goodRes), { ok: true, reason: 'sent' });
  check('and says the office has been emailed',
    /emailed to the Khusela office/.test(goodRes.msg), true);
  check('the backend path allows 20 MB', good.email.MAX_ATTACHMENT_BYTES, 20 * 1024 * 1024);
  check('which is the figure app.js quotes, in MB', good.email.MAX_ATTACHMENT_MB, 20);


  // ── 2. A service with no mailbox hands over to the old path ───────────────
  // 503 email_not_configured means nothing was attempted, so the application can
  // still go through FormSubmit — and the message must say that is what happened,
  // because that path can never confirm delivery.
  const noMailbox = load(CFG, () => ({ status: 503, body: { error: 'email_not_configured' } }));
  const noMailboxRes = await noMailbox.email.send(pdfBlob(2048), 'app.pdf', CFG);

  check('a service with no mailbox falls back to FormSubmit', noMailbox.formPosts.length, 1);
  check('which posts to the configured address', post(noMailbox).action,
    FORMSUBMIT + encodeURIComponent(OFFICE));
  check('as a POST', post(noMailbox).method, 'POST');
  check('multipart, the encoding FormSubmit keeps files for',
    post(noMailbox).enctype, 'multipart/form-data');
  check('into the hidden frame', post(noMailbox).target, 'emailFrame');
  check('with FormSubmit\'s own field names',
    post(noMailbox).fields.map(([n]) => n),
    ['_subject', '_template', '_captcha', '_url', 'email', '_replyto', 'Applicant', 'ID Number', 'Date']);
  check('a captcha is not demanded of a JS-driven send',
    field(post(noMailbox), '_captcha'), 'false');
  check('the posting page is named', field(post(noMailbox), '_url'),
    'https://itc-extractor.test/');
  check('the PDF is the real attachment field', post(noMailbox).attachment.length, 1);
  check('with its filename intact',
    (post(noMailbox).attachment[0] || {}).name, 'app.pdf');
  check('the applicant is the reply address',
    field(post(noMailbox), '_replyto'), 'thandi@example.test');
  check('the applicant is named in the body',
    field(post(noMailbox), 'Applicant'), 'Thandi Mokoena');
  check('so an application can still go out today', sentTo(noMailboxRes),
    { ok: true, reason: 'sent_backup' });
  check('and the message says the office service was not set up',
    /own mail service is not set up yet/.test(noMailboxRes.msg), true);
  check('that the backup carried it', /backup email service \(FormSubmit\)/.test(noMailboxRes.msg), true);
  check('and that delivery cannot be confirmed',
    /cannot confirm delivery — please check with the office/.test(noMailboxRes.msg), true);

  // A service that accepts the connection and then goes quiet (the free instance
  // sleeps) is the other state the old path exists for: it looks like a hang, and
  // the timeout is what turns it into a decision.
  const asleep = load(CFG, () => 'hang');
  const asleepSend = asleep.email.send(pdfBlob(2048), 'app.pdf', CFG);
  asleep.flushTimers();            // the 120 s upload timeout, reached instantly
  const asleepRes = await asleepSend;

  check('a service that never answers falls back too', asleep.formPosts.length, 1);
  check('the send still succeeds', sentTo(asleepRes), { ok: true, reason: 'sent_backup' });
  check('and names the reason it gave up on the office service',
    /own mail service did not answer in time/.test(asleepRes.msg), true);

  // ── 3. A message the service tried and could not deliver is NOT hidden ─────
  // This is the September failure itself: a refusal that reached the consultant as
  // a success. A wrong mailbox password arrives as a 502 exactly like this one.
  const refused = load(CFG, () => ({ status: 502, body: { error: 'The application could not be emailed: Invalid login: 535-5.7.8' } }));
  const refusedRes = await refused.email.send(pdfBlob(2048), 'app.pdf', CFG);

  check('a refusal is a failure', sentTo(refusedRes), { ok: false, reason: 'refused' });
  check('and is not quietly retried through FormSubmit', refused.formPosts.length, 0);
  check('exactly one attempt was made', refused.sent.length, 1);
  check('the consultant is told it was NOT emailed', /NOT emailed/.test(refusedRes.msg), true);
  check('with the reason the mail server gave', /Invalid login: 535-5\.7\.8/.test(refusedRes.msg), true);

  // A rate limit is a refusal too — retrying it through the other service is
  // exactly what the limit is there to stop.
  const limited = load(CFG, () => ({ status: 429, body: { error: 'Too many applications from this address — try again in a minute.' } }));
  const limitedRes = await limited.email.send(pdfBlob(2048), 'app.pdf', CFG);

  check('a rate limit is reported as one', sentTo(limitedRes), { ok: false, reason: 'rate_limited' });
  check('the service\'s own explanation is shown',
    /try again in a minute/.test(limitedRes.msg), true);
  check('and the old path is not used to get around it', limited.formPosts.length, 0);

  // An app the service will not talk to is a setup mistake, and the message has to
  // say so rather than blame the mailbox.
  const refusedApp = load(CFG, () => ({ status: 401, body: { error: 'This endpoint emails Khusela applications to the Khusela office only.' } }));
  const refusedAppRes = await refusedApp.email.send(pdfBlob(2048), 'app.pdf', CFG);

  check('an app the service refuses is a failure', sentTo(refusedAppRes),
    { ok: false, reason: 'not_allowed' });
  check('and is not papered over by the old path either', refusedApp.formPosts.length, 0);
  check('the message says this site is not accepted',
    /refused this app/.test(refusedAppRes.msg), true);
  check('and points at the office, not the applicant',
    /this app is not on the list of sites/.test(refusedAppRes.msg), true);

  // No status at all is the one failure that has to fall back: an unreachable
  // service is also what a blocked origin and a sleeping instance look like, and
  // the old path can still carry the application.
  const unreachable = load(CFG, () => new TypeError('fetch failed'));
  const unreachableRes = await unreachable.email.send(pdfBlob(2048), 'app.pdf', CFG);

  check('an unreachable service falls back', unreachable.formPosts.length, 1);
  check('and the send still succeeds', sentTo(unreachableRes), { ok: true, reason: 'sent_backup' });
  check('with the reason named', /own mail service could not be reached/.test(unreachableRes.msg), true);

  // ── 4. The size ceiling is the one that will actually apply ───────────────
  // js/app.js renders a smaller PDF against whatever this file reports, so a
  // backend deployment must not quote FormSubmit's 10 MB and vice versa.
  const big = load(CFG, () => ({ status: 200, body: { ok: true } }));
  const bigRes = await big.email.send(pdfBlob(21 * 1024 * 1024), 'app.pdf', CFG);

  check('a PDF over the backend\'s ceiling is refused here', sentTo(bigRes),
    { ok: false, reason: 'too_large' });
  check('so it is never uploaded at all', big.sent.length, 0);
  check('and never handed to the old path either', big.formPosts.length, 0);
  check('the message names the limit that applies',
    /over the 20 MB email attachment limit/.test(bigRes.msg), true);
  check('and the size, so the consultant can see how far over it is',
    /21\.0 MB/.test(bigRes.msg), true);

  // A PDF that fits the backend but not the smaller backup, sent while the backend
  // has no mailbox: the fallback refuses it, and that has to be explained rather
  // than reported as a size the consultant was never warned about.
  const tooBigForBackup = load(CFG, () => ({ status: 503, body: { error: 'email_not_configured' } }));
  const tooBigRes = await tooBigForBackup.email.send(pdfBlob(12 * 1024 * 1024), 'app.pdf', CFG);

  check('a PDF the backup cannot take is a failure', sentTo(tooBigRes),
    { ok: false, reason: 'too_large' });
  check('the old path refused it rather than posting it', tooBigForBackup.formPosts.length, 0);
  check('and the message explains the two different ceilings',
    /only accepts 10 MB/.test(tooBigRes.msg), true);
  check('blaming the office service\'s state, not the file',
    /own mail service is not set up yet/.test(tooBigRes.msg), true);

  // ── 5. With nothing configured, today's app behaves exactly as before ─────
  const noBackend = load({ recipientEmail: OFFICE }, () => {
    throw new Error('the backend must not be called when none is configured');
  });
  const noBackendRes = await noBackend.email.send(pdfBlob(2048), 'app.pdf', { recipientEmail: OFFICE });

  check('no fetch is made without a configured service', noBackend.sent.length, 0);
  check('the hidden form still posts the PDF', noBackend.formPosts.length, 1);
  check('to FormSubmit, as it always did', post(noBackend).action,
    FORMSUBMIT + encodeURIComponent(OFFICE));
  check('and the send is reported as handed over', sentTo(noBackendRes),
    { ok: true, reason: undefined });
  check('the message names the service it cannot vouch for',
    /Submitted through the backup email service \(FormSubmit\), which cannot confirm delivery\./
      .test(noBackendRes.msg), true);
  check('such a deployment keeps the 10 MB limit it always had',
    noBackend.email.MAX_ATTACHMENT_BYTES, 10 * 1024 * 1024);
  check('which app.js quotes as 10', noBackend.email.MAX_ATTACHMENT_MB, 10);

  // Neither transport configured: the app says so instead of failing later.
  const unconfigured = load({}, () => ({ status: 200, body: { ok: true } }));
  const unconfiguredRes = await unconfigured.email.send(pdfBlob(2048), 'app.pdf', {});

  check('with no address and no service, nothing is attempted', unconfigured.sent.length, 0);
  check('and the consultant is told email is not configured', sentTo(unconfiguredRes),
    { ok: false, reason: 'not_configured' });

  // ── 6. A send that could never work is refused before any request ─────────
  const fromDisk = load(CFG, () => ({ status: 200, body: { ok: true } }),
    { location: { protocol: 'file:', href: 'file:///C:/khusela/index.html' } });
  const fromDiskRes = await fromDisk.email.send(pdfBlob(2048), 'app.pdf', CFG);

  check('a file:// page cannot email, on either path', sentTo(fromDiskRes),
    { ok: false, reason: 'file_protocol' });
  check('nothing is uploaded from the disk', fromDisk.sent.length, 0);
  check('and no form post is made', fromDisk.formPosts.length, 0);
  check('the message says how to fix it (serve over http)',
    /Serve it over http:\/\/ or https:\/\//.test(fromDiskRes.msg), true);

  const empty = load(CFG, () => ({ status: 200, body: { ok: true } }));
  const emptyRes = await empty.email.send(null, 'app.pdf', CFG);

  check('an empty PDF is refused before any request', sentTo(emptyRes),
    { ok: false, reason: 'empty_pdf' });
  check('and is not posted to the old path either', empty.formPosts.length, 0);

  console.log(failed ? 'email routing FAILURES: ' + failed : 'email routing OK');
  process.exit(failed ? 1 : 0);
})();

