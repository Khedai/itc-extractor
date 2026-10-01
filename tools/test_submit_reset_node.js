// Regression test for the signature boxes when an application is emailed.
//
// The failure this locks down: after a successful send the captured signature was
// left where it was, so it survived into the next client's application — load
// another Datanamix report (or type the next applicant in by hand) and the previous
// applicant's signature was still in the box, and so was inside the next applicant's
// PDF. Clearing it is the fix, and both ways of getting the timing wrong are worse
// than the bug: cleared before the PDF is rendered, the application is emailed with
// no signature on it; cleared on a failure, a signature the client has already given
// is thrown away and the retry cannot use it. Only a send that actually happened may
// forget it, and only once it has happened.
//
// js/signature.js and js/app.js are browser IIFEs, so both are loaded — in the order
// index.html loads them — into one stub global scope: a DOM just large enough for
// the signature section and the submit path, an in-memory localStorage, a fetch()
// that answers the signature service for a client who has signed, and stubs for the
// PDF generator and the email transport that record what the box held while they
// ran. No browser and no network.
// Run: node tools/test_submit_reset_node.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SIGNATURE_SRC = fs.readFileSync(path.join(ROOT, 'js/signature.js'), 'utf8');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const MB = 1024 * 1024;
const BACKEND = 'https://khusela-signature-backend.test';
const STORE_KEY = 'khusela-itc-signatures-v1';
const DRAFT_KEY = 'khusela-itc-draft-v1';
// What the downloaded signature turns into. Only its presence matters: the box is
// either holding a signature or it is not.
const SIGNATURE_IMAGE = 'data:image/png;base64,iVBORw0KGgo=';
const SUCCESS = { ok: true, msg: 'Submitted successfully.' };
// A signed request left on this device by an earlier session, exactly as
// js/signature.js stores it.
const SIGNED = {
  1: {
    invitationId: 'inv-1',
    manageToken: 'tok-1',
    signingLink: 'https://sign.khusela.test/s/one-time',
    expiresAt: '2026-10-08T09:00:00Z',
    status: 'signed',
    signedAt: '2026-10-01T09:00:00Z',
  },
};

// ── The stub page ───────────────────────────────────────────────────────────
// One element stub for everything the two modules touch. `src` is a real attribute
// here, because that is how the box holds — and gives up — a signature.
function element(id, log, attrs) {
  const el = {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    className: '',
    hidden: false,
    disabled: false,
    files: [],
    children: [],
    listeners: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener() {},
    appendChild(child) { this.children.push(child); return child; },
    closest() { return null; },
    focus() {},
    setAttribute(name, value) { attrs[name] = String(value); },
    getAttribute(name) { return name in attrs ? attrs[name] : null; },
    removeAttribute(name) {
      // The one DOM write that says a signature box was emptied. Logged only when
      // there was something in it — clearing an empty box is not an event — so the
      // order of "the application went" and "the box went empty" can be asserted,
      // and not just the state afterwards.
      if (name === 'src' && attrs.src !== undefined) log.push(id + ':src removed');
      delete attrs[name];
    },
  };
  Object.defineProperty(el, 'src', {
    // A browser reflects img.src onto the attribute, and js/signature.js reads the
    // attribute back (render()) and clears it (clear(), generate()).
    get: () => (attrs.src === undefined ? '' : attrs.src),
    set: (value) => { attrs.src = value; },
    configurable: true,
  });
  return el;
}

class FileReaderStub {
  // Node has no FileReader and a browser has: js/signature.js uses it for the one
  // conversion it makes, so the downloaded signature becomes a data URL and the PDF
  // never depends on a cross-origin request being allowed at print time.
  readAsDataURL() { this.result = SIGNATURE_IMAGE; this.onload(); }
}

