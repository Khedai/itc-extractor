// Regression test for the Client Digital Signing panels.
//
// What the panels replaced: the Send/Copy buttons used to sit under each
// signature box, and one press created a link, copied it and opened WhatsApp.
// That could not work for a second signer, for a client who wants e-mail, or for
// a corrected number — and the note that said what had happened was overwritten
// by the status line the instant it was written (generate() called render(),
// which recomputed "Waiting for the signature…" over it), so the confirmation was
// never seen. The panels fix all three, and this test is what holds them there.
//
// js/signature.js is a browser IIFE, so it is loaded into a stub global scope: a
// DOM just large enough for the panels and the signature boxes, an in-memory
// localStorage, a fetch() that answers the signature service, and a window.open
// that records what it was asked to open instead of opening anything. No browser
// and no network.
// Run: node tools/test_signing_link_node.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/signature.js'), 'utf8');
const BACKEND = 'https://khusela-signature-backend.test';
const STORE_KEY = 'khusela-itc-signatures-v1';
const LINK = 'https://sign.khusela.test/s/one-time-link';
const EXPIRES = '2026-10-20T09:00:00Z';

// ── The stub page ────────────────────────────────────────────────────────────
function element(id) {
  const attrs = {};
  return {
    id,
    value: '',
    textContent: '',
    className: '',
    hidden: false,
    disabled: false,
    listeners: {},
    focused: 0,
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener() {},
    appendChild(child) { return child; },
    closest() { return null; },
    focus() { this.focused++; },
    setAttribute(name, value) { attrs[name] = String(value); },
    getAttribute(name) { return name in attrs ? attrs[name] : null; },
    removeAttribute(name) { delete attrs[name]; },
    attrs,
  };
}

