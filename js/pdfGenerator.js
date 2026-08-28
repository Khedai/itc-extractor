// PDF generation — renders the application form to a multi-page A4 landscape
// PDF (matching the wide desktop layout) using html2canvas + jsPDF, then
// returns the PDF as a Blob. Page breaks are snapped to the top of each section
// so a block (e.g. the Expenses & Consent declaration) is never cut off.
(function () {
  'use strict';

  // opts: { scale, quality } — lower both to shrink the output when it would
  // exceed FormSubmit's 10 MB attachment limit (see js/email.js / js/app.js).
  async function generate(elm, opts) {
    if (!window.html2canvas || !window.jspdf) {
      throw new Error('PDF libraries failed to load. Check that vendor/ files are present.');
    }

    const scale = (opts && opts.scale) || 2;
    const quality = (opts && opts.quality) != null ? opts.quality : 0.92;

    // The form is designed for a wide desktop layout. Rendering a hidden clone
    // at this fixed width keeps phone/desktop PDFs identical and lets the DOM
    // measurements below line up pixel-for-pixel with the canvas.
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

      // Candidate page breaks = the top of every section, section title and the
      // footer. A page break snaps to the last candidate that fits on the page,
      // so a block (e.g. the Expenses & Consent declaration) is never split.
      const rect = clone.getBoundingClientRect();
      const tops = [];
      clone.querySelectorAll('.section, .section-title, .footer').forEach((b) => {
        const y = b.getBoundingClientRect().top - rect.top;
        if (y > 1) tops.push(y);
      });
      tops.sort((a, b) => a - b);
      const mapped = tops.map((y) => y * scale - 2).filter((y) => y > 1 && y < imgH);
      const breakPoints = mapped.filter((y, i) => i === 0 || y - mapped[i - 1] > 2);

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
