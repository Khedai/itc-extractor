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
   (browser `localStorage`) with the essential 12-column intake layout, and the
   updated tracker downloads as `Khusela_Sales_Tracker.xlsx`. **Export
   Tracker** re-downloads that workbook without adding a row (see below).
5. **Collects a signature remotely** (optional) — a **Client Digital Signing**
   panel per applicant creates a secure one-time link and sends it by WhatsApp or
   e-mail in one press; the client signs on their own device and the captured
   signature appears in that box and in the PDF (see
   [Signature requests](#signature-requests-remote-signing)).

All libraries are vendored locally (`vendor/`) so the app works fully offline.
Only the optional remote-signing feature needs a network connection beyond
sending the email — and only once you point it at a backend.

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
   **Extract ITC Report**. **No report to hand?** Skip this step entirely:
   every box on the form is typeable, including the *ITC Report Details* panel
   (which an extraction would otherwise fill in). Those review boxes stay on
   screen only — they are never printed and never sent in the emailed PDF — and
   nothing in the app requires an extraction before you can submit.
2. **Complete** — fill the manual fields (income, expenses, docs) and, if the
   client is signing remotely, send a signature request (see
   [Signature requests](#signature-requests-remote-signing)).
3. **Submit** — click **Submit & Email**. The form is rendered to a multi-page
   A4 PDF, stored in the office's report bucket, and sent to the office address
   configured on the backend. If the email cannot be delivered, the screen says
   so and the PDF is still in the bucket.
4. **Track** — press **✅ Submit to Tracker**. The application is appended to
   the on-device sales tracker and the full tracker downloads as
   **Khusela_Sales_Tracker.xlsx** (a real Excel workbook). Press **📊 Export
   Tracker** any time to re-download the workbook without adding a row.
5. **Print** — prints the filled application form exactly as it appears.
6. **Save Draft** — saves the form immediately (it is also autosaved as you
   type). The saved draft stays on this device only.
7. **New Application** — clears the form and the saved draft.

## Submit to Tracker

**✅ Submit to Tracker** appends ONE 12-column row to a **persistent sales
tracker that lives in this browser** (`localStorage`, key
`khusela_sales_tracker_v1`) and immediately downloads the whole tracker as an
Excel workbook — `Khusela_Sales_Tracker.xlsx`. There is no shared database
and nothing is uploaded; the tracker only exists on the device/browser that
built it, so save the downloaded workbook and merge new rows into your master
tracker. **📊 Export Tracker** re-downloads the workbook without adding a row.

Only the important intake details are recorded (not every form field):

> DATE, NAME, SURNAME, ID NUMBER, CELL, WHATSAPP, EMAIL, APPLICATION TYPE,
> BANK, ACCOUNT NO, DEBIT ORDER DATE, DEBIT ORDER AMOUNT.

Where each value comes from on the form:

| Tracker field         | Form field                                        |
| --------------------- | ------------------------------------------------- |
| DATE                  | Date (top of the form)                            |
| NAME                  | Name (First + Second are combined when extracting)|
| SURNAME               | Surname                                           |
| ID NUMBER             | ID                                                |
| CELL                  | Cell                                              |
| WHATSAPP              | WhatsApp                                          |
| EMAIL                 | Email                                             |
| APPLICATION TYPE      | Application Type (dropdown)                       |
| BANK                  | Bank                                              |
| ACCOUNT NO            | Account no.                                       |
| DEBIT ORDER DATE      | Debit Order Date                                  |
| DEBIT ORDER AMOUNT    | Debit Order Amount (auto = reduced total)         |

- Pressing **✅ Submit to Tracker** requires a **Name, Surname and ID Number**
  (entered or extracted) and a selected **Application Type**.
- Every press adds another row — rows are never deduplicated (same behaviour as
  the original).
- The tracker is stored **only in the browser** — like a saved draft it never
  leaves the device except as the workbook you choose to download.


## Signature requests (remote signing)

The **Signature** section (Applicant 1 / Applicant 2) keeps the original Khusela
layout — two boxes that fill with the client's signature. Every control for
getting that signature asked for lives in a **Client Digital Signing** panel
below the form, one per applicant. Both panels appear **only when a signature
service has been configured** — with `signatureApiBase` left empty they are hidden
and the app behaves exactly as it always has.

1. Point the app at the backend in `js/config.js` (see
   [Configure email delivery](#configure-email-delivery)):

   ```js
   signatureApiBase: 'https://api.your-domain.co.za',   // <-- here
   ```

   The backend is the `khusela-backend` project. Add this site's exact address to
   its `ALLOWED_ORIGINS`, otherwise the browser blocks the requests.

2. Enter the applicant's **Name, Surname and ID Number** on the form. The panels
   fill themselves from the form — including after an ITC extraction, which is
   where the cell number comes from — and stay editable, so a corrected or
   different number needs no trip back to the form.

3. Press **Generate Signing Link** in that applicant's panel. A secure, one-time,
   expiring link is created, shown in the box under the buttons and copied to the
   clipboard.

4. Send it, whichever way suits the client:

   | Button | What happens |
   | --- | --- |
   | **Send via WhatsApp** | WhatsApp opens on the number in that panel with `Hi <name>, please sign here: <link>` already typed — press Send there. Nothing is sent without that press. |
   | **Send via Email** | Your mail window opens — Gmail by default — addressed to the client in that panel, with the link and the instructions already written. Press Send there. |
   | **Copy Link** | Copies it again, for any other route (SMS, a second number) or when the browser blocks the pop-up. |

   Both sends are a redirect you finish with one press, so nothing goes out
   without you sending it. Neither depends on the signing service being able to
   send mail, which it cannot: it runs on a free Render instance, where outbound
   SMTP is blocked.

   **Which mail window opens** is `mailWebmail` in `js/config.js`:
   `'gmail'` (default) or `'outlook'` open that provider's web composer over
   https, which works in any browser; `'mailto'` uses the operating system's own
   mail app instead, and only works on a machine that has one registered — which
   is why it is not the default.

   The address a link goes to is the one in the panel **at the moment the link
   was generated** — so an address corrected afterwards applies to the next link,
   not to this one.

5. They open the link on their own phone, draw their signature with a finger and
   submit it. This app polls for the result every 20 seconds; as soon as the
   signature arrives it is drawn inside that applicant's box (green border), and
   it is included in the PDF the next time you press **Submit & Email**.

Notes:

- **Applicant 1 and Applicant 2 are independent** — each panel owns its own link,
  its own contact details and its own status line ("Waiting for the signature…",
  "Signed …", or "That link expired before it was signed").
- **Two separate secrets** are involved. The link you send is one-time and
  expiring; the token that lets *this* device read the signature back stays on
  this device and must never be shared with the client.
- The panels sit **outside** the form, so they are never in the PDF or the
  printed application — only the captured signature is. They are not part of the
  autosaved draft either; they are rebuilt from the form on load.
- Pending requests are remembered in this browser alongside the draft, so a
  signature that arrives after you close the page is picked up next time.
  **New Application** clears them, and so does a **successful Submit & Email** —
  the application has gone, so its signature must not turn up in the next
  applicant's box. A send that fails leaves everything where it is, because the
  retry still needs that signature.
- **Extracting a different report clears them too**, before the new details go
  in — a link that can still be sent, and a signature that would otherwise be
  printed inside the next applicant's application. A *failed* extraction (a wrong
  password) clears nothing: that is a typo, not a new client.
- **"Send via Email" opens a webmail draft** — Gmail by default, Outlook or the
  OS mail app if `mailWebmail` says so — with the link written and the client
  addressed; it does not send anything by itself, and it does not need the
  signing service to have a mailbox (it has none, and cannot have one on a free
  Render instance, where outbound SMTP is blocked).
- If a request fails (backend down, address wrong) the panel shows a short error
  and nothing else about the application is affected.

## Call recording (optional voice evidence)

A consultant can attach **one Vicidial call recording to the application they are
building**. It is optional: when none is selected, the office email says
**"No call recording was attached to this application"**, and the PDF footer says
`Call recording: not provided`. When one is selected, the PDF footer names the
file and the MP3 is stored on the backend with the PDF and sent with it (attached
when the message fits, otherwise as a signed download link, exactly like the PDF).

The panel sits below the signing panels, **outside the form**, so none of its
chrome is ever captured in the PDF. It asks for the consultant's **own Vicidial
login** and the **call date**; the app remembers the login on that PC after the
first use. `vicidialConsultants` in `js/config.js` can list the pilot group's
logins as a pick-list; free text works too. The app never holds a Vicidial
password — the backend owns those.

The recording follows the same per-application rule as a signature: it is cleared
on **New Application**, on a **successful Submit & Email**, and when a **different
ITC report** is extracted. A failed send leaves it in place so a retry keeps the
evidence.

Setup is server-side (see `khusela-signature-backend/README.md`): the backend needs
`VICIDIAL_BASE_URL`, `VICIDIAL_API_USER`, `VICIDIAL_API_PASS`, and — if
`/RECORDINGS/` is password-protected or not reachable from the host — the
`VICIDIAL_RECORDINGS_*` settings. With none set, pressing **Find recordings**
answers "Vicidial recording lookup is not configured on this server" and nothing
is sent to Vicidial; submitting still works exactly as before.

## Where are drafts saved?

Drafts are **autosaved to the browser's `localStorage` on the device you're
using** — they never leave that device:

- **Not uploaded** — no network request ever carries the form data, except the
  PDF itself when you press **Submit & Email** and the applicant's name/ID/contact
  details when you press **Generate Signing Link** (see
  [Signature requests](#signature-requests-remote-signing)).
- **Not stored on any server** — the form itself has no backend and no database.
  The only server ever involved is the optional signature service, and it
  receives **only** the applicant's name, ID and contact details needed for their
  signing request — never the rest of the application.
- **Not downloadable as a draft** — the form itself is never offered as a
  download; the only file output is the tracker workbook from **Submit to Tracker** /
  **Export Tracker**. Those rows stay in this browser until you save the
  downloaded workbook over your master tracker. The office's own copy of each
  application is the report bucket on the backend, and it is downloaded only with
  the admin key — never from the consultant's shared screen.
- **Private to the browser** — a draft only exists inside that browser profile
  on that machine. Another person using the same app cannot see it.
- **Cleared** — **New Application** wipes the form and the saved draft.

The only data stored in the repo / git history is the app code — never any
report or applicant data.

## Configure email delivery

The address the office receives applications at is **not in this app**. The
backend owns it with `MAIL_TO` for SMTP/Brevo, and the Formspree form owns its own
fixed recipient. Nothing in a browser request can name a recipient.

`js/config.js` therefore only needs the backend base URL:

```js
window.ITC_CONFIG = {
  fileNamePrefix: 'Khusela-Credit-Application',
  signatureApiBase: 'https://khusela-signature-backend.onrender.com',
  mailWebmail: 'gmail',
};
```

**Submit & Email** POSTs the PDF to `<signatureApiBase>/api/email` as
`multipart/form-data` (field `attachment`). The backend **stores the PDF in its
report bucket before it tries to send**, then delivers over:

1. **SMTP** — only where outbound SMTP actually works (a paid host, VPS, or local
   development). Render's free tier blocks ports 25/465/587.
2. **Brevo over HTTPS** — the recommended free path that keeps the PDF attached
   (300 messages a day, attachments up to 25 MB).
3. **Formspree over HTTPS** — the form the office already has. Its free plan
   refuses file uploads, so the email carries a secure, expiring download link
   instead of the attachment.

The message on screen is decided by the backend's HTTP status, not by a guess:

| Status | What the consultant is told |
|---|---|
| `200` | Emailed to the office — with the PDF attached, or with a secure link when `linkOnly` is set. |
| `503` + `stored:true` | Saved to the report bucket, **not emailed**; no delivery path is configured. |
| `502` + `stored:true` | Every configured provider refused; the PDF is safe in the bucket; tell the office and retry. |
| `429` | Rate limited; nothing sent; wait and retry. |
| `401` / `403` | This app is not on the service's approved-origin list. |
| No answer / timeout | Not sent or saved; the draft remains on this device; retry. |

There is **no FormSubmit fallback**. If `signatureApiBase` is empty, the app
refuses the send and says email is not configured rather than claiming delivery.

### Every application is backed up — the report bucket

`POST /api/email` writes the PDF into the backend's database **before** it tries
to email it, whatever happens next. That is the "bucket": a report that never
reached the office's inbox — no delivery path configured, a refused message, a
missed spam folder — can still be pulled out afterwards. The office reads it with
the backend's admin endpoints (the `ADMIN_API_KEY` set on the service):

```http
GET /api/admin/submissions            # list, newest first (id, filename, email_status, …)
GET /api/admin/submissions/:id        # one submission's details
GET /api/admin/submissions/:id/pdf    # the PDF itself (attachment download)
POST /api/admin/submissions/:id/resend# re-send a backed-up report once delivery works
```

The office reads it with the **admin page** at `https://<service>/admin` — a list
of every submission with the applicant's **name, ID number, signer label and
application date**, plus a **Download PDF** button (and a **Resend** button for
the ones that never made it out), all gated by the `ADMIN_API_KEY`. The signer
label comes from whichever applicant box(es) hold a signature (`Applicant 1`,
`Applicant 2`, or both), so a backed-up report can be matched to its signer. It
is admin-only: a consultant's shared PWA screen can never open it.

`email_status` says which case it was: `sent` (also emailed), `not_configured`
(no delivery path set up), or `failed` (every path refused it). So an application
that "did not arrive" is no longer lost — it is in the bucket, and the
consultant's screen says so instead of reporting a success that never happened.
When Formspree's free plan refuses the attachment, the email still goes out with
a signed, expiring download link; it is never a public link and never appears in
the PWA.

**Old submissions are unrecoverable.** Reports sent before the report bucket
existed — the FormSubmit era — were never stored here. If that email did not
arrive, there is no copy on the backend to recover; only the email itself, if it
reached the office, remains.

**Why the backend path exists:** on 2026-09-30 FormSubmit answered every
submission with **HTTP 500** — its own documentation page did too — and again on
2026-11-05 it answered **HTTP 522**. The app posted through a hidden cross-origin
iframe and could not read that answer, so it reported success while no application
arrived. The old path has been removed. Sending from the backend made the outcome
visible, and storing in the bucket first made the outcome recoverable. The backend
side is documented in `khusela-signature-backend/README.md` (set `MAIL_TO` and
either `BREVO_API_KEY` + `BREVO_SENDER`, `FORMSPREE_ENDPOINT`, or SMTP details;
until then the route answers 503 and the PDF is still kept in the bucket).

The filled form is attached to the email as a **PDF** (field `attachment`), or
delivered by a secure link when the provider cannot carry the file. The limit is
**20 MB** (`MAX_EMAIL_MB` on the backend); the app auto-compresses the PDF once
and refuses to post anything larger, naming that limit.

- If the backend is unreachable (or there is no internet), **nothing is sent or
  saved** and the message says so — the draft stays autosaved in the browser,
  ready to retry.

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

The service worker caches everything for offline use after the first visit. The
document itself, the manifest and `js/config.js` are fetched **network-first**, so a
deploy is visible on the next visit instead of hiding behind the copy cached on that
device; when a new worker takes control while a page is open, the page reloads once
(the open draft is saved first) so the new build is what you are looking at.

## Project layout

```
khusela-itc-pwa/
├── index.html          # the form + ITC panel + toolbar
├── css/styles.css      # form + extractor styling
├── js/
│   ├── config.js       # backend URL / filename / mail window
│   ├── itcParser.js    # Datanamix report text parser (pure)
│   ├── extractor.js    # pdf.js reading + password handling
│   ├── pdfGenerator.js # form → A4 PDF (html2canvas + jsPDF)
│   ├── email.js        # backend email send (no download)
│   ├── tracker.js      # Khusela Sales Tracker (browser XLSX tracker)
│   ├── signature.js    # remote signing requests (link, status, signature)
│   ├── recording.js    # optional Vicidial call recording (lookup, select, attach)
│   └── app.js          # wiring: extract, fill, submit, reset
├── vendor/             # pdf.js, html2canvas, jsPDF (offline)
├── icons/              # PWA icons (regenerate: powershell tools/make_icons.ps1)
├── manifest.webmanifest
├── sw.js               # offline cache; the page itself is network-first
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

The tracker's pure core (12-column row building + XLSX serialisation) has its
own plain-Node test:

```bash
node tools/test_tracker_node.js
```

The email routing has its own plain-Node test. It loads `js/email.js` into a stub
browser scope, so it can say exactly which request goes out and what is in it, and
that no FormSubmit or hidden form remains:

```bash
node tools/test_email_node.js
```

> This is the test that would have caught the September 2026 outage, in which
> FormSubmit answered every submission with a 500 and the app still reported
> success. It fails if a refusal from the mail service (502, 429, 401/403) is ever
> answered as a success again, if a 503 / unreachable service is ever reported as
> delivered, if the recipient is ever taken from the request instead of the
> service's own setting, or if the PDF stops travelling in the `attachment` field.

The optional call-recording panel has its own plain-Node test, which drives the
module in a stub page and checks that a recording is per-application and is
forgotten on clear:

```bash
node tools/test_recording_node.js
```

The service worker's caching strategy has a plain-Node test too — it drives
`sw.js` in a stub scope, so a page that a deploy should have replaced cannot go
back to being served from the cache:

```bash
node tools/test_sw_node.js
```

The smoke test checks that every asset `index.html` references exists, that the
HTML itself is sane (ids used by the tests, no accidentally locked field), and
that serving the folder over HTTP answers 200 for the entry points:

```bash
node tools/smoke_test.js
```

> It fails if any box in the *ITC Report Details* panel becomes `readonly` again
> — those boxes are typed in by hand when there is no report to extract — if
> any of the applicant fields a signing link is built from (`name`, `surname`,
> `id`, `cell`, `whatsapp`, `email`) is ever locked, if a *Client Digital Signing*
> panel loses one of its controls, if its number or email stops being editable, or
> if the panels move inside the form (where a PDF render would pick them up). Only
> the two calculated totals (`debitOrderAmount`, `expenseTotal`) and the two
> generated-link boxes (`sigLink1`, `sigLink2`) may stay readonly.

The signing panels have a plain-Node test of their own — `js/signature.js` in a
stub page with a recording `window.open`, so the WhatsApp URL that *would* have
been opened can be read, and a fetch that answers the signing service:

```bash
node tools/test_signing_link_node.js
```

> It fails if the link is no longer shown in the panel's own box, if the
> confirmation a press produces is overwritten by the status line (which is what
> happened before, so the message was never seen), if a number corrected in the
> panel is ignored, if "Send via Email" stops being a `mailto:` addressed to the
> client with the link in the body, or ever starts posting the signing link
> anywhere, if an address that is not one is dialled instead of refused, if a
> corrected number is overwritten by a later prefill, or if a panel's link and
> contact details survive **New Application**.

## Security notes

- The app runs entirely in the browser; extracted data never leaves the device
  except when you submit (PDF → email service), when you export the tracker workbook
  (**Submit to Tracker** / **Export Tracker**), or when you create a signing
  request (**Generate Signing Link** → applicant name, ID and contact details only).
  **Send via WhatsApp** opens WhatsApp on your own device — the message is only
  sent when you press Send there; **Send via Email** opens your own mail app with
  the link written and the client addressed, and is sent only when you press Send
  there. Neither hands the link to a server to mail for you.
- Drafts are stored **only** in the browser's `localStorage` on the device that
  created them — never on a server, never in git.
- Datanamix reports contain personal data — host this app somewhere you
  control and only process reports you are authorised to handle.
