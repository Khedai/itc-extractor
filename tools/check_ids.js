// Cross-check: every DOM id referenced by the app's modules (js/app.js and
// js/signature.js) must exist in index.html.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const MODULES = ['js/app.js', 'js/signature.js'];

const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

let bad = 0;
console.log('HTML ids:', htmlIds.size);
MODULES.forEach((mod) => {
  const src = fs.readFileSync(path.join(ROOT, mod), 'utf8');
  const usedIds = new Set([...src.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));
  const missing = [...usedIds].filter((id) => !htmlIds.has(id));
  console.log(mod + ' references ' + usedIds.size + ' id(s)');
  if (missing.length) {
    console.error('MISSING IDs referenced in ' + mod + ':', missing);
    bad++;
  }
});

if (bad) process.exit(1);
console.log('All DOM references exist in index.html');
