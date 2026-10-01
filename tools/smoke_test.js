// Smoke test: every src/href referenced by index.html must exist on disk,
// then serve the folder over HTTP and fetch the key entry points.
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
const missing = refs.filter((r) => {
  if (/^(https?:|data:|blob:)/.test(r)) return false;
  const p = path.join(ROOT, r.split('?')[0]);
  return !fs.existsSync(p);
});
if (missing.length) {
  console.error('MISSING ASSETS:', missing);
  process.exit(1);
}
console.log('Referenced assets OK (' + refs.length + ' references)');

// ── Editable-field check ───────────────────────────────────────────────────
// The ITC review panel is filled in by hand when the consultant has no Datanamix
// report to extract (those boxes used to be readonly, so every keystroke was
// silently swallowed and "I can't put my name and details in to test" was the
// only thing the page did about it), and the applicant fields the signing link
// is built from must stay typeable. Plain assertions — this file has no deps.
let domFail = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) domFail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label +
    (ok ? '' : ' — got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected)));
}

function tagFor(id) {
  return (html.match(new RegExp('<input\\b[^>]*\\bid="' + id + '"[^>]*>')) || [''])[0];
}

const REVIEW_IDS = [
  'itcReportRefView', 'itcSearchDateView', 'itcSecondNameView', 'itcMaidenView',
  'itcTitleView', 'itcGenderView', 'itcBirthView', 'itcHomeView', 'itcWorkView',
  'itcPostalView', 'itcScoreView', 'itcRiskView', 'itcDebtReviewView',
  'itcTotalInstView', 'itcTotalDebtView', 'itcTotalArrearsView',
];
check('the review panel still has all 16 boxes',
  REVIEW_IDS.filter((id) => tagFor(id)).length, 16);
check('no review box is readonly or disabled',
  REVIEW_IDS.filter((id) => /readonly|disabled/.test(tagFor(id))).join(','), '');
check('the on-screen-only hint is shown to the user', /class="itc-hint"/.test(html), true);

// The fields a signing link is built from (js/signature.js clientDetails()).
['name', 'surname', 'id', 'cell', 'whatsapp', 'email'].forEach((id) => {
  const tag = tagFor(id);
  check('"' + id + '" exists', tag.length > 0, true);
  check('"' + id + '" is editable', /readonly|disabled/.test(tag), false);
});

// Only the two genuinely derived totals may stay locked out of every input on
// the page (the loans "reduced instalment" column is derived too, but it is
// built in js/app.js, not here).
const lockedIds = [...html.matchAll(/<input\b[^>]*>/g)]
  .filter((m) => /\sreadonly(?=[\s>])/.test(m[0]))
  .map((m) => (m[0].match(/\bid="([^"]+)"/) || [null, '(no id)'])[1])
  .sort();
check('only the calculated fields remain readonly', lockedIds.join(','), 'debitOrderAmount,expenseTotal');
console.log(domFail === 0 ? 'Editable-field check OK' : 'Editable-field FAILURES: ' + domFail);

// ── Static server smoke test ───────────────────────────────────────────────
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/manifest+json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, decodeURIComponent(p));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(0, async () => {
  const port = server.address().port;
  const urls = ['/', '/index.html', '/css/styles.css', '/js/app.js', '/js/itcParser.js', '/js/tracker.js', '/js/signature.js', '/js/config.js', '/manifest.webmanifest', '/sw.js', '/vendor/pdf.min.js', '/vendor/pdf.worker.min.js', '/vendor/html2canvas.min.js', '/vendor/jspdf.umd.min.js', '/logo.png', '/icons/icon-192.png'];
  let bad = 0;
  for (const u of urls) {
    const code = await new Promise((resolve) => {
      const r = http.get({ host: '127.0.0.1', port, path: u }, (res) => { res.resume(); resolve(res.statusCode); });
      r.on('error', () => resolve(0));
    });
    if (code !== 200) { bad++; console.log('FAIL ' + code + '  ' + u); }
  }
  server.close();
  console.log(bad === 0 ? 'HTTP smoke test OK (' + urls.length + ' URLs all 200)' : 'HTTP smoke test FAILURES: ' + bad);
  process.exit((bad || domFail) ? 1 : 0);
});
