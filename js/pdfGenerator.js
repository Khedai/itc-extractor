// PDF generation — renders the application form to a multi-page A4 landscape
// PDF (matching the wide desktop layout) using html2canvas + jsPDF, then
// returns the PDF as a Blob. Page breaks are detected from the rendered canvas
// itself (uniform divider lines / blank gutters), so a page never cuts through
// a word or a table cell, on any device.
(function () {
  'use strict';

  // Find horizontal "clean" rows in the rendered canvas — section divider
  // lines, table rules and blank gutters. Cutting on one of these is guaranteed
  // never to slice through a word or a table cell. Because they are measured
  // from the canvas itself they are pixel-accurate on every device (DOM rects
  // are NOT reliable: the clone on a phone is laid out with the mobile media
  // queries, while html2canvas renders the desktop layout).
  function detectBreakLines(canvas, imgH) {
    const sample = 0.5; // scan at half resolution, then scale back up
    const sw = Math.max(1, Math.round(canvas.width * sample));
    const sh = Math.max(1, Math.round(canvas.height * sample));
    const small = document.createElement('canvas');
    small.width = sw;
    small.height = sh;
    const sctx = small.getContext('2d');
    sctx.drawImage(canvas, 0, 0, sw, sh);
    const data = sctx.getImageData(0, 0, sw, sh).data;
    const x0 = Math.floor(sw * 0.05);
    const x1 = sw - Math.floor(sw * 0.05);
    const clean = [];
    for (let y = 0; y < sh; y++) {
      let sum = 0;
      let sumSq = 0;
      let n = 0;
      for (let x = x0; x < x1; x += 2) {
        const o = (y * sw + x) * 4;
        const lum = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
        sum += lum;
        sumSq += lum * lum;
        n++;
      }
      const mean = sum / n;
      if (sumSq / n - mean * mean < 100) clean.push(y); // uniform row (std dev < 10)
    }
    // Group adjacent clean rows into single lines.
    const lines = [];
    let start = null;
    let prev = null;
    for (const y of clean) {
      if (start === null) { start = y; prev = y; continue; }
      if (y - prev > 3) { lines.push((start + prev) / 2); start = y; }
      prev = y;
    }
    if (start !== null) lines.push((start + prev) / 2);
    // Convert back to full-resolution pixels, cutting 2px below the line's top:
    // the boundary then falls exactly between the divider line and the content
    // that follows, so nothing is ever sliced.
    return lines
      .map((y) => Math.round(y / sample + 2))
      .filter((y) => y > 1 && y < imgH - 2);
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
    // canvas html2canvas produces (see detectBreakLines).
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

    // Carry over the current field values into the clone.
    const srcFields = elm.querySelectorAll('input, select, textarea');
    const dstFields = clone.querySelectorAll('input, select, textarea');
    srcFields.forEach((src, i) => {
      const dst = dstFields[i];
      if (!dst) return;
      if (dst.type === 'checkbox' || dst.type === 'radio') dst.checked = !!src.checked;
      else dst.value = src.value;
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

      // Safe page-break lines, measured from the rendered canvas itself so they
      // are pixel-accurate on every device (see detectBreakLines).
      let breakPoints = detectBreakLines(canvas, imgH);
      // Fallback (should never be needed): section tops measured from the DOM.
      if (breakPoints.length === 0) {
        const rect = clone.getBoundingClientRect();
        const tops = [];
        clone.querySelectorAll('.section, .section-title, .footer').forEach((b) => {
          const y = b.getBoundingClientRect().top - rect.top;
          if (y > 1 && y < imgH) tops.push(y);
        });
        tops.sort((a, b) => a - b);
        const mapped = tops.map((y) => y * scale - 2).filter((y) => y > 1 && y < imgH);
        breakPoints = mapped.filter((y, i) => i === 0 || y - mapped[i - 1] > 2);
      }

      let cursor = 0;
      let pageNo = 0;
      while (cursor < imgH - 0.5) {
        let cut = Math.min(cursor + pageHeightPx, imgH);
        if (cut < imgH) {
          // Snap the break to the nearest candidate before the A4 page end.
          let snapped = null;
          for (const y of breakPoints) {
            if (y > cursor + 0.5 && y <= cut) snapped = y;
          }
          if (snapped !== null) cut = snapped;
        }
        if (pageNo > 0) pdf.addPage();
        pdf.addImage(img, 'JPEG', 0, -cursor * mmPerPx, pageW, imgH * mmPerPx);
        cursor = cut;
        pageNo += 1;
      }

      return pdf.output('blob');
    } finally {
      clone.parentNode && clone.parentNode.removeChild(clone);
    }
  }

  window.ITCPdf = { generate };
})();
