// ITC PDF extraction — reads a Datanamix report with pdf.js and returns
// the parsed data object (fields + creditor accounts).
(function () {
  'use strict';

  const PDFJS = window.pdfjsLib;
  PDFJS.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read the selected file.'));
      reader.readAsArrayBuffer(file);
    });
  }

  async function extract(file, password) {
    const data = await readFile(file);

    let pdf;
    try {
      pdf = await PDFJS.getDocument({
        data,
        password: password || '',
        verbosity: 0,
        isEvalSupported: false,
      }).promise;
    } catch (e) {
      if (e && e.name === 'PasswordException') {
        const err = new Error(
          e.code === 2
            ? 'The password you entered is incorrect. Please try again.'
            : 'This PDF is password protected. Enter its password to extract the data.',
        );
        err.code = e.code === 2 ? 'INCORRECT_PASSWORD' : 'PASSWORD_REQUIRED';
        throw err;
      }
      throw new Error('Failed to open the PDF: ' + (e && e.message ? e.message : e));
    }

    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent({ normalizeWhitespace: true });
      text += '\n' + tc.items.map((x) => x.str || '').join(' ');
    }

    if (window.ITCParser.clean(text).length < 60) {
      throw new Error('No readable text was found in the PDF. It may be a scanned image report, which cannot be extracted as text.');
    }

    const parsed = window.ITCParser.parseText(text);
    parsed.pages = pdf.numPages;
    return parsed;
  }

  window.ITCExtractor = { extract };
})();
