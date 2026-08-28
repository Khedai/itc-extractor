// Pure, dependency-free parser for Datanamix ITC credit-bureau report text.
// No pdf.js imports in this module so it can be unit-tested with plain Node
// (see client/scripts/itcParser.test.mjs).

const PERSONAL_LABELS = [
  'ID Number', 'Passport Number', 'First Name', 'Residential Address',
  'Second Name', 'Postal Address', 'Surname', 'Maiden Name', 'Title',
  'Gender', 'Home Telephone No', 'Work Telephone No', 'Cellular No',
  'Email Address', 'Birth Date', 'Employer Details', 'Marital Status',
];

const ACCOUNT_LABELS = [
  'Subscriber Name', 'Account No', 'Current Balance', 'Instalment Amount',
  'Arrears Amount', 'Open Balance / Credit Limit',
  'No Of Participants In Joint Loan', 'Type of Account',
  'Last Paid Date', 'Date Account Opened', 'Account Status',
];

// Section headings that appear in an ITC report. A field value captured by
// labelled() must never run past one of these — this stops the last label in a
// group (e.g. "Marital Status" / "Account Status") from swallowing the rest of
// the document when no other field label follows it.
const SECTION_MARKERS = [
  'Report Details', 'Report Reference', 'Client Reference', 'Search Date',
  'Consumer Identity Information', 'Consumer Summary',
  'Fraud Information', 'Fraud Indicators Summary', 'SAFPS Listing',
  'Home Affairs Verification', 'Home Affairs Deceased Status',
  'Home Affairs Deceased Date',
  'Consumer Score Information', 'Score Date', 'Exception Code',
  'Final Score', 'Risk Category', 'Negative Reasons', 'Debt Summary',
  'Debt Review Status', 'Dispute Message', 'Debt Counsellor First Name',
  'Debt Counsellor Surname', 'Debt Counsellor Telephone No',
  'Debt Counsellor Registration No',
  'Judgements', 'Defaults', 'Adverse Information', 'Admin Orders',
  'Sequestration', 'Rehabilitation Orders', 'Enquiries',
  'Consumer 24 Monthly Payment History',
  'Consumer NLR 24 Monthly Payment History', 'Consumer NLR Account Status',
  'Consumer Account Status', 'Consumer Properties', 'Directorships',
  'Debt Review Case', 'Consumer Address History', 'Consumer Telephone History',
  'Consumer Email History', 'Consumer Employment History', 'Enquiry History',
  'Definition Code Descriptions',
  'Total Monthly Instalments', 'Total Outstanding Debt', 'Total Arrears Amount',
];

