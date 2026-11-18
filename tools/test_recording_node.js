// Regression test for the optional call-recording panel (js/recording.js).
//
// Loads the module into a stub page and checks the per-application rule that
// matters: a recording belongs to the application on screen, is visible in the
// PDF footer line, and is forgotten on clear. No browser and no network.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/recording.js'), 'utf8');
let pass = 0, fail = 0;
function check(name, actual, expected) {
 const ok = actual === expected;
 if (ok) { pass++; console.log('  ok   ' + name); }
 else { fail++; console.log('  FAIL ' + name + ' — got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected)); }
}

class El {
 constructor(tag, id) {
  this.tagName = String(tag || 'div').toUpperCase();
  this.id = id || '';
  this.children = [];
  this.listeners = {};
  this.hidden = false;
  this.value = '';
  this.textContent = '';
  this.style = {};
  this._html = '';
 }
 addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
 appendChild(c) { this.children.push(c); return c; }
 removeAttribute() {}
 setAttribute() {}
 getAttribute() { return null; }
 click() { (this.listeners.click || []).forEach((f) => f()); }
 set innerHTML(v) { this._html = v; if (v === '') this.children = []; }
 get innerHTML() { return this._html; }
}

function load(cfg, lookupRows) {
 const els = {};
 ['recordingPanel', 'recConsultant', 'recConsultantOptions', 'recDate', 'btnFindRecordings',
  'btnClearRecording', 'recordingStatus', 'recordingList', 'recordingSelected',
  'recordingSelectedName', 'recordingPreview', 'recordingPdfNote'].forEach((id) => { els[id] = new El('input', id); });
 const fetches = [];
 const audio = { size: 4321 };
 const sandbox = {
  console, Promise, Math, Date, URL,
  setTimeout, clearTimeout,
  localStorage: { getItem: () => '', setItem: () => {}, removeItem: () => {} },
  URL: Object.assign(function URL() {}, {
   createObjectURL: () => 'blob:preview',
   revokeObjectURL: () => {},
  }),
  document: {
   readyState: 'complete',
   getElementById: (id) => els[id] || null,
   createElement: (tag) => new El(tag),
  },
  fetch: async (url) => {
   fetches.push(url);
   if (url.indexOf('/api/recordings?') >= 0) {
    return { ok: true, status: 200, json: async () => ({ ok: true, rows: lookupRows }) };
   }
   return { ok: true, status: 200, blob: async () => audio };
  },
 };
 sandbox.window = sandbox;
 sandbox.ITC_CONFIG = cfg;
 vm.runInNewContext(SRC, sandbox, { filename: 'js/recording.js' });
 return { sandbox, els, fetches };
}

(async () => {
 const CFG = {
  signatureApiBase: 'https://backend.test/',
  vicidialConsultants: ['1001', { login: '1002', label: 'Alice' }],
 };
 const rows = [{
  start_time: '2026-11-18 10:11:12', recording_id: '534820', lead_id: '876409',
  duration: '63', filename: '20261118_101112_1001-all.mp3',
  audioUrl: 'https://backend.test/api/recordings/audio?location=x&signature=y',
 }];
 const { sandbox, els, fetches } = load(CFG, rows);
 const api = sandbox.ITCRecording;

 check('the panel is shown when a backend is configured', els.recordingPanel.hidden, false);
 check('the pick-list is filled from config', els.recConsultantOptions.children.length, 2);
 check('the date defaults to today', /^\d{4}-\d{2}-\d{2}$/.test(els.recDate.value), true);
 check('nothing is attached at first', api.hasRecording(), false);
 check('the PDF footer says none at first', els.recordingPdfNote.textContent, 'not provided');

 // A configured app with no backend must hide the whole feature.
 const bare = load({}, rows);
 check('with no backend the panel stays hidden', bare.els.recordingPanel.hidden, true);

 els.recConsultant.value = '1001';
 els.recDate.value = '2026-11-18';
 await api.find();
 check('the lookup goes to our backend, not Vicidial',
  fetches[0] === 'https://backend.test/api/recordings?agent=1001&date=2026-11-18', true);
 check('the found recording is rendered', els.recordingList.children.length, 1);
 const item = els.recordingList.children[0];
 const useBtn = item.children.find((c) => c.tagName === 'BUTTON');
 check('a Use this recording button is offered', !!useBtn, true);

 useBtn.click();
 await new Promise((r) => setTimeout(r, 0));
 check('choosing a recording attaches it to the application', api.hasRecording(), true);
 const att = api.getAttachment();
 check('the attachment carries the MP3 bytes', att && att.blob.size, 4321);
 check('the attachment carries the filename', att && att.filename, '20261118_101112_1001-all.mp3');
 check('the PDF footer now says attached', /^attached/.test(els.recordingPdfNote.textContent), true);
 check('the Clear button appears', els.btnClearRecording.hidden, false);

 api.clear();
 check('clear forgets the recording', api.hasRecording(), false);
 check('clear resets the PDF footer', els.recordingPdfNote.textContent, 'not provided');
 check('clear hides the Clear button again', els.btnClearRecording.hidden, true);
 check('clear empties the rendered list', els.recordingList.children.length, 0);

 // A failed lookup must not attach anything or clear an existing selection.
 const failing = load(CFG, rows);
 failing.sandbox.fetch = async () => { throw new Error('offline'); };
 failing.els.recConsultant.value = '1001';
 failing.els.recDate.value = '2026-11-18';
 await failing.sandbox.ITCRecording.find();
 check('a failed lookup attaches nothing', failing.sandbox.ITCRecording.hasRecording(), false);
 check('a failed lookup is explained on screen', /Could not look up recordings/.test(failing.els.recordingStatus.textContent), true);

 console.log(pass + ' passed, ' + fail + ' failed');
 process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
