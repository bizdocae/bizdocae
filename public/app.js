(async function () {
  const btn = document.getElementById("analyzeBtn") || document.querySelector("button");
  const fileInput = document.querySelector('input[type="file"]');
  const statusBox = document.getElementById("status") || document.querySelector("#statusBox");

  function setStatus(html, isError=false) {
    if (!statusBox) return;
    statusBox.innerHTML = html;
    statusBox.style.color = isError ? "#b00020" : "#0b5";
  }

  async function readFileAsBase64(file) {
    const buf = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  btn.onclick = async () => {
    try {
      setStatus("Analyzing…");
      const f = fileInput && fileInput.files && fileInput.files[0];

      // 1) Build request for your existing /api/analyze
      const payload = {
        filename: f ? f.name : "document.txt",
        mimetype: f ? (f.type || "application/octet-stream") : "text/plain",
        base64: f ? await readFileAsBase64(f) : btoa("No file uploaded."),
        wantText: true
      };

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const t = await res.text().catch(()=> "");
        throw new Error(`Analyze failed: ${res.status} ${t || res.statusText}`);
      }

      const analysis = await res.json();

      // 2) Build a human-readable summary and send to client PDF generator
      const title = analysis?.analysis?.title || "BizDoc Analysis";
      const exec = analysis?.analysis?.executive_summary || analysis?.analysis?.summary || "";
      const bullets = Array.isArray(analysis?.analysis?.key_findings)
        ? analysis.analysis.key_findings.map(k => ({
            label: k.label || k.name || "Item",
            value: k.detail || k.value || ""
          }))
        : [];

      await window.generateClientPDF({
        title,
        text: exec || "Your analysis is ready.",
        highlights: bullets
      });

      setStatus("✓ Downloaded BizDoc_Report.pdf");
    } catch (e) {
      console.error(e);
      setStatus(`✗ ${e.message}`, true);
    }
  };
})();