// ── One page, with its stubs ────────────────────────────────────────────────
// opts.state   — the records already in this device's localStorage, what an earlier
//                session left behind
// opts.draft   — an autosaved draft already on the device
// opts.send    — what the email transport answers; a function is called once per
//                send, so a retry is able to answer differently
// opts.limit   — the attachment ceiling js/app.js reads from the transport
// opts.pdfSize — what the PDF generator renders
function load(opts) {
  const o = opts || {};
  const answer = o.send || (() => SUCCESS);
  const limit = o.limit || 20 * MB;
  const pdfSize = o.pdfSize || 4096;
  const store = new Map();          // the browser's localStorage
  const removals = [];              // every key removed from it
  const log = [];                   // everything whose order matters
  const marks = {};                 // what the signature box held at each step
  const requests = [];              // every fetch() the signature module made
  const elements = {};
  const onDocument = {};
  if (o.state) store.set(STORE_KEY, JSON.stringify(o.state));
  if (o.draft) store.set(DRAFT_KEY, JSON.stringify(o.draft));

  // The one form field on this page, so a draft has somewhere to be restored to and
  // is not discarded as inapplicable by js/app.js's restoreDraft().
  const field = { name: 'name', value: '', type: 'text', readOnly: false, closest: () => null };

  const document = {
    readyState: 'loading',
    getElementById: (id) => (elements[id] || (elements[id] = element(id, log, {}))),
    querySelector: () => null,
    // No loan rows and no expense fields: the totals are all zero, which is all the
    // submit path needs.
    querySelectorAll: (selector) => (String(selector).indexOf('#formPage input') === 0 ? [field] : []),
    createElement: (tag) => element('<' + tag + '>', log, {}),
    addEventListener: (type, fn) => { (onDocument[type] = onDocument[type] || []).push(fn); },
  };

  const held = () => {
    const img = elements.sigimg1;
    return !!(img && img.getAttribute('src'));
  };

  const sandbox = {
    console,
    document,
    CSS: { escape: (s) => String(s) },
    navigator: { clipboard: { writeText: async () => {} } },
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(key, String(value)); },
      removeItem: (key) => { store.delete(key); removals.push(key); },
    },
    Blob,
    FileReader: FileReaderStub,
    AbortController,
    fetch: async (url) => {
      requests.push(String(url));
      // The signature download, then the status read — answered as the service
      // answers both for a client who has signed.
      if (/\/signature$/.test(String(url))) {
        return {
          ok: true,
          status: 200,
          blob: async () => new Blob([Buffer.from('signature')], { type: 'image/png' }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ status: 'signed', signedAt: SIGNED[1].signedAt }) };
    },
    // No timer ever fires: a finished send must leave nothing pending behind it, and
    // the 20 s status poll has no part in any of this.
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 2,
    clearInterval: () => {},
    confirm: () => true,
    alert: () => {},
    print: () => {},
    location: { protocol: 'https:', href: 'https://itc-extractor.test/' },
    ITC_CONFIG: { signatureApiBase: BACKEND, fileNamePrefix: 'Khusela-Credit-Application' },
    ITCTracker: { clearStatus: () => log.push('tracker:clear') },
    ITCPdf: {
      generate: async () => {
        log.push('pdf:generate');
        marks.signatureInPdf = held();
        return new Blob([Buffer.alloc(pdfSize)], { type: 'application/pdf' });
      },
    },
    ITCEmail: {
      MAX_ATTACHMENT_BYTES: limit,
      MAX_ATTACHMENT_MB: limit / MB,
      send: async () => {
        log.push('email:send');
        marks.signatureAtSend = held();
        const reply = answer();
        if (reply === 'throw') throw new Error('the mail service died');
        return reply;
      },
    },
  };
  sandbox.window = sandbox;

  vm.runInNewContext(SIGNATURE_SRC, sandbox, { filename: 'js/signature.js' });
  vm.runInNewContext(APP_SRC, sandbox, { filename: 'js/app.js' });
  (onDocument.DOMContentLoaded || []).forEach((fn) => fn());

  return {
    store, removals, log, marks, requests, elements, field, window: sandbox,
    held,
    src: () => (elements.sigimg1 ? elements.sigimg1.getAttribute('src') : null),
    note: (n) => (elements['sigNote' + n] ? elements['sigNote' + n].textContent : ''),
    result: () => (elements.resultPanel ? elements.resultPanel.textContent : ''),
    // The section reads the status of a stored request without awaiting it, so the
    // microtasks it leaves behind are drained before anything is asserted.
    settle: async () => {
      for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve));
    },
    click: async (id) => {
      const el = elements[id];
      const handlers = (el && el.listeners.click) || [];
      if (!handlers.length) throw new Error('#' + id + ' has no click handler — has it been rewired?');
      await handlers[0]();
    },
  };
}

let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label +
    (ok ? '' : ' — got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected)));
}

