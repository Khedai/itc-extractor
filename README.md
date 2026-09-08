# Khusela ITC Extractor (PWA)

A standalone, installable web app that:

1. Opens the **Khusela application form** — the same layout and fields as the
   original single-file app — with the Datanamix ITC report import + review.
2. **Extracts a Datanamix ITC PDF** (including password-protected reports) and
   **fills the application automatically** — applicant details, marital status,
   the loans & accounts table and the ITC report-details review panel.
3. **Formats the filled form as a PDF** and **emails it** when **Submit & Email**
   is pressed. Drafts are autosaved to the device's browser only.
4. **Submits to the Khusela Sales Tracker** when **Submit to Tracker** is
   pressed — every application is added to a persistent on-device tracker
   (browser `localStorage`) with the full 35-column tracker layout, and the
   updated tracker downloads as `Khusela_Sales_Tracker.csv`. **Export
   Tracker** re-downloads that CSV without adding a row (see below).

All libraries are vendored locally (`vendor/`) so the app works fully offline.

---

## Run it

Serve the folder over HTTP (service workers / PWA install don't work from
`file://`):

```bash
# Python
python -m http.server 8080
# or Node
npx serve .
# or PHP
php -S 0.0.0.0:8080
```

Then open <http://localhost:8080>.

## Use it

1. **Extract** — click the panel's file picker, choose the Datanamix ITC PDF,
   enter the report's password if it's protected, and click
   **Extract ITC Report**.
2. **Complete** — fill the manual fields (income, expenses, docs, signatures).
3. **Submit** — click **Submit & Email**. The form is rendered to a multi-page
   A4 PDF and sent to the configured address.
4. **Track** — press **✅ Submit to Tracker**. The application is appended to
   the on-device sales tracker and the full tracker downloads as
   **Khusela_Sales_Tracker.csv** (Excel-compatible CSV). Press **📊 Export
   Tracker** any time to re-download the CSV without adding a row.
5. **Print** — prints the filled application form exactly as it appears.
6. **Save Draft** — saves the form immediately (it is also autosaved as you
   type). The saved draft stays on this device only.
7. **New Application** — clears the form and the saved draft.

## Submit to Tracker

**✅ Submit to Tracker** appends ONE 35-column row to a **persistent sales
tracker that lives in this browser** (`localStorage`, key
`khusela_sales_tracker_v1`) and immediately downloads the whole tracker as an
Excel-compatible CSV — `Khusela_Sales_Tracker.csv`. There is no shared database
and nothing is uploaded; the tracker only exists on the device/browser that
built it, so save the downloaded CSV and merge new rows into your master
tracker. **📊 Export Tracker** re-downloads the CSV without adding a row.

Columns (identical to the original Khusela tracker):

> DATE, CONSULTANT, BRANCH, NAME, SURNAME, ID NUMBER, CELL, WHATSAPP, EMAIL,
> SPOUSE NAME, SPOUSE SURNAME, SPOUSE ID, SPOUSE CELL, SPOUSE WHATSAPP, SPOUSE
> EMAIL, ADDRESS, EMPLOYER, APPLICATION TYPE, DEBT REVIEW STATUS, MARITAL
> STATUS, BANK, ACCOUNT NO, ACCOUNT TYPE, DR STATUS, GROSS SALARY, NETT
> SALARY, SPOUSE SALARY, TOTAL BALANCE, CURRENT INSTALMENT, REDUCED
> INSTALMENT, DEBIT ORDER DATE, DEBIT ORDER AMOUNT, OWN AMOUNT, TIME OF CALL,
> EXT NUMBER.

Where each value comes from on the form:

| Tracker field         | Form field                                        |
| --------------------- | ------------------------------------------------- |
| DATE                  | Date (top of the form)                            |
| CONSULTANT            | *(no field on this form — blank)*                 |
| BRANCH                | Branch                                            |
| NAME                  | Name (First + Second are combined when extracting)|
| SURNAME               | Surname                                           |
| ID NUMBER             | ID                                                |
| CELL                  | Cell                                              |
| WHATSAPP              | WhatsApp                                          |
| EMAIL                 | Email                                             |
| SPOUSE NAME           | Spouse Name                                       |
| SPOUSE SURNAME        | Spouse Surname                                    |
| SPOUSE ID             | Spouse ID                                         |
| SPOUSE CELL           | Spouse Cell                                       |
| SPOUSE WHATSAPP       | Spouse WhatsApp                                   |
| SPOUSE EMAIL          | Spouse Email                                      |
| ADDRESS               | Address (extract fills Residential Address)       |
| EMPLOYER              | Employer                                          |
| APPLICATION TYPE      | Application Type (dropdown)                       |
| DEBT REVIEW STATUS    | Debt Review Status (dropdown)                     |
| MARITAL STATUS        | Marital Status (dropdown)                         |
| BANK                  | Bank                                              |
| ACCOUNT NO            | Account no.                                       |
| ACCOUNT TYPE          | Account Type (dropdown)                           |
| DR STATUS             | DR Status (dropdown)                              |
| GROSS SALARY          | Gross Salary                                      |
| NETT SALARY           | Nett Salary                                       |
| SPOUSE SALARY         | Spouse Salary                                     |
| TOTAL BALANCE         | Loans table totals row                            |
| CURRENT INSTALMENT    | Loans table totals row                            |
| REDUCED INSTALMENT    | Loans table totals row                            |
| DEBIT ORDER DATE      | Debit Order Date                                  |
| DEBIT ORDER AMOUNT    | Debit Order Amount (auto = reduced total)         |
| OWN AMOUNT            | Own Amount                                       |
| TIME OF CALL          | Time of call                                      |
| EXT NUMBER            | EXT number                                        |