// opts.form   — what the applicant fields hold (name/surname/id/cell/whatsapp/
//               email/spouse_*), as an ITC extraction or a typed form would
// opts.panel  — what the panel boxes already hold, i.e. a consultant's edits
// opts.notify — what POST /api/notify/email answers; 'throw' is a failed send
// opts.clipboard — 'deny' makes the clipboard refuse, as a non-https page does
// opts.open   — what window.open answers (null = popup blocked)
// opts.base   — signatureApiBase; empty leaves the whole feature inert
function load(opts) {
  const o = opts || {};
  const store = new Map();
  const calls = [];
  const opened = [];
  const copied = [];
  const elements = {};

  // The applicant fields. In index.html each of these is ONE element carrying
  // both an id and a name, and js/signature.js reaches them either way, so they
  // are modelled as one object per field rather than two stubs that could drift
  // apart — a stub that answers from a different object for getElementById than
  // for [name="…"] reads as an empty form and fails every test for the wrong
  // reason.
  const fields = {};
  ['name', 'surname', 'id', 'cell', 'whatsapp', 'email',
    'spouse_name', 'spouse_surname', 'spouse_id', 'spouse_email', 'spouse_cell',
    'spouse_whatsapp'].forEach((name) => {
    fields[name] = { name, value: '', type: 'text', readOnly: false, closest: () => null };
  });

  const get = (id) => fields[id] || (elements[id] || (elements[id] = element(id)));
  const formEl = (name) => fields[name];
  const panelEl = (id) => get(id);

  const document = {
    readyState: 'loading',
    getElementById: get,
    querySelector: (sel) => {
      const m = /\[name="([^"]+)"\]/.exec(sel);
      return m ? fields[m[1]] || null : null;
    },
    querySelectorAll: () => [],
    createElement: (tag) => element('<' + tag + '>'),
    addEventListener() {},
  };

  const sandbox = {
    console,
    document,
    // Every request the module makes is given a deadline with an AbortController,
    // so a stub page without one fails inside that code and the error is reported
    // as a message on the panel rather than as an exception here.
    AbortController,
    navigator: {
      clipboard: {
        writeText: async (text) => {
          if (o.clipboard === 'deny') throw new Error('blocked');
          copied.push(text);
        },
      },
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    window: null,
    open: (url) => {
      opened.push(url);
      return o.open === null ? null : { closed: false };
    },
    fetch: async (url, init) => {
      const body = init && init.body ? JSON.parse(init.body) : null;
      calls.push({ url: String(url), method: (init && init.method) || 'GET', body });
      if (/\/api\/invite$/.test(String(url))) {
        return {
          ok: true, status: 200,
          json: async () => ({
            ok: true, invitationId: 'inv-1', manageToken: 'tok-1',
            signingLink: LINK, expiresAt: EXPIRES,
          }),
        };
      }
      if (/\/api\/notify\/email$/.test(String(url))) {
        if (o.notify === 'throw') return { ok: false, status: 502, json: async () => ({ error: 'The signing link could not be emailed: the mail server refused it' }) };
        if (o.notify === 'unconfigured') return { ok: false, status: 503, json: async () => ({ error: 'email_not_configured', message: 'no mailbox' }) };
        return { ok: true, status: 200, json: async () => ({ ok: true, accepted: true, messageId: 'm-1' }) };
      }
      return { ok: true, status: 200, json: async () => ({ status: 'pending', expiresAt: EXPIRES }) };
    },
    // No timer ever fires: the 20 s status poll has no part in any of this.
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 2,
    clearInterval: () => {},
    location: { protocol: 'https:', href: 'https://itc-extractor.test/' },
    ITC_CONFIG: { signatureApiBase: o.base === undefined ? BACKEND : o.base },
  };
  sandbox.window = sandbox;
  // window.open has to be the sandbox's own, since the module calls window.open.
  sandbox.window.open = sandbox.open;

  vm.runInNewContext(SRC, sandbox, { filename: 'js/signature.js' });
  (document.readyState = 'complete');
  // init() ran on DOMContentLoaded inside the module; drive it directly so the
  // test does not depend on the stub's listener plumbing.
  sandbox.ITCSignature.init();

  // What the applicant form holds.
  const form = Object.assign({
    name: 'Thandi', surname: 'Mokoena', id: '9001015800085',
    cell: '0821234567', whatsapp: '', email: 'thandi@example.com',
    spouse_name: 'Sipho', spouse_surname: 'Mokoena', spouse_id: '8001015000088',
    spouse_email: 'sipho@example.com', spouse_cell: '', spouse_whatsapp: '0715551234',
  }, o.form || {});
  Object.keys(form).forEach((name) => { if (fields[name]) fields[name].value = form[name]; });

  // What the consultant already typed into the panels. Keyed by slot, so a test
// can say "the phone box in panel 1 already holds this" without going near the
// element ids.
const panelValues = o.panel || {};
  { const ids = { phone1: 'sigPhone1', mail1: 'sigMail1', phone2: 'sigPhone2', mail2: 'sigMail2' };
  Object.keys(ids).forEach((key) => {
    if (panelValues[key] !== undefined) panelEl(ids[key]).value = panelValues[key];
  }); }
  if (o.prefill) sandbox.ITCSignature.prefill();

  return {
    store, calls, opened, copied, elements, fields, window: sandbox,
    panelEl, formEl,
    // The first request of a session is a /health read that wakes a sleeping
    // instance (see js/signature.js), so the calls are looked up by route rather
    // than by position.
    invite: () => calls.find((c) => /\/api\/invite$/.test(c.url)) || null,
    notify: () => calls.find((c) => /\/api\/notify\/email$/.test(c.url)) || null,
    link: (n) => panelEl('sigLink' + n).value,
    note: (n) => panelEl('sigNote' + n).textContent,
    noteKind: (n) => panelEl('sigNote' + n).className,
    panelHidden: (n) => !!panelEl('signingPanel' + n).hidden,
    hidden: (id) => !!panelEl(id).hidden,
    press: async (id) => {
      const el = panelEl(id);
      const handlers = el.listeners.click || [];
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
  // ── 1. Generate: one link, shown in the box and copied ─────────────────────
  const page = load({});
  await page.press('genSig1');

  check('the link is created through the backend', page.invite().url, BACKEND + '/api/invite');
  check('after a plain read that wakes the service',
    page.calls[0].url, BACKEND + '/health');
  check('and it is written exactly once, so no second invitation is left behind',
    page.calls.filter((c) => /\/api\/invite$/.test(c.url)).length, 1);
  check('it is shown in the panel\'s own box, not left in a message', page.link(1), LINK);
  check('and copied to the clipboard', page.copied, [LINK]);
  check('the confirmation is the visible line, not the status line',
    page.note(1), 'Link created and copied — send it to Applicant 1 with WhatsApp or email.');
  check('and it is styled as a success', /ok/.test(page.noteKind(1)), true);
  check('the other panel is untouched by it', page.link(2), '');
  check('the link was stored on this device',
    JSON.parse(page.store.get(STORE_KEY))[1].signingLink, LINK);
  check('the invite carried the form\'s number and email', page.invite().body.phone, '0821234567');
  check('with the email that will receive the link', page.invite().body.email, 'thandi@example.com');

  // ── 2. Send via WhatsApp: one click, the link pre-typed ────────────────────
  await page.press('waSig1');
  check('WhatsApp is opened for the number on the form', page.opened.length, 1);
  check('as a wa.me link with the number in international form',
    page.opened[0].startsWith('https://wa.me/27821234567?text='), true);
  check('carrying a message with the signing link in it',
    decodeURIComponent(page.opened[0]).indexOf(LINK) >= 0, true);
  check('that names the applicant', /Hi Thandi Mokoena/.test(decodeURIComponent(page.opened[0])), true);
  check('and says what it is', /please sign here/.test(decodeURIComponent(page.opened[0])), true);
  check('nothing was emailed by pressing it', page.notify(), null);
  check('and the consultant is told to press Send there', page.note(1),
    'WhatsApp opened with the link — press Send there.');

  // A number typed into the panel wins over the form's.
  const corrected = load({ panel: { phone1: '+27 82 999 0000' } });
  await corrected.press('genSig1');
  check('a number corrected in the panel is the one the link was created for',
    corrected.invite().body.phone, '+27 82 999 0000');
  await corrected.press('waSig1');
  check('and the one dialled',
    corrected.opened[0].startsWith('https://wa.me/27829990000?text='), true);

  // A popup blocker is a message, not a failure: the link is still in the box.
  const blocked = load({ open: null });
  await blocked.press('genSig1');
  await blocked.press('waSig1');
  check('a blocked popup says so instead of pretending it sent', /blocked/i.test(blocked.note(1)), true);
  check('and the link is still there to copy', blocked.link(1), LINK);

  // No number at all: nothing is dialled, and the box says what to do.
  const noNumber = load({ form: { cell: '', whatsapp: '' } });
  await noNumber.press('genSig1');
  await noNumber.press('waSig1');
  check('with no number on the form nothing is opened', noNumber.opened.length, 0);
  check('and the panel says where to put one',
    noNumber.note(1), 'Enter the client\'s cell or WhatsApp number in this panel first.');
  check('which focuses the box itself', noNumber.panelEl('sigPhone1').focused, 1);

  // ── 3. Send via Email: the backend mails it, nothing is pasted ─────────────
  // ── 3. Send via Email: a redirect, not a server-side send ───────────────────
await page.press('mailSig1');
const mailto = page.opened[page.opened.length - 1] || '';
check('it opens a mailto: rather than posting anywhere', mailto.startsWith('mailto:'), true);
check('addressed to the client', decodeURIComponent(mailto).indexOf('mailto:thandi@example.com') === 0, true);
const mailBody = decodeURIComponent(mailto.split('&body=')[1] || '');
check('with the signing link already written', mailBody.indexOf(LINK) >= 0, true);
check('greeting the client by name', /Hi Thandi Mokoena/.test(mailBody), true);
check('saying what to do and that signing is once only',
  /draw your signature/.test(mailBody) && /only sign once/.test(mailBody), true);
check('and a subject line about the signing link',
  /subject=Khusela%3A%20your%20signing%20link/.test(mailto), true);
check('nothing was sent to the signing service for it', page.notify(), null);
check('the only thing the service was asked for is the link itself',
  page.calls.filter((c) => /\/api\//.test(c.url)).length, 1);
check('and the consultant is told to press Send there', page.note(1),
  'Your email app opened with the link ready for thandi@example.com — press Send there.');

  // An address that is not an address is refused before any window opens.
  const noMail = load({ panel: { mail1: 'not-an-address' } });
  await noMail.press('genSig1');
  await noMail.press('mailSig1');
  check('an address that is not one stops it', noMail.opened.length, 0);
  check('and says what is missing', noMail.note(1),
    'Enter the client\'s email address in this panel first.');
  check('focusing the box that was wrong', noMail.panelEl('sigMail1').focused, 1);

  // A client who only has a number is still fine: the link is made regardless.
  const waOnly = load({ form: { email: '' } });
  await waOnly.press('genSig1');
  check('a link is generated with no email on the form at all', waOnly.link(1), LINK);
  check('and WhatsApp still works for them', (await (async () => {
    await waOnly.press('waSig1');
    return waOnly.opened[0] || '';
  })()).startsWith('https://wa.me/27821234567?text='), true);

  // Neither send button does anything without a link to send.
  const barePanel = load({});
  await barePanel.press('waSig1');
  check('with no link generated, WhatsApp refuses', barePanel.note(1), 'Generate a signing link first.');
  check('and opens nothing', barePanel.opened.length, 0);
  await barePanel.press('mailSig1');
  check('email refuses in the same words', barePanel.note(1), 'Generate a signing link first.');
  check('without calling anything', barePanel.calls.length, 0);

  // ── 4. Copy Link, and the clipboard being unavailable ──────────────────────
  const denied = load({ clipboard: 'deny' });
  await denied.press('genSig1');
  check('a blocked clipboard still leaves the link in the box', denied.link(1), LINK);
  check('and the confirmation does not claim it was copied',
    denied.note(1), 'Link created — send it to Applicant 1 with WhatsApp or email.');
  await denied.press('copySig1');
  check('Copy Link says where the link is instead', denied.note(1),
    'The link is in the box above — copy it from there.');

  const copyable = load({});
  await copyable.press('genSig1');
  await copyable.press('copySig1');
  check('Copy Link copies it again on demand', copyable.copied.length, 2);
  check('and says so', copyable.note(1), 'Signing link copied.');
  check('the send buttons are hidden until there is something to send',
    [copyable.hidden('copySig1'), copyable.hidden('waSig1'), copyable.hidden('mailSig1')], [false, false, false]);
  const empty = load({});
  check('and shown, so they are never pressed for nothing',
    [empty.hidden('copySig1'), empty.hidden('waSig1'), empty.hidden('mailSig1')], [true, true, true]);

  // ── 5. Prefill: the extractor fills the form, the panels follow ────────────
  const fresh = load({});
  check('an empty panel is not filled until prefill runs', fresh.panelEl('sigPhone1').value, '');
  fresh.window.ITCSignature.prefill();
  check('the number the extractor found is in the panel', fresh.panelEl('sigPhone1').value, '0821234567');
  check('and the email', fresh.panelEl('sigMail1').value, 'thandi@example.com');
  check('panel 2 takes the spouse\'s details', [
    fresh.panelEl('sigPhone2').value, fresh.panelEl('sigMail2').value,
  ], ['0715551234', 'sipho@example.com']);

  // A number the consultant corrected must survive the next prefill.
  const kept = load({ panel: { phone1: '0798887777' } });
  kept.window.ITCSignature.prefill();
  check('a corrected number is never overwritten by a later prefill',
    kept.panelEl('sigPhone1').value, '0798887777');

  // ── 6. Panel 2 is a request of its own ─────────────────────────────────────
  const two = load({});
  await two.press('genSig2');
  check('panel 2 creates its own request', two.invite().body.signerLabel, 'Applicant 2');
  check('with the spouse\'s number', two.invite().body.phone, '0715551234');
  check('and the spouse\'s email', two.invite().body.email, 'sipho@example.com');
  check('and the spouse\'s name', two.invite().body.clientName, 'Sipho Mokoena');
  check('and the spouse\'s ID', two.invite().body.idNumber, '8001015000088');
  check('panel 1 is still empty', two.link(1), '');
  await two.press('waSig2');
  check('its WhatsApp goes to the spouse', two.opened[0].startsWith('https://wa.me/27715551234?text='), true);

  // ── 7. Nothing configured: the feature is inert, not broken ────────────────
  const off = load({ base: '' });
  check('the panels are hidden with no signing service configured', off.panelHidden(1), true);
  check('and the second one too', off.panelHidden(2), true);
  check('no link is created by pressing one anyway', off.calls.length, 0);
  check('the button exists to be pressed, so the failure is explained',
    off.elements.genSig1.listeners.click.length > 0, true);

  // ── 8. New Application: the panel goes with the application ────────────────
  const cleared = load({});
  await cleared.press('genSig1');
  check('there is a link to forget', cleared.link(1), LINK);
  const forgotten = cleared.window.ITCSignature.clear();
  check('clearing reports what it forgot', forgotten, 1);
  check('the link is gone from the box', cleared.link(1), '');
  check('and this applicant\'s number with it', cleared.panelEl('sigPhone1').value, '');
  check('and their email', cleared.panelEl('sigMail1').value, '');
  check('the record is off this device', cleared.store.has(STORE_KEY), false);
  cleared.window.ITCSignature.prefill();
  check('the next applicant\'s form fills the panel again',
    cleared.panelEl('sigPhone1').value, '0821234567');

  console.log(failed ? 'signing panel FAILURES: ' + failed : 'signing panel OK');
  process.exit(failed ? 1 : 0);
})();