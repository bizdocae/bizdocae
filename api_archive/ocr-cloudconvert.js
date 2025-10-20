export const config = { runtime: "nodejs" };

/**
 * POST /api/ocr-cloudconvert
 * Body: { url: "https://public/file.pdf", wantText?: boolean, languages?: string[] }
 *
 * Returns: { ok, jobId, searchable_pdf_url, text_url? }
 */
const CC_API = "https://api.cloudconvert.com/v2";

function cors(res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization");
}
async function ccReq(path, method, body){
  const r = await fetch(`${CC_API}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${process.env.CLOUDCONVERT_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!r.ok) throw new Error(`CloudConvert ${method} ${path} -> ${r.status}`);
  return r.json();
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"Method not allowed" });

  try {
    const { url, wantText = true, languages = ["eng","ara"] } = req.body || {};
    if (!process.env.CLOUDCONVERT_API_KEY) {
      return res.status(500).json({ ok:false, error:"Missing CLOUDCONVERT_API_KEY" });
    }
    if (!url) return res.status(400).json({ ok:false, error:"Provide {url} to a publicly accessible PDF/image" });

    // 1) Build a job with tasks: import/url -> (conditionally convert image->pdf) -> pdf/ocr -> (optional) pdf->txt -> export/url
    // CloudConvert accepts PDF OCR at /pdf/ocr (preview). We’ll feed it a PDF.
    // If user sends an image, we first convert it to PDF so /pdf/ocr can run on it.
    const filename = url.split("/").pop() || "input";
    const inputExt = (filename.split(".").pop() || "").toLowerCase();
    const isPdf = inputExt === "pdf";

    // Define tasks
    const tasks = {
      "import-1": {
        operation: "import/url",
        url
      }
    };

    if (!isPdf) {
      // Convert image -> PDF (keeps pages as image pages)
      tasks["to-pdf"] = {
        operation: "convert",
        input: ["import-1"],
        input_format: inputExt || "png",
        output_format: "pdf",
        filename: "from-image.pdf"
      };
    }

    // OCR the PDF — add text layer (languages list accepted)
    // API: /v2/pdf/ocr (preview) with { input: [taskId], language: ["eng","deu"], auto_orient: true }
    // https://cloudconvert.com/api/v2/pdf
    tasks["pdf-ocr"] = {
      operation: "pdf/ocr",
      input: [ isPdf ? "import-1" : "to-pdf" ],
      auto_orient: true,
      language: Array.isArray(languages) && languages.length ? languages : ["eng"]
    };

    // Optional: convert OCR'ed PDF -> TXT (extract text after OCR)
    if (wantText) {
      tasks["to-txt"] = {
        operation: "convert",
        input: ["pdf-ocr"],
        input_format: "pdf",
        output_format: "txt",
        filename: "extracted.txt"
      };
    }

    // Export (signed URLs)
    tasks["export-1"] = {
      operation: "export/url",
      input: wantText ? ["pdf-ocr","to-txt"] : ["pdf-ocr"]
    };

    // 2) Create job
    const job = await ccReq("/jobs", "POST", { tasks });
    const jobId = job?.data?.id;

    // 3) Poll until finished
    let status = job?.data?.status || "pending";
    let tries = 0;
    let finalJob = job;
    while (!["finished","error"].includes(status) && tries < 60) {
      await new Promise(r => setTimeout(r, 2000));
      finalJob = await ccReq(`/jobs/${jobId}`, "GET");
      status = finalJob?.data?.status;
      tries++;
    }
    if (status !== "finished") {
      throw new Error(`Job did not finish (status=${status})`);
    }

    // 4) Extract export URLs
    const exportTask = (finalJob?.data?.tasks || []).find(t => t.name === "export-1" || t.operation === "export/url");
    const files = exportTask?.result?.files || [];
    let searchable_pdf_url = null;
    let text_url = null;
    for (const f of files) {
      if ((f.filename || "").toLowerCase().endsWith(".pdf")) searchable_pdf_url = f.url;
      if ((f.filename || "").toLowerCase().endsWith(".txt")) text_url = f.url;
    }

    return res.status(200).json({
      ok: true,
      jobId,
      searchable_pdf_url,
      text_url
    });
  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e?.message||e) });
  }
}
