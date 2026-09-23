// PDF generation — renders the application form to a multi-page A4 landscape
// PDF (matching the wide desktop layout) using html2canvas + jsPDF, then
// returns the PDF as a Blob. Page breaks are detected from the rendered canvas
// itself and only ever fall on rows that carry no ink, so a page never cuts
// through a word, a label, a rule or a table row, on any device.
(function () {
  'use strict';

  // Rows in the rendered canvas where a page break is SAFE: a row that carries
  // no ink (no text, no rule) — only thin vertical borders at most. Cutting
  // there can never slice a word, a label, a rule or a table row. The previous
  // approach snapped cuts to `.section`/`.footer` tops, but this form has only
  // one of each, so cuts fell almost anywhere — through the Expenses rows (the
  // Transport label and field were cut in half between pages 2 and 3).
  //
  // Measured from the canvas itself, so it is correct on every device:
  // html2canvas always lays the form out at the desktop width, whereas the live
  // clone follows the page's own media queries — DOM rects are NOT a reliable
  // source of canvas positions on phones.
  function blankRows(canvas) {
    // Work on a downscaled copy: one probe row ≈ one CSS pixel, which is plenty
    // of resolution to find a whitespace band and keeps the pixel walk cheap on
    // phones (the full canvas can be 3000 x 3000).
    const w = Math.min(canvas.width, 1500);
    const down = w / canvas.width;
    const h = Math.max(1, Math.round(canvas.height * down));
    const probe = document.createElement('canvas');
    probe.width = w;
    probe.height = h;
    const ctx = probe.getContext('2d');
    ctx.drawImage(canvas, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    // A row inside a bordered box still carries that box's 1 px vertical edges,
    // so a few ink pixels are tolerated. Any row holding text or a horizontal
    // rule blows past the tolerance and is rejected.
    const inkTolerance = 6;
    const x0 = Math.floor(w * 0.05);
    const x1 = w - Math.floor(w * 0.05);
    const rows = [];
    for (let y = 0; y < h; y++) {
      const base = y * w * 4;
      let ink = 0;
      for (let x = x0; x < x1; x++) {
        const o = base + x * 4;
        const lum = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
        if (lum < 232) {
          ink++;
          if (ink > inkTolerance) break;
        }
      }
      if (ink <= inkTolerance) rows.push(Math.round(y / down));
    }
    return rows;
  }

  // opts: { scale, quality } — lower both to shrink the output when it would
  // exceed FormSubmit's 10 MB attachment limit (see js/email.js / js/app.js).
  async function generate(elm, opts) {
    if (!window.html2canvas || !window.jspdf) {
      throw new Error('PDF libraries failed to load. Check that vendor/ files are present.');
    }

    const scale = (opts && opts.scale) || 2;
    const quality = (opts && opts.quality) != null ? opts.quality : 0.92;

    // The form is designed for a wide desktop layout. Rendering a hidden clone
    // at this fixed width keeps phone/desktop PDFs identical and matches the
    // canvas html2canvas produces (see blankRows).
    const PDF_LAYOUT_WIDTH = 1500;

    const clone = elm.cloneNode(true);
    clone.removeAttribute('id');
    clone.style.position = 'absolute';
    clone.style.left = '-10000px';
    clone.style.top = '0';
    clone.style.margin = '0';
    clone.style.width = PDF_LAYOUT_WIDTH + 'px';
    clone.setAttribute('aria-hidden', 'true');
    document.body.appendChild(clone);

    // Carry over the current field values into the clone. File inputs are
    // skipped: their value is a fake path ("C:\fakepath\…") and the DOM only
    // allows clearing it — assigning a non-empty value throws
    // ("This input element accepts a filename, which may only be
    // programmatically set to the empty string"), which used to break EVERY
    // submit once an ITC report had been chosen (the ITC upload lives inside
    // #formPage). The order of the remaining fields is unchanged, so the
    // src/dst pairing below stays valid.
    const srcFields = elm.querySelectorAll('input, select, textarea');
    const dstFields = clone.querySelectorAll('input, select, textarea');
    srcFields.forEach((src, i) => {
      const dst = dstFields[i];
      if (!dst) return;
      if (src.type === 'file' || dst.type === 'file') return;
      if (dst.type === 'checkbox' || dst.type === 'radio') dst.checked = !!src.checked;
      else dst.value = src.value;
    });

    // App chrome inside the page (ITC upload panel + ITC report-details review)
    // must never appear in the emailed document — the original's PDF captures
    // only the application form sections.
    clone.querySelectorAll('.itc-panel, .itc-review').forEach((node) => {
      if (node.parentNode) node.parentNode.removeChild(node);
    });

    try {
      const canvas = await window.html2canvas(clone, {
        scale: scale,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        windowWidth: PDF_LAYOUT_WIDTH + 2,
      });

      const { jsPDF } = window.jspdf;
      // A4 landscape, working in millimetres — matches the wide desktop layout.
      const pdf = new jsPDF({ orientation: 'l', unit: 'mm', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();   // 297 mm
      const pageH = pdf.internal.pageSize.getHeight();  // 210 mm

      const img = canvas.toDataURL('image/jpeg', quality);
      const imgW = canvas.width;
      const imgH = canvas.height;
      const mmPerPx = pageW / imgW;              // one canvas pixel, in mm
      const pageHeightPx = pageH / mmPerPx;      // one A4 page tall, in canvas px

      // If the rendered form fits comfortably on one A4 page (within a slight margin),
      // render it directly as a clean single-page PDF with no page splits.
      if (imgH <= pageHeightPx * 1.08) {
        const renderH = Math.min(pageH, (imgH / imgW) * pageW);
        pdf.addImage(img, 'JPEG', 0, 0, pageW, renderH);
        return pdf.output('blob');
      }

      // Multi-page: break ONLY on canvas rows that carry no ink (see blankRows).
      const safeRows = blankRows(canvas);

      const cuts = [];
      let cursor = 0;
      let pageNo = 0;
      while (cursor < imgH - 1) {
        const limit = Math.min(cursor + pageHeightPx, imgH);
        let cut = limit;

        if (limit < imgH) {
          // Prefer the deepest safe row that still fills most of the page, so
          // pages stay full and no row of content is ever sliced. Fall back to
          // a safe row that fills at least a quarter of the page, and only to
          // the raw page boundary if the canvas offers nothing safe at all.
          const minFull = cursor + Math.round(pageHeightPx * 0.7);
          const minSome = cursor + Math.round(pageHeightPx * 0.25);
          let deepest = 0;
          let deepestFull = 0;
          for (const y of safeRows) {
            if (y > limit) break;
            if (y <= cursor + 4) continue;
            if (y >= minSome) deepest = y;
            if (y >= minFull) deepestFull = y;
          }
          if (deepestFull) cut = deepestFull;
          else if (deepest) cut = deepest;
        }

        cuts.push(cut);
        if (pageNo > 0) pdf.addPage();
        pdf.addImage(img, 'JPEG', 0, -cursor * mmPerPx, pageW, imgH * mmPerPx);
        cursor = cut;
        pageNo += 1;
      }

      // Diagnostics (also used by the pagination regression test): the canvas
      // row each page break landed on.
      window.ITCPdf.lastCutRows = cuts;

      return pdf.output('blob');
    } finally {
      clone.parentNode && clone.parentNode.removeChild(clone);
    }
  }

  window.ITCPdf = { generate };
})();
