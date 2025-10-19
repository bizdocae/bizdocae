// Single upload button: upload -> analyze -> show -> download PDF
async function oneButtonFlow(file) {
  const out = document.getElementById("oneUploadOutput");
  const btn = document.getElementById("oneUploadBtn");
  const spin = (s)=>{ if(out) out.value = s; };

  if (!file) { alert("Pick a PDF first"); return; }
  if (file.type !== "application/pdf") { alert("Please select a PDF file"); return; }

  try {
    btn && (btn.disabled = true);
    spin("Uploading and analyzing...\n");

    // Step 1: upload to /api/upload-local -> returns analysis JSON
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/upload-local", { method:"POST", body: fd });
    const j = await r.json().catch(()=> ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || `Upload/Analyze failed HTTP ${r.status}`);

    // Show analysis JSON nicely
    const analysis = j.analysis || {};
    spin("Analysis (refined):\n" + JSON.stringify(analysis, null, 2));

    // Step 2: Download AI PDF (double-refined) using the analysis directly
    const pdfResp = await fetch("/api/report-bizdoc-pdf-refined", {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ analysis }) // route accepts {analysis} and runs post-refine before rendering PDF
    });
    if (!pdfResp.ok) {
      const txt = await pdfResp.text().catch(()=> "");
      throw new Error("PDF generation failed: " + txt.slice(0,300));
    }

    const blob = await pdfResp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bizdoc_report.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error(e);
    alert(e.message || String(e));
  } finally {
    btn && (btn.disabled = false);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("oneUploadInput");
  const btn = document.getElementById("oneUploadBtn");
  if (!input || !btn) return;

  btn.addEventListener("click", () => {
    const f = input.files?.[0];
    oneButtonFlow(f);
  });
});
