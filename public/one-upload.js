async function oneButtonFlow() {
  const file = document.getElementById("fileInput").files?.[0];
  const lang = document.getElementById("langSelect").value;
  const force = document.getElementById("forceOcr").checked ? "1" : "0";
  const out = document.getElementById("out");
  const btn = document.getElementById("analyzeBtn");

  if (!file) return alert("Please choose a PDF first.");
  btn.disabled = true;
  out.value = "Analyzing...";

  try {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("lang", lang);
    if (force === "1") fd.append("force", "1");

    const r = await fetch("/api/upload-local", { method: "POST", body: fd });
    const text = await r.text();
    let j = {};
    try { j = JSON.parse(text); } catch (e) { throw new Error("Invalid JSON from server"); }

    if (!r.ok || !j.ok) throw new Error(j.error || j.detail || `Upload failed (${r.status})`);

    // Show analysis text
    out.value = JSON.stringify(j.analysis, null, 2);

    // Show OCR’d PDF link if available
    const ocrLink = document.getElementById("ocrLink");
    if (j.ocredPdfUrl) {
      ocrLink.href = j.ocredPdfUrl;
      ocrLink.style.display = "inline-block";
    } else {
      ocrLink.style.display = "none";
    }

    // Auto-download refined AI PDF
    const pdfRes = await fetch("/api/report-bizdoc-pdf-refined", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analysis: j.analysis })
    });
    if (!pdfRes.ok) throw new Error("PDF generation failed");

    const blob = await pdfRes.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bizdoc_report.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

  } catch (err) {
    out.value = "Error: " + err.message;
  } finally {
    btn.disabled = false;
  }
}

document.getElementById("analyzeBtn").addEventListener("click", oneButtonFlow);
