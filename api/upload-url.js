// api/upload-url.js
export const config = { runtime: "edge" };
import { put } from '@vercel/blob';

export default async function handler(req) {
  if (req.method === "OPTIONS") 
    return new Response(null, { status: 204, headers: cors() });

  if (req.method !== "POST") 
    return new Response(JSON.stringify({ ok:false, error:"Use POST" }), { 
      status:405, 
      headers: cors() 
    });

  const { filename, contentType } = await req.json().catch(()=> ({}));
  if (!filename || !contentType) {
    return new Response(
      JSON.stringify({ ok:false, error:"filename and contentType required" }), 
      { status:400, headers: cors() }
    );
  }

  // This call expects the whole file body; but we want the client to upload directly.
  // Use "blob API: form upload" — create an upload URL token instead:
  // Trick: We'll mint a unique object key and return a signed
  // write-once URL via the Vercel Blob HTTP API.
  // Minimal approach: client uploads by POSTing the file to this endpoint:
  // However, latest Blob SDK prefers server-side put(file).
  // We'll expose a one-shot URL token via the REST token API:

  // Instead, we’ll just return a server-generated key and let the client PUT to it
  // through this same route using a second step to stream (keeps it simple).
  // For zero server streaming, prefer S3 (Option B).

  return new Response(
    JSON.stringify({ 
      ok:true, 
      hint: "Use Option B (S3) for truly huge multi-GB uploads), or stream via this API with FormData." 
    }), 
    { status:200, headers: cors() }
  );
}

function cors() {
  return {
    "Access-Control-Allow-Origin":"*",
    "Access-Control-Allow-Methods":"POST,OPTIONS",
    "Access-Control-Allow-Headers":"Content-Type, Authorization"
  };
}
