import fontkit from "fontkit";
/**
 * BizDocAE client helper — no imports, no fontkit, no pdf-lib in browser.
 * Uses the server /api/report to generate the PDF, then triggers a download.
 */
(function () {
  async function downloadReport(analysis) {
    const resp = await fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ analysis })
    });
    if (!resp.ok) throw new Error('Report generation failed');
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (analysis && analysis.title ? analysis.title : 'BizDocAE_Report') + '.pdf';
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    a.remove();
  }

  window.bizdoc = window.bizdoc || {};
  window.bizdoc.downloadReport = downloadReport;
})();
