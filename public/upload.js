// ---------- upload.js ----------
// Handles uploading PDFs up to ~10MB directly to /api/upload-local
async function uploadPdf(file) {
  if (!file) throw new Error("No file selected");
  if (file.type !== "application/pdf") throw new Error("Please pick a PDF");

  const fd = new FormData();
  fd.append("file", file);

  const r = await fetch("/api/upload-local", {
    method: "POST",
    body: fd, // Do NOT set Content-Type manually
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) {
    throw new Error(j.error || `Upload failed HTTP ${r.status}`);
  }

  // Handle returned analysis
  console.log("✅ Analysis received:", j.analysis);
  alert("Upload success! Check console for analysis.");
  return j.analysis;
}

// ---------- Example usage in HTML ----------
document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("pdfUpload");
  if (input) {
    input.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      uploadPdf(file)
        .then(() => console.log("Upload complete"))
        .catch((err) => alert("Upload error: " + err.message));
    });
  }
});
