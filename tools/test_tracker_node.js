// Unit test for the Khusela Sales Tracker logic (js/tracker.js): the 35-column
// header set must match the original tracker exactly, buildRow() must map each
// source onto its correct column (leaving missing sources empty), and the CSV
// serialisation must quote/escape like the original.
// Run: node tools/test_tracker_node.js
const assert = require('assert');
const t = require('../js/tracker.js');

const { TRACKER_HEADERS, buildRow, csvCell, toCsv } = t;
const pass = (n) => console.log('PASS ' + n);

// ── 1. The 35 headers match the original Khusela tracker exactly ──────────
const expected = [
  'DATE', 'CONSULTANT', 'BRANCH', 'NAME', 'SURNAME', 'ID NUMBER',
  'CELL', 'WHATSAPP', 'EMAIL', 'SPOUSE NAME', 'SPOUSE SURNAME',
  'SPOUSE ID', 'SPOUSE CELL', 'SPOUSE WHATSAPP', 'SPOUSE EMAIL',
  'ADDRESS', 'EMPLOYER', 'APPLICATION TYPE', 'DEBT REVIEW STATUS',
  'MARITAL STATUS', 'BANK', 'ACCOUNT NO', 'ACCOUNT TYPE', 'DR STATUS',
  'GROSS SALARY', 'NETT SALARY', 'SPOUSE SALARY', 'TOTAL BALANCE',
  'CURRENT INSTALMENT', 'REDUCED INSTALMENT', 'DEBIT ORDER DATE',
  'DEBIT ORDER AMOUNT', 'OWN AMOUNT', 'TIME OF CALL', 'EXT NUMBER',
];
assert.deepStrictEqual(TRACKER_HEADERS, expected, 'headers match original tracker');
assert.strictEqual(TRACKER_HEADERS.length, 35, '35 columns');
pass(1);

// ── 2. buildRow maps every source to the right header, missing → '' ────────
const sources = {
  date: '2026-09-08', consultant: '', branch: '', name: 'John Peter',
  surname: 'Doe', id: '8501011234087', cell: '071 000 0000', whatsapp: '',
  email: 'john@example.com', spouse_name: '', spouse_surname: '',
  spouse_id: '', spouse_cell: '', spouse_whatsapp: '', spouse_email: '',
  address: '1 Main Rd', employer: 'ACME', application_type: 'Debt Review',
  debt_review_status: '', marital_status: 'Married', bank: '',
  account_no: 'CLIENT-1', account_type: '', dr_status: '',
  gross_salary: '25000', nett_salary: '21000', spouse_salary: '',
  total_balance: '100 000,00', current_instalment: '4 000,00',
  reduced_instalment: '2 800,00', debit_order_date: '2026-10-01',
  debit_order_amount: 'R 2 800,00', own_amount: '', call_time: '', ext_number: '',
};
const row = buildRow(sources);
assert.strictEqual(row.NAME, 'John Peter');
assert.strictEqual(row.SURNAME, 'Doe');
assert.strictEqual(row['ID NUMBER'], '8501011234087');
assert.strictEqual(row.CELL, '071 000 0000');
assert.strictEqual(row.EMAIL, 'john@example.com');
assert.strictEqual(row.ADDRESS, '1 Main Rd');
assert.strictEqual(row.EMPLOYER, 'ACME');
assert.strictEqual(row['APPLICATION TYPE'], 'Debt Review');
assert.strictEqual(row['MARITAL STATUS'], 'Married');
assert.strictEqual(row['ACCOUNT NO'], 'CLIENT-1');
assert.strictEqual(row['GROSS SALARY'], '25000');
assert.strictEqual(row['NETT SALARY'], '21000');
assert.strictEqual(row['TOTAL BALANCE'], '100 000,00');
assert.strictEqual(row['CURRENT INSTALMENT'], '4 000,00');
assert.strictEqual(row['REDUCED INSTALMENT'], '2 800,00');
assert.strictEqual(row['DEBIT ORDER DATE'], '2026-10-01');
assert.strictEqual(row['DEBIT ORDER AMOUNT'], 'R 2 800,00');
assert.strictEqual(row.CONSULTANT, '');
assert.strictEqual(row.BRANCH, '');
assert.strictEqual(row.WHATSAPP, '');
assert.strictEqual(row['SPOUSE NAME'], '');
assert.strictEqual(row.BANK, '');
assert.strictEqual(row['ACCOUNT TYPE'], '');
assert.strictEqual(row['DR STATUS'], '');
assert.strictEqual(row['SPOUSE SALARY'], '');
assert.strictEqual(row['OWN AMOUNT'], '');
assert.strictEqual(row['TIME OF CALL'], '');
assert.strictEqual(row['EXT NUMBER'], '');
assert.strictEqual(Object.keys(row).length, 35, 'row has exactly 35 keys');
pass(2);

// ── 3. buildRow with no sources → all columns empty ────────────────────────
const blank = buildRow(null);
TRACKER_HEADERS.forEach((h) => assert.strictEqual(blank[h], '', h + ' empty'));
pass(3);

// ── 4. CSV cell quoting / escaping matches the original ───────────────────
assert.strictEqual(csvCell('plain'), '"plain"');
assert.strictEqual(csvCell('has "quotes"'), '"has ""quotes"""');
assert.strictEqual(csvCell(''), '""');
assert.strictEqual(csvCell(null), '""');
assert.strictEqual(csvCell('R 1 234,56'), '"R 1 234,56"');
pass(4);

// ── 5. toCsv: header line first, then one quoted row per tracker row ──────
const csv = toCsv([buildRow(sources)]);
const lines = csv.split('\n').filter((l) => l.length);
assert.strictEqual(lines.length, 2, 'header + one row');
assert.strictEqual(lines[0], TRACKER_HEADERS.join(','));
const cells = lines[1].split('","').map((c, i, a) => i === 0 || i === a.length - 1 ? c.replace(/^"|"$/g, '') : c);
assert.strictEqual(cells.length, 35, 'one row has 35 cells');
assert.strictEqual(cells[3], 'John Peter');
assert.strictEqual(cells[4], 'Doe');
assert.strictEqual(cells[5], '8501011234087');
assert.strictEqual(cells[31], 'R 2 800,00');
pass(5);

console.log('\nALL TRACKER TESTS PASSED');
