// PDF generation — renders the application form to a multi-page A4 landscape
// PDF (matching the wide desktop layout) using html2canvas + jsPDF, then
// returns the PDF as a Blob. Page breaks are detected from the rendered canvas
// itself and only ever fall on full-width divider rules, so a page never cuts
// through a word, a section or a table row, on any device.
(function () {
  'use strict';

  // Find horizontal "safe" rows in the rendered canvas. A cut is safe only when
  // it lands on a full-width horizontal RULE (a thin dark line spanning nearly
  // the whole page): section dividers, the navy rule under the header, grid
  // borders. Table content never qualifies — the loans table's row borders cover
  // only ~70% of the width and its inputs are borderless white boxes, so a cut
  // can never slice through a table row. Previously the page ending could land
  // in the middle of the credit obligations table (rows ~6-7 were clipped); the
  // algorithm below guarantees cuts only ever occur on such rules.
  //
  // Because the lines are measured from the canvas itself they are pixel-accurate
  // on every device (html2canvas always lays the form out at the desktop width,
  // so the canvas is the single source of truth — DOM rects are NOT: the page's
  // own media queries put the clone in the mobile layout on phones).
  function detectBreakLines(canvas, imgH) {
    const step = 2;                      // sample every 2nd pixel
    const x0 = Math.floor(canvas.width * 0.05);
    const x1 = canvas.width - Math.floor(canvas.width * 0.05);
    const samples = Math.ceil((x1 - x0) / step);
    const minDark = samples * 0.85;      // ≥85% of the scanned width must be dark

    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

    // 1) Rows that are "mostly a line" (a rule across the width).
    const lineRows = [];
    for (let y = 0; y < canvas.height; y++) {
      let dark = 0;
      const base = y * canvas.width;
      for (let x = x0; x < x1; x += step) {
        const o = (base + x) * 4;
        const lum = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
        if (lum < 230) dark++;
      }
      if (dark >= minDark) lineRows.push(y);
    }

    // 2) Group adjacent line rows into bands (a rule may be 1-4 px tall).
    const bands = [];
    let start = null, prev = null;
    for (const y of lineRows) {
      if (start === null) { start = y; prev = y; continue; }
      if (y - prev > 4) { bands.push(Math.round((start + prev) / 2)); start = y; }
      prev = y;
    }
    if (start !== null) bands.push(Math.round((start + prev) / 2));

    // 3) Keep only ISOLATED thin rules. The navy table-header row is a ~50 px
    //    solid band, not a divider — its edges are rejected because dark rows
    //    continue on one side. A real divider has light rows above AND below.
    const isDarkRow = (y) => {
      if (y < 0 || y >= canvas.height) return false;
      let dark = 0, n = 0;
      const base = y * canvas.width;
      for (let x = x0; x < x1; x += 4) {
        const o = (base + x) * 4;
        const lum = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
        if (lum < 230) dark++;
        n++;
      }
      return dark / n > 0.5;
    };
    const rules = bands.filter((y) => {
      let above = 0, below = 0;
      for (let d = 5; d <= 14; d++) {
        if (isDarkRow(y - d)) above++;
        if (isDarkRow(y + d)) below++;
      }
      return above <= 1 && below <= 1;
    });

    // Cut 3 px below each rule so the rule stays with the content above it.
    return rules.map((y) => Math.min(y + 3, imgH - 1)).filter((y) => y > 1 && y < imgH - 2);
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