// Terminators supplied as ready-made regex patterns (NOT escaped). A bare
// "Account:" phrase would wrongly cut values that legitimately contain it
// (e.g. "Open Account: Telecoms, Security, Cell Phones") — requiring a digit
// after the colon (the account's sequence number) makes it safe.
const REGEX_MARKERS = ['Account:\\s*\\d+'];

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Collapse whitespace and repair two pdf.js text-layer artifacts found in
// Datanamix reports: immediately repeated words ("JOHANNESBURG JOHANNESBURG")
// and immediately repeated phrases ("473 UMHLATHUZI STREET 473 UMHLATHUZI …").
const clean = (v) => {
  let s = String(v || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

  // Drop consecutive duplicate tokens.
  const toks = s.split(' ');
  const once = [];
  for (let i = 0; i < toks.length; i++) {
    if (i > 0 && toks[i] === toks[i - 1]) continue;
    once.push(toks[i]);
  }

  // Drop immediately-repeated phrases of 3+ tokens (the duplicated-address
  // artifact). Shorter repeats are left alone to avoid false positives.
  const deduped = [];
  let i = 0;
  while (i < once.length) {
    let dupLen = 0;
    const maxLen = Math.min(8, Math.floor((once.length - i) / 2));
    for (let len = maxLen; len >= 3; len--) {
      let same = true;
      for (let k = 0; k < len; k++) {
        if (once[i + k] !== once[i + len + k]) {
          same = false;
          break;
        }
      }
      if (same) {
        dupLen = len;
        break;
      }
    }
    if (dupLen) {
      for (let k = 0; k < dupLen; k++) deduped.push(once[i + k]);
      i += dupLen * 2;
    } else {
      deduped.push(once[i]);
      i += 1;
    }
  }

  return deduped.join(' ');
};

// Parse a South African money amount. Accepts both "12 345.67" (space
// thousands, as used by Datanamix) and "12,345.67" (comma thousands), plus an
// optional leading minus sign.
const num = (v) => {
  const s = String(v ?? '').replace(/[^\d.-]/g, '');
  const m = s.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : 0;
};

// Capture the value that follows "label:" in `text`. The value is terminated
// by the next field label (with a colon) OR by a known report section heading
// OR by the end of the text.
function labelled(text, label, list) {
  const fieldOthers = list
    .filter((x) => x.toLowerCase() !== label.toLowerCase())
    .map(esc)
    .join('|');
  const markers = [...SECTION_MARKERS.map(esc), ...REGEX_MARKERS]
    .filter((x) => x.toLowerCase() !== label.toLowerCase())
    .join('|');
  const re = new RegExp(
    esc(label) + '\\s*:\\s*(.*?)(?=' +
      '\\s*(?:' + fieldOthers + ')\\s*:|' +
      '\\s*(?:' + markers + ')(?=\\s*:|\\s|$)|' +
      '\\s*$)',
    'i',
  );
  const m = text.match(re);
  return m ? clean(m[1]) : '';
}

function classifyAccount(type, sub) {
  const x = clean(type + ' ' + sub).toLowerCase();
  if (/home loan|mortgage|housing loan|bond|property loan|home finance/.test(x))
    return 'Home Loan';
  if (/vehicle|motor|car loan|asset finance|auto finance|motor finance/.test(x))
    return 'Vehicle Finance';
  return 'Unsecured';
}

function isInsurance(type, sub) {
  return /insurance|insurer|policy|funeral|life cover|credit life|payment protection|premium/.test(
    clean(type + ' ' + sub).toLowerCase(),
  );
}

function reductionRate(cat) {
  if (cat === 'Home Loan') return 0.8;
  if (cat === 'Vehicle Finance') return 0.7;
  return 0.5;
}

function reducedAmount(v, cat) {
  return Math.round(v * reductionRate(cat) * 100) / 100;
}

// Extract the totals figure for a summary line such as
//   "Total Monthly Instalments R 12 345.67 R 10 000.00 R 2 345.67"
// and return the LAST amount — the original implementation read the 3rd
// (final) column, while single-column reports still work. The trailing
// lookahead forces the engine to consume every "R <amount>" pair.
function totalsAmount(flat, label) {
  const m = flat.match(
    new RegExp(
      esc(label) + '\\s*:?\\s*R\\s*([\\d\\s,.-]+(?:\\s+R\\s*[\\d\\s,.-]+)*)(?=\\s+[A-Z]|$)',
      'i',
    ),
  );
  if (!m) return 0;
  const amounts = m[1].split(/\s+R\s*/);
  return num(amounts[amounts.length - 1]);
}

// Count fields such as "Total Number Of Active Accounts 0 2 2" (NLR, CPA,
// Total columns) — returns the last (Total) number.
function countField(flat, label) {
  const m = flat.match(
    new RegExp(esc(label) + '\\s+([\\d\\s]+?)(?=\\s+[A-Z]|$)', 'i'),
  );
  if (!m) return '';
  const nums = m[1].match(/\d+/g) || [];
  return nums.length ? nums[nums.length - 1] : '';
}

function parseText(text) {
  const flat = clean(text);
  const d = {};

  // ── Personal fields ──
  PERSONAL_LABELS.forEach((l) => {
    d[l] = labelled(flat, l, PERSONAL_LABELS);
  });

  d.id = d['ID Number'];
  d.first = d['First Name'];
  d.second = d['Second Name'];
  d.surname = d['Surname'];
  d.residential = d['Residential Address'];
  d.postal = d['Postal Address'];
  d.home = d['Home Telephone No'];
  d.work = d['Work Telephone No'];
  d.cell = d['Cellular No'];
  d.email = d['Email Address'];
  d.employer = d['Employer Details'];
  d.marital = d['Marital Status'];
  d.maiden = d['Maiden Name'];
  d.title = d['Title'];
  d.gender = d['Gender'];
  d.birth = d['Birth Date'];

  // ── Report metadata ──
  d.reportRef = labelled(flat, 'Report Reference', [
    'Client Reference', 'Search Date', 'Consumer Identity Information',
  ]);
  d.clientRef = labelled(flat, 'Client Reference', [
    'Search Date', 'Consumer Identity Information',
  ]);
  d.searchDate = labelled(flat, 'Search Date', [
    'Report Reference', 'Consumer Identity Information',
  ]);

  // ── Score & risk ──
  // Real Datanamix layout (table columns read in order):
  //   "Risk Category Final Score 2026-03-10 DEBT REVIEW LISTED AGAINST
  //    CONSUMER Potential High Risk 0"
  // i.e. score date, exception code, risk category, then the score value.
  const sm = flat.match(
    /Risk Category\s+Final Score.*?\b((?:Potential\s+)?(?:Very High Risk|High Risk|Medium Risk|Low Risk))\s+(\d{1,3})(?=\s|$)/i,
  );
  d.risk = sm?.[1] || '';
  d.score = sm?.[2] || '';
  if (!d.score) {
    // Fallback for simple layouts such as "Final Score 650". The (?!\d) guard
    // stops the score being read out of a 4-digit year like "2026-03-10".
    d.score = (flat.match(/Final Score\s+(\d{3})(?!\d)/i) || [])[1] || '';
  }

  // ── Debt review status ──
  d.debtReview = labelled(flat, 'Debt Review Status', [
    'Dispute Message', 'Consumer CPA Account Information',
  ]);

  // ── Score date & exception code (from the score block) ──
  d.scoreDate = (flat.match(/Final Score\s+(\d{4}-\d{2}-\d{2})/i) || [])[1] || '';
  d.exceptionCode = clean(
    (flat.match(
      /Final Score\s+\d{4}-\d{2}-\d{2}\s+(.*?)\s+(?:Potential\s+)?(?:Very High Risk|High Risk|Medium Risk|Low Risk)\s+\d{1,3}(?=\s|$)/i,
    ) || [])[1] || '',
  );

  // ── Home affairs flags ──
  d.homeAffairsVerification = (flat.match(/Home Affairs Verification\s*(Yes|No)/i) || [])[1] || '';
  d.homeAffairsDeceased = (flat.match(/Home Affairs Deceased Status\s*(Yes|No)/i) || [])[1] || '';

  // ── Totals (amounts may use spaces as thousands separators) ──
  d.totalInst = totalsAmount(flat, 'Total Monthly Instalments');
  d.totalDebt = totalsAmount(flat, 'Total Outstanding Debt');
  d.totalArrears = totalsAmount(flat, 'Total Arrears Amount');

  // ── Account counts (NLR, CPA, Total columns — last value is the Total) ──
  d.activeAccounts = countField(flat, 'Total Number Of Active Accounts');
  d.goodStandingAccounts = countField(flat, 'Total Number Of Accounts In Good Standing');
  d.arrearsAccounts = countField(flat, 'Total Number Of Accounts In Arrears');
  d.paidUpAccounts = countField(flat, 'Total Number Of Paid Up or Closed Accounts');

  // ── Judgements, defaults, etc. ──
  d.judgements = (flat.match(/Judgements\s+(\d+)/i) || [])[1] || '';
  d.defaults = /Defaults\s+No Results Found/i.test(flat)
    ? 'No Results Found'
    : 'Found';
  d.adverse = /Adverse Information\s+No Results Found/i.test(flat)
    ? 'No Results Found'
    : 'Found';
  d.admin = /Admin Orders\s+No Results Found/i.test(flat)
    ? 'No Results Found'
    : 'Found';
  d.sequestration = /Sequestration\s+No Results Found/i.test(flat)
    ? 'No Results Found'
    : 'Found';
  d.rehab = /Rehabilitation Orders\s+No Results Found/i.test(flat)
    ? 'No Results Found'
    : 'Found';

  // ── Accounts ──
  d.accounts = [];
  const accountEnd = [
    'Consumer 24 Monthly Payment History',
    'Consumer NLR 24 Monthly Payment History',
    'Consumer NLR Account Status', 'Consumer Account Status',
    'Consumer Properties', 'Directorships',
    'Debt Review Case',
    'Judgements', 'Defaults', 'Adverse Information', 'Admin Orders',
    'Sequestration', 'Rehabilitation Orders', 'Enquiries',
  ].map(esc).join('|');
  const rx = new RegExp(
    'Account:\\s*(\\d+)\\s+([\\s\\S]*?)(?=' +
    'Account:\\s*\\d+|' + accountEnd + '|$)',
    'gi',
  );
  let m;

  while ((m = rx.exec(text))) {
    const b = clean(m[2]);
    const a = {
      sub: labelled(b, 'Subscriber Name', ACCOUNT_LABELS),
      acct: labelled(b, 'Account No', ACCOUNT_LABELS),
      balance: num(labelled(b, 'Current Balance', ACCOUNT_LABELS)),
      instalment: num(labelled(b, 'Instalment Amount', ACCOUNT_LABELS)),
      arrears: num(labelled(b, 'Arrears Amount', ACCOUNT_LABELS)),
      type: labelled(b, 'Type of Account', ACCOUNT_LABELS),
      status: labelled(b, 'Account Status', ACCOUNT_LABELS),
    };

    if (a.sub && a.balance > 0 && !isInsurance(a.type, a.sub)) {
      a.category = classifyAccount(a.type, a.sub);
      a.reduced = reducedAmount(a.instalment, a.category);
      d.accounts.push(a);
    }
  }

  return d;
}

// Expose as a global in the browser (plain <script>) and as a CommonJS module
// so the same file can be regression-tested with plain Node.
const ITCParser = { parseText, num, clean, labelled };
if (typeof module !== 'undefined' && module.exports) module.exports = ITCParser;
else if (typeof window !== 'undefined') window.ITCParser = ITCParser;

