/* ============================================================
   GET /api/file/:id/:slot
   ------------------------------------------------------------
   Streams a stored file (driversLicense | boatingLicense |
   signature) back from R2. The booking + admin pages point
   <img>/<iframe> src values at these URLs.
   ============================================================ */
"use strict";

export async function onRequestGet(context) {
  const { env, params } = context;
  try {
    const key = params.id + "/" + params.slot;
    const obj = await env.FILES.get(key);
    if (!obj) {
      return new Response("Not found", { status: 404 });
    }
    return new Response(obj.body, {
      headers: {
        "Content-Type": (obj.httpMetadata && obj.httpMetadata.contentType) || "application/octet-stream",
        "Cache-Control": "private, max-age=60"
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e && e.message) || String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
