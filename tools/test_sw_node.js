// Regression test for the caching strategy in sw.js.
//
// The bug this locks down was reported as a missing section: the site served the
// Signature chrome, but the worker was cache-first and kept answering with the page
// that device had cached, so the deploy never appeared. A worker cannot run in Node,
// so it is loaded into a stub global scope and its events are driven by hand.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://itc-extractor.test';
const swSrc = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const cacheName = (swSrc.match(/const CACHE = '([^']+)'/) || [])[1];

// ── A very small cache and network ──────────────────────────────────────────
const abs = (target) => new URL(typeof target === 'string' ? target : target.url, ORIGIN + '/').href;

function response(body, ok = true, status = 200) {
  return { body, ok, status, clone: () => response(body, ok, status) };
}

const store = new Map();   // url → response
const net = new Map();     // url → body | 'offline' | { status }
const reads = [];          // every network read, in order

const caches = {
  open: async () => ({
    addAll: async () => {},
    match: async (target) => store.get(abs(target)),
    put: async (target, res) => { store.set(abs(target), res); },
  }),
  keys: async () => [],
  delete: async () => true,
};

async function fetchStub(request) {
  const url = abs(request);
  reads.push(url);
  const entry = net.get(url);
  if (entry === undefined || entry === 'offline') throw new Error('offline');
  if (typeof entry === 'string') return response(entry, true, 200);
  return response('error page', entry.status < 400, entry.status);
}

// ── Load the worker ─────────────────────────────────────────────────────────
const listeners = {};
const sandbox = {
  URL,
  caches,
  fetch: fetchStub,
  Promise,
  setTimeout,
  clearTimeout,
  console,
  location: new URL(ORIGIN + '/sw.js'),
  self: {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  },
};
vm.runInNewContext(swSrc, sandbox, { filename: 'sw.js' });

const fire = (type) => {
  const waits = [];
  listeners[type]({ waitUntil: (p) => waits.push(p) });
  return Promise.all(waits);
};

async function request(url, mode) {
  let out;
  listeners.fetch({
    request: { url: abs(url), method: 'GET', mode: mode || 'no-cors' },
    respondWith: (p) => { out = p; },
  });
  return out;
}

let failed = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label + (ok ? '' : ' — got ' + actual + ', want ' + expected));
}

(async () => {
  await fire('install');

  // The reported failure: a cached page must not outrank the deployed one.
  store.set(abs('/index.html'), response('OLD-BUILD'));
  net.set(abs('/'), 'NEW-BUILD');
  const nav = await request('/', 'navigate');
  check('a navigation is fetched from the network, not from the cached page', nav.body, 'NEW-BUILD');
  check('the fresh page replaces the cached copy', store.get(abs('/')).body, 'NEW-BUILD');

  // Offline is still covered: the cached page, then the cached document.
  net.set(abs('/index.html'), 'offline');
  const offline = await request('/index.html', 'navigate');
  check('an offline visit is answered from the cache', offline.body, 'OLD-BUILD');
  const deepLink = await request('/deep/link', 'navigate');
  check('an uncached offline navigation falls back to the cached document', deepLink.body, 'OLD-BUILD');

  // The shell includes the configuration the signature buttons read.
  store.set(abs('/js/config.js'), response('OLD-CONFIG'));
  net.set(abs('/js/config.js'), 'NEW-CONFIG');
  const config = await request('/js/config.js');
  check('js/config.js is fetched from the network', config.body, 'NEW-CONFIG');

  // Everything else stays cache-first, so offline use is unchanged.
  store.set(abs('/vendor/pdf.min.js'), response('VENDOR-CACHED'));
  net.set(abs('/vendor/pdf.min.js'), 'VENDOR-FRESH');
  const before = reads.length;
  const vendor = await request('/vendor/pdf.min.js');
  check('a vendor library is served from the cache', vendor.body, 'VENDOR-CACHED');
  check('a vendor library does not touch the network', reads.length - before, 0);

  // A failed reply must not become that file's cached answer.
  net.set(abs('/js/app.js'), { status: 404 });
  const missingFile = await request('/js/app.js');
  check('a failed reply is passed through', missingFile.ok, false);
  check('a 404 is not cached', store.has(abs('/js/app.js')), false);

  // A missing asset would fail install, which is how a device keeps an old worker.
  const block = swSrc.slice(swSrc.indexOf('const ASSETS'), swSrc.indexOf('];', swSrc.indexOf('const ASSETS')));
  const assets = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const missingAssets = assets.filter((a) => !fs.existsSync(path.join(ROOT, a.split('?')[0])));
  check('every sw.js asset exists on disk (' + assets.length + ' entries)', missingAssets.join(',') || 'none', 'none');

  // Activating must drop the previous version, or the new cache is never adopted.
  const deleted = [];
  caches.keys = async () => ['khusela-itc-v29', cacheName];
  caches.delete = async (key) => { deleted.push(key); return true; };
  await fire('activate');
  check('activating deletes every other cache version', deleted.join(','), 'khusela-itc-v29');

  console.log(failed ? 'sw.js strategy FAILURES: ' + failed : 'sw.js strategy OK');
  process.exit(failed ? 1 : 0);
})();
