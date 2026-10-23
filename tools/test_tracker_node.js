// Unit test for the Khusela Sales Tracker logic (js/tracker.js): the trimmed
// 12-column header set must be exactly the essential intake fields, buildRow()
// must map each source onto its correct column (leaving missing sources empty),
// and the export must be a real .xlsx workbook (a ZIP of the expected XML parts)
// whose sheet holds every tracker row.
// Run: node tools/test_tracker_node.js
const assert = require('assert');
const t = require('../js/tracker.js');

const { TRACKER_HEADERS, buildRow, toXlsx } = t;
const pass = (n) => console.log('PASS ' + n);

// ── Minimal ZIP reader for the stored (uncompressed) parts we write ────────
const readU16 = (b, p) => b[p] | (b[p + 1] << 8);
const readU32 = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
const decoder = new TextDecoder();

function unzip(buf) {
  const out = {};
  let pos = 0;
  while (pos + 4 <= buf.length && readU32(buf, pos) === 0x04034B50) {
    const method = readU16(buf, pos + 8);
    const csize = readU32(buf, pos + 18);
    const usize = readU32(buf, pos + 22);
    const nameLen = readU16(buf, pos + 26);
    const extraLen = readU16(buf, pos + 28);
    const name = decoder.decode(buf.subarray(pos + 30, pos + 30 + nameLen));
    const start = pos + 30 + nameLen + extraLen;
    out[name] = { method, data: buf.subarray(start, start + csize), size: usize };
    pos = start + csize;
  }
  return out;
}

// ── 1. The tracker keeps only the essential intake columns ────────────────
const expected = [
  'DATE', 'NAME', 'SURNAME', 'ID NUMBER', 'CELL', 'WHATSAPP', 'EMAIL',
  'APPLICATION TYPE', 'BANK', 'ACCOUNT NO', 'DEBIT ORDER DATE',
  'DEBIT ORDER AMOUNT',
];
assert.deepStrictEqual(TRACKER_HEADERS, expected, 'headers are the essential intake fields');
assert.strictEqual(TRACKER_HEADERS.length, 12, '12 columns');
pass(1);

// ── 2. buildRow maps every source to the right header, missing → '' ────────
const sources = {
  date: '2026-09-08', name: 'John Peter', surname: 'Doe',
  id: '8501011234087', cell: '071 000 0000', whatsapp: '', email: 'john@example.com',
  application_type: 'Debt Review', bank: 'FNB', account_no: 'CLIENT-1',
  debit_order_date: '2026-10-01', debit_order_amount: 'R 2 800,00',
  // Fields that are no longer part of the tracker must be ignored.
  address: '1 Main Rd', employer: 'ACME', marital_status: 'Married',
  gross_salary: '25000', total_balance: '100 000,00',
};
const row = buildRow(sources);
assert.strictEqual(row.NAME, 'John Peter');
assert.strictEqual(row.SURNAME, 'Doe');
assert.strictEqual(row['ID NUMBER'], '8501011234087');
assert.strictEqual(row.CELL, '071 000 0000');
assert.strictEqual(row.EMAIL, 'john@example.com');
assert.strictEqual(row['APPLICATION TYPE'], 'Debt Review');
assert.strictEqual(row.BANK, 'FNB');
assert.strictEqual(row['ACCOUNT NO'], 'CLIENT-1');
assert.strictEqual(row['DEBIT ORDER DATE'], '2026-10-01');
assert.strictEqual(row['DEBIT ORDER AMOUNT'], 'R 2 800,00');
assert.strictEqual(row.WHATSAPP, '');
assert.strictEqual(row.ADDRESS, undefined, 'ADDRESS is no longer tracked');
assert.strictEqual(row.EMPLOYER, undefined, 'EMPLOYER is no longer tracked');
assert.strictEqual(row['MARITAL STATUS'], undefined, 'MARITAL STATUS is no longer tracked');
assert.strictEqual(row['GROSS SALARY'], undefined, 'GROSS SALARY is no longer tracked');
assert.strictEqual(Object.keys(row).length, 12, 'row has exactly 12 keys');
pass(2);

// ── 3. buildRow with no sources → all columns empty ────────────────────────
const blank = buildRow(null);
TRACKER_HEADERS.forEach((h) => assert.strictEqual(blank[h], '', h + ' empty'));
pass(3);

// ── 4. The export is a real .xlsx package with the expected parts ──────────
const xlsx = toXlsx([buildRow(sources)]);
assert.ok(xlsx instanceof Uint8Array, 'workbook is bytes');
assert.deepStrictEqual(Array.from(xlsx.subarray(0, 4)), [0x50, 0x4B, 0x03, 0x04], 'starts with the ZIP signature');
const parts = unzip(xlsx);
[
  '[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml',
  'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml',
].forEach((name) => assert.ok(parts[name], name + ' is present'));
Object.keys(parts).forEach((name) => {
  assert.strictEqual(parts[name].method, 0, name + ' is stored uncompressed');
});
assert.ok(decoder.decode(parts['xl/workbook.xml'].data).includes('name="Tracker"'), 'sheet is named Tracker');
pass(4);

// ── 5. The sheet holds the header row and every tracker row ───────────────
const sheet = decoder.decode(parts['xl/worksheets/sheet1.xml'].data);
assert.strictEqual((sheet.match(/<row /g) || []).length, 2, 'header + one data row');
assert.strictEqual((sheet.match(/<c /g) || []).length, 24, '12 cells in each of two rows');
TRACKER_HEADERS.forEach((h, i) => {
  const ref = String.fromCharCode(65 + i) + '1';
  assert.ok(sheet.includes('<c r="' + ref + '" s="1"'), h + ' header at ' + ref);
});
assert.ok(sheet.includes('<t xml:space="preserve">John Peter</t>'));
assert.ok(sheet.includes('<t xml:space="preserve">Doe</t>'));
assert.ok(sheet.includes('<t xml:space="preserve">8501011234087</t>'));
assert.ok(sheet.includes('<t xml:space="preserve">071 000 0000</t>'));
assert.ok(sheet.includes('<t xml:space="preserve">Debt Review</t>'));
assert.ok(sheet.includes('<t xml:space="preserve">FNB</t>'));
assert.ok(sheet.includes('<t xml:space="preserve">CLIENT-1</t>'));
assert.ok(sheet.includes('<t xml:space="preserve">2026-10-01</t>'));
assert.ok(sheet.includes('<t xml:space="preserve">R 2 800,00</t>'));
pass(5);

// ── 6. Every stored row is written, with XML-escaped values ────────────────
const second = buildRow({ ...sources, name: 'Nomsa & <Co>', surname: 'Dlamini' });
const multi = unzip(toXlsx([buildRow(sources), second]));
const multiSheet = decoder.decode(multi['xl/worksheets/sheet1.xml'].data);
assert.strictEqual((multiSheet.match(/<row /g) || []).length, 3, 'header + two data rows');
assert.ok(multiSheet.includes('Nomsa &amp; &lt;Co&gt;'), 'ampersands and angle brackets are escaped');
assert.ok(multiSheet.includes('Dlamini'), 'second client is in the workbook');
pass(6);

console.log('\nALL TRACKER TESTS PASSED');
