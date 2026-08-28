# Khusela ITC Extractor (PWA)

A standalone, installable web app that:

1. Opens a **credit-application form with every Datanamix ITC field** (all empty).
2. **Extracts a Datanamix ITC PDF** (including password-protected reports) and
   **fills the form automatically** — auto-filled fields are highlighted green.
3. **Formats the filled form as a PDF** and **emails it** when **Submit & Email**
   is pressed. The app has **no download feature** and **no server-side storage** —
   drafts are autosaved to the device's browser only.

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
   **Extract & Fill Form**.
2. **Complete** — fill the manual fields (income, expenses, docs, signatures).
3. **Submit** — click **Submit & Email**. The form is rendered to a multi-page
   A4 PDF and sent to the configured address. Nothing is downloaded.

## Where are drafts saved?

Drafts are **autosaved to the browser's `localStorage` on the device you're
using** — they never leave that device:

- **Not uploaded** — no network request ever carries the form data (except the
  PDF itself when you press **Submit & Email**).
- **Not stored on any server** — there is no backend and no database.
- **Not downloadable** — the app has no download button and never triggers a
  download; the toolbar only has **Reset Form** and **Submit & Email**.
- **Private to the browser** — a draft only exists inside that browser profile
  on that machine. Another person using the same app cannot see it.
- **Cleared** — **Reset Form** wipes the form and the saved draft.

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
│   └── app.js          # wiring: extract, fill, submit, reset
├── vendor/             # pdf.js, html2canvas, jsPDF (offline)
├── icons/              # PWA icons (regenerate: powershell tools/make_icons.ps1)
├── manifest.webmanifest
├── sw.js               # offline cache
└── tools/              # Node regression test for the parser
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

## Security notes

- The app runs entirely in the browser; extracted data never leaves the device
  except when you submit (PDF → email service). There is **no download feature**.
- Drafts are stored **only** in the browser's `localStorage` on the device that
  created them — never on a server, never in git.
- Datanamix reports contain personal data — host this app somewhere you
  control and only process reports you are authorised to handle.
