// Unit test for the tracker export logic (js/tracker.js): column matching,
// skip-when-no-column, create-when-empty, R-prefixed amount, and a full
// SheetJS round-trip.
// Run: node tools/test_tracker_node.js
const assert = require('assert');
const XLSX = require('../vendor/xlsx.full.min.js');
const tracker = require('../js/tracker.js');

const { FIELD_DEFS, matchColumns, appendRows, formatAmount } = tracker;
const pass = (n) => console.log('PASS ' + n);

// ── 1. Full header → every field maps to the right column ─────────────────
const header = ['First Name', 'Last Name', 'ID Number', 'Account No', 'Cell', 'Title', 'Amount'];
const assigned = matchColumns(header, FIELD_DEFS);
assert.strictEqual(assigned.get('name'), 0, 'name -> First Name');
assert.strictEqual(assigned.get('surname'), 1, 'surname -> Last Name');
assert.strictEqual(assigned.get('id'), 2, 'id -> ID Number');
assert.strictEqual(assigned.get('account'), 3, 'account -> Account No');
assert.strictEqual(assigned.get('phone'), 4, 'phone -> Cell');
assert.strictEqual(assigned.get('title'), 5, 'title -> Title');
assert.strictEqual(assigned.get('amount'), 6, 'amount -> Amount');
assert.strictEqual(assigned.size, 7, 'all 7 fields assigned');
pass(1);

// ── 2. No Title column → title skipped, everything else still matched ─────
const header2 = ['Name', 'Surname', 'ID', 'Cellphone', 'Amount'];
const assigned2 = matchColumns(header2, FIELD_DEFS);
assert.ok(!assigned2.has('title'), 'title has no column and is skipped');
assert.strictEqual(assigned2.get('name'), 0);
assert.strictEqual(assigned2.get('surname'), 1);
assert.strictEqual(assigned2.get('id'), 2);
assert.strictEqual(assigned2.get('phone'), 3);
pass(2);

// ── 3. Empty sheet → all columns created, values appended, R on amount ────
const values = { name: 'John', surname: 'Doe', id: '8501011234087', account: 'ACC1', phone: '071 000 0000', title: 'Mr', amount: 'R 500' };
let res = appendRows([], values, FIELD_DEFS);
assert.deepStrictEqual(res.report.created, FIELD_DEFS.map((f) => f.label), 'all columns created');
assert.deepStrictEqual(res.report.matched, [], 'nothing matched existing columns');
assert.deepStrictEqual(res.report.skipped, [], 'nothing skipped');
assert.strictEqual(res.report.rowIndex, 2, 'appended row is row 2');
assert.deepStrictEqual(res.rows[0], ['Name', 'Surname', 'ID Number', 'Account Number', 'Phone Number', 'Title', 'Amount']);
assert.deepStrictEqual(res.rows[1], ['John', 'Doe', '8501011234087', 'ACC1', '071 000 0000', 'Mr', 'R 500']);
pass(3);

// ── 4. Existing sheet → append at the bottom; amount uses the formatted value ──
let res4 = appendRows(
  [['Name', 'Surname', 'Amount'], ['Jane', 'Smith', 'R 100']],
  { name: 'John', surname: 'Doe', amount: formatAmount('4500') },
  FIELD_DEFS,
);
assert.deepStrictEqual(res4.report.matched, ['Name', 'Surname', 'Amount'], 'matched columns reported');
assert.deepStrictEqual(res4.report.skipped, ['ID Number', 'Account Number', 'Phone Number', 'Title'], 'missing columns skipped');
assert.strictEqual(res4.report.rowIndex, 3);
assert.deepStrictEqual(res4.rows[2], ['John', 'Doe', 'R 4500']);
pass(4);

// ── 5. formatAmount: bare number gets R prefix, existing R kept, empty → "R" ──
assert.strictEqual(formatAmount('4500'), 'R 4500', 'bare number prefixed');
assert.strictEqual(formatAmount('R 4500'), 'R 4500', 'existing R kept');
assert.strictEqual(formatAmount('  R 4500.00 '), 'R 4500.00', 'trimmed existing R kept');
assert.strictEqual(formatAmount(''), 'R', 'empty → bare R');
assert.strictEqual(formatAmount(null), 'R', 'null → bare R');

// ── 6. No amount at all → amount column still gets the bare "R" ───────────
let res5 = appendRows([['Name', 'Surname', 'Amount'], ['A', 'B', 'R 1']], { name: 'C', surname: 'D', amount: formatAmount('') }, FIELD_DEFS);
assert.strictEqual(res5.rows[2][2], 'R', 'bare R written into the amount column');
pass(5);
pass(6);

// ── 7. Unrelated headers → clear error, nothing appended ──────────────────
let res6 = appendRows([['Foo', 'Bar'], ['x', 'y']], values, FIELD_DEFS);
assert.ok(res6.report.error && res6.report.error.indexOf('No matching columns') === 0, 'error surfaced');
assert.strictEqual(res6.rows.length, 2, 'no row appended on no-match');
pass(7);

// ── 8. Full SheetJS round-trip (CSV in → xlsx out → read back) ────────────
const wb = XLSX.read(new Uint8Array(new TextEncoder().encode('Name,Surname,Amount\nOld,Entry,200\n')).buffer, { type: 'array' });
const sheetName = wb.SheetNames[0];
const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
const r7 = appendRows(rows, { name: 'New', surname: 'Person', amount: formatAmount('900') }, FIELD_DEFS);
wb.Sheets[sheetName] = XLSX.utils.aoa_to_sheet(r7.rows);
const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
const wb2 = XLSX.read(out, { type: 'array' });
const rowsBack = XLSX.utils.sheet_to_json(wb2.Sheets[sheetName], { header: 1, defval: '' });
assert.deepStrictEqual(rowsBack, [['Name', 'Surname', 'Amount'], ['Old', 'Entry', 200], ['New', 'Person', 'R 900']]);
pass(8);

console.log('\nALL TRACKER TESTS PASSED');