(async () => {
  // ── 1. An application that goes takes its signature with it ────────────────
  // The consultant's report: the applicant had signed, the application was sent, and
  // the signature was still in the box afterwards — so the next client's PDF, built
  // from this same form, carried it. This page starts where that device was.
  const page = load({ state: SIGNED, draft: { name: 'Thandi' }, send: () => SUCCESS });
  await page.settle();

  check('a signature captured earlier is drawn back into the box on load', page.held(), true);
  check('it is the signature itself, not a placeholder', page.src(), SIGNATURE_IMAGE);
  check('and it had to be fetched back — never rebuilt locally', page.requests,
    [BACKEND + '/api/manage/tok-1', BACKEND + '/api/manage/tok-1/signature']);

  await page.click('btnSubmit');

  check('the PDF that was rendered still had the signature in the box',
    page.marks.signatureInPdf, true);
  check('it was still there when the application went to the mail service',
    page.marks.signatureAtSend, true);
  check('the box only went empty after the application had gone', page.log,
    ['tracker:clear', 'pdf:generate', 'email:send', 'sigimg1:src removed']);
  check('the box is empty now', page.held(), false);
  check('and the box says so, instead of just going quiet', page.note(1),
    'No signing link sent yet.');
  check('the record is gone from this device, not merely hidden',
    page.store.has(STORE_KEY), false);
  check('the draft and the form were left alone — a resend starts from the same form',
    [page.store.has(DRAFT_KEY), page.field.value], [true, 'Thandi']);
  check('and the only key the send removed was the signature record',
    page.removals, [STORE_KEY]);
  check('the consultant was told the box was cleared', page.result(),
    'Submitted successfully. The signature box has been cleared for the next application.');

  // "After submission I don't want the signature back" — a reload is the other way
  // it used to come back.
  const before = page.requests.length;
  page.window.ITCSignature.init();
  await page.settle();
  check('reloading the page does not bring the signature back', page.held(), false);
  check('and nothing is asked of the service for a signature that was let go',
    page.requests.length - before, 0);

  // ── 2. A send that failed must leave the signature alone ───────────────────
  // A failure is exactly the case that asks for a retry, and a retry with the
  // signature quietly gone would email an unsigned application.
  let reply = { ok: false, msg: 'Nothing was sent — the mail service could not be reached.' };
  const retry = load({ state: SIGNED, send: () => reply });
  await retry.settle();
  await retry.click('btnSubmit');

  check('a failed send leaves the signature in the box', retry.held(), true);
  check('and the record on the device where it was', retry.store.has(STORE_KEY), true);
  check('nothing was cleared and nothing was claimed', retry.log,
    ['tracker:clear', 'pdf:generate', 'email:send']);
  check('the consultant is told the application did not go', retry.result(), reply.msg);
  check('and is not told a box was cleared', /cleared/.test(retry.result()), false);

  // The retry is the send that counts — and it still has a signature to send.
  reply = SUCCESS;
  await retry.click('btnSubmit');

  check('the retry sent the signature, not an unsigned copy', retry.marks.signatureInPdf, true);
  check('and that send is the one that forgot it', retry.log,
    ['tracker:clear', 'pdf:generate', 'email:send',
      'tracker:clear', 'pdf:generate', 'email:send', 'sigimg1:src removed']);
  check('so the box is empty for the next applicant', retry.held(), false);
  check('with the record gone too', retry.store.has(STORE_KEY), false);

  // ── 3. A PDF that is never sent must not cost the signature either ─────────
  const tooBig = load({ state: SIGNED, send: () => SUCCESS, limit: 1 * MB, pdfSize: 2 * MB });
  await tooBig.settle();
  await tooBig.click('btnSubmit');

  check('an oversized PDF is rendered twice and never sent', tooBig.log,
    ['tracker:clear', 'pdf:generate', 'pdf:generate']);
  check('so the signature is still there', tooBig.held(), true);
  check('and nothing was claimed to have been cleared', /cleared/.test(tooBig.result()), false);
  check('the consultant is told nothing was sent', /Nothing was sent/.test(tooBig.result()), true);

  // ── 4. Nothing to forget: the message stays as the transport left it ───────
  // A first application with no signature at all, or an older js/signature.js that
  // still returns nothing from clear().
  const fresh = load({ send: () => SUCCESS });
  await fresh.click('btnSubmit');

  check('a send with no signature says nothing extra', fresh.result(), SUCCESS.msg);
  check('and changes nothing on the device', fresh.log,
    ['tracker:clear', 'pdf:generate', 'email:send']);
  check('with the box left as empty as it was', fresh.held(), false);

  console.log(failed ? 'signature reset FAILURES: ' + failed : 'signature reset OK');
  process.exit(failed ? 1 : 0);
})();