Only CONSULTANT (the original's consultant input lives in its header, which is
not part of this app's header) is written **empty** — every other column is
filled straight from the matching form field.

- Pressing **✅ Submit to Tracker** requires a **Name, Surname and ID Number**
  (entered or extracted) and a selected **Application Type**.
- Every press adds another row — rows are never deduplicated (same behaviour as
  the original).
- The tracker is stored **only in the browser** — like a saved draft it never
  leaves the device except as the CSV you choose to download.


## Where are drafts saved?

Drafts are **autosaved to the browser's `localStorage` on the device you're
using** — they never leave that device:

- **Not uploaded** — no network request ever carries the form data (except the
  PDF itself when you press **Submit & Email**).
- **Not stored on any server** — there is no backend and no database.
- **Not downloadable as a draft** — the form itself is never offered as a
  download; the only file output is the tracker CSV from **Submit to Tracker** /
  **Export Tracker**. Those rows stay in this browser until you save the
  downloaded CSV over your master tracker.
- **Private to the browser** — a draft only exists inside that browser profile
  on that machine. Another person using the same app cannot see it.
- **Cleared** — **New Application** wipes the form and the saved draft.

The only data stored in the repo / git history is the app code — never any
report or applicant data.

## Configure the email recipient

Open `js/config.js` and set `recipientEmail`:

```js
window.ITC_CONFIG = {
  recipientEmail: 'reception@kdebt.co.za',  // <-- your address here
  subject: 'Khusela Credit Application - ITC report',
  fileNamePrefix: 'Khusela-Credit-Application',
};
```

Email is sent through **FormSubmit.co** — a free, no-backend service that works
from any static host. The filled form is attached to the email as a **PDF**
(field `attachment`, up to FormSubmit's 10 MB limit; the app auto-compresses
the PDF and re-sends if it ever gets too large).

### First send = activation (why you may only see a "form submission" notification)

The **first** submission to a new recipient address does **not** deliver the
PDF. FormSubmit emails the recipient a one-time **activation / notification**
email instead, and the recipient must click the **activation link** inside it.
From then on, every submission arrives with the PDF attached. If the only email
you ever received was a "form submission" notification, that was this
activation email — click its link, then press **Submit & Email** again.

### "From" and replying

FormSubmit sends from its own generic address — the sender **cannot** be
customised with this service. The app sets **Reply-To** to the applicant's email
address (field `fEmail`), so replying to the notification in your mail client
goes straight back to the applicant. The email body also lists the applicant's
name, ID number and date so the notification itself is useful.

FormSubmit advertises **unlimited forms and submissions** — there is no
published daily or monthly cap — but every submission is limited to **10 MB** of
attachments and the service spam-filters submissions, so very high volumes can
occasionally be throttled.

- If the address is left empty (or sending fails / there's no internet),
  **nothing is sent and nothing is downloaded** — the draft stays autosaved in
  the browser, ready to retry.

## Deploy on Vercel

The app is a pure static site (no build step), so deploying is one step:

1. Push this repo to GitHub (see below).
2. In the Vercel dashboard choose **Add New → Project** and import
   **Khedai/itc-extractor**.
3. Vercel auto-detects the static site; click **Deploy**. Every future push to
   `main` redeploys automatically.

Alternatively, from the CLI: run `vercel login` once, then `vercel --prod`.

## Hosting the repo on GitHub

The code for this app lives in the `Khedai/itc-extractor` repository:

```bash
git init -b main
git remote add origin https://github.com/Khedai/itc-extractor.git
git add .
git commit -m "Khusela ITC Extractor PWA"
git push origin main
```

> No report or applicant data is ever committed — see "Where are drafts saved?".
> Pushing to `main` auto-deploys on Vercel (Git integration).

## Install as an app (PWA)

- **Android / Chrome:** open the site → browser menu → *Add to Home screen* /
  *Install app*.
- **iOS / Safari:** Share → *Add to Home Screen*.

The service worker caches everything for offline use after the first visit.

## Project layout

```
khusela-itc-pwa/
├── index.html          # the form + ITC panel + toolbar
├── css/styles.css      # form + extractor styling
├── js/
│   ├── config.js       # email recipient / subject / filename
│   ├── itcParser.js    # Datanamix report text parser (pure)
│   ├── extractor.js    # pdf.js reading + password handling
│   ├── pdfGenerator.js # form → A4 PDF (html2canvas + jsPDF)
│   ├── email.js        # FormSubmit email send (no download)
│   ├── tracker.js      # Khusela Sales Tracker (browser CSV tracker)
│   └── app.js          # wiring: extract, fill, submit, reset
├── vendor/             # pdf.js, html2canvas, jsPDF (offline)
├── icons/              # PWA icons (regenerate: powershell tools/make_icons.ps1)
├── manifest.webmanifest
├── sw.js               # offline cache
└── tools/              # Node regression tests
```

## Tests

The parser is pure JS and can be validated against a real report with plain
Node (requires the report PDF next to this repo):

```bash
node tools/test_parser_node.js
```

> Note: the test reads the sample report path from `ITC_PDF_PATH` (defaults to a
> `sample-itc.pdf` in the sibling `khusela-dashboard/` folder) and its password
> from `ITC_PDF_PASSWORD` — neither is ever hardcoded.

The tracker's pure core (35-column row building + CSV serialisation) has its
own plain-Node test:

```bash
node tools/test_tracker_node.js
```

## Security notes

- The app runs entirely in the browser; extracted data never leaves the device
  except when you submit (PDF → email service) or when you export the tracker
  CSV (**Submit to Tracker** / **Export Tracker**).
- Drafts are stored **only** in the browser's `localStorage` on the device that
  created them — never on a server, never in git.
- Datanamix reports contain personal data — host this app somewhere you
  control and only process reports you are authorised to handle.
