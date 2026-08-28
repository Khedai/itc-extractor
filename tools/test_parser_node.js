// Validate the standalone PWA parser against the real Datanamix PDF.
// Run: node tools/test_parser_node.js
const { readFileSync } = require('fs');
const path = require('path');
const pdfjsLib = require('../../khusela-dashboard/client/node_modules/pdfjs-dist/legacy/build/pdf.js');
const parser = require('../js/itcParser.js');

// Report location + password come from environment variables — never hardcode
// real report filenames or passwords in the repo.
const SAMPLE_PDF = process.env.ITC_PDF_PATH || path.join(__dirname, '../../khusela-dashboard/sample-itc.pdf');
const PASSWORD = process.env.ITC_PDF_PASSWORD || '';

(async () => {
  const data = new Uint8Array(readFileSync(SAMPLE_PDF));
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    path.join(__dirname, '../../khusela-dashboard/client/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.js');
  const doc = await pdfjsLib.getDocument({ data, password: PASSWORD, verbosity: 0 }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent({ normalizeWhitespace: true });
    text += '\n' + tc.items.map((x) => x.str || '').join(' ');
  }
  const d = parser.parseText(text);
  const pick = {
    reportRef: d.reportRef,
    searchDate: d.searchDate,
    clientRef: d.clientRef,
    score: d.score,
    risk: d.risk,
    scoreDate: d.scoreDate,
    exceptionCode: d.exceptionCode,
    debtReview: d.debtReview,
    first: d.first,
    surname: d.surname,
    id: d.id,
    residential: d.residential,
    marital: d.marital,
    homeAffairsVerification: d.homeAffairsVerification,
    homeAffairsDeceased: d.homeAffairsDeceased,
    totalInst: d.totalInst,
    totalDebt: d.totalDebt,
    totalArrears: d.totalArrears,
    activeAccounts: d.activeAccounts,
    goodStandingAccounts: d.goodStandingAccounts,
    accounts: d.accounts,
  };
  console.log(JSON.stringify(pick, null, 2));

  // Structural checks only — never assert on a real consumer's personal data.
  const fail = [];
  if (!d.reportRef) fail.push('reportRef');
  if (!d.first) fail.push('first');
  if (!d.surname) fail.push('surname');
  if (!/^\d{13}$/.test(d.id || '')) fail.push('id');
  if (!d.marital) fail.push('marital');
  if (!d.risk) fail.push('risk');
  if (!d.scoreDate) fail.push('scoreDate');
  if (!d.exceptionCode) fail.push('exceptionCode');
  if (d.totalInst == null) fail.push('totalInst');
  if (!Array.isArray(d.accounts) || d.accounts.length === 0) fail.push('accounts');
  console.log(fail.length === 0 ? '\nALL PARSER CHECKS PASSED' : '\nFAILED: ' + fail.join(', '));
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
