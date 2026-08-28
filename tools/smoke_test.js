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

// Static server smoke test
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
  const urls = ['/', '/index.html', '/css/styles.css', '/js/app.js', '/js/itcParser.js', '/manifest.webmanifest', '/sw.js', '/vendor/pdf.min.js', '/vendor/pdf.worker.min.js', '/vendor/html2canvas.min.js', '/vendor/jspdf.umd.min.js', '/logo.png', '/icons/icon-192.png'];
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
  process.exit(bad ? 1 : 0);
});
