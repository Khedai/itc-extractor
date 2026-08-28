// PDF generation — renders the on-screen application form to a multi-page A4
// PDF using html2canvas + jsPDF, then returns the PDF as a Blob.
(function () {
  'use strict';

  async function generate(elm) {
    if (!window.html2canvas || !window.jspdf) {
      throw new Error('PDF libraries failed to load. Check that vendor/ files are present.');
    }

    const canvas = await window.html2canvas(elm, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth: Math.max(elm.scrollWidth || 1400, 1000),
    });

    const { jsPDF } = window.jspdf;
    // A4 portrait, working in millimetres.
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();   // 210 mm
    const pageH = pdf.internal.pageSize.getHeight();  // 297 mm

    const img = canvas.toDataURL('image/jpeg', 0.92);
    // Render the whole canvas image at page width; the height scales accordingly.
    const imgH = (canvas.height * pageW) / canvas.width;

    let heightLeft = imgH;
    let position = 0;
    pdf.addImage(img, 'JPEG', 0, position, pageW, imgH);
    heightLeft -= pageH;

    while (heightLeft > 0) {
      position -= pageH;
      pdf.addPage();
      pdf.addImage(img, 'JPEG', 0, position, pageW, imgH);
      heightLeft -= pageH;
    }

    return pdf.output('blob');
  }

  window.ITCPdf = { generate };
})();
