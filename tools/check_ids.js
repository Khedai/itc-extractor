// Cross-check: every DOM id referenced by js/app.js must exist in index.html.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');

const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const usedIds = new Set([...app.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));

const missing = [...usedIds].filter((id) => !htmlIds.has(id));
console.log('HTML ids:', htmlIds.size, '| ids referenced by app.js:', usedIds.size);
if (missing.length) {
  console.error('MISSING IDs referenced in app.js:', missing);
  process.exit(1);
}
console.log('All app.js DOM references exist in index.html');
