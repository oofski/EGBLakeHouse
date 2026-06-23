/* ============================================================
   GET /api/state
   ------------------------------------------------------------
   Returns the full booking + blocked-date state for the client
   cache. File bytes are NOT inlined — instead each stored file
   placeholder is rehydrated into a usable URL the browser can
   fetch on demand (GET /api/file/:id/:slot).

   Response: { bookings: [...], blocked: [{date, reason}] }
   ============================================================ */
"use strict";

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}

export async function onRequestGet(context) {
  const { env } = context;
  try {
    const bookingsRes = await env.DB
      .prepare("SELECT id, status, data FROM bookings")
      .all();

    const bookings = (bookingsRes.results || []).map((row) => {
      let b;
      try {
        b = JSON.parse(row.data || "{}");
      } catch (e) {
        b = {};
      }
      b.id = row.id;
      // The status column is the source of truth (admin updates it directly).
      b.status = row.status;

      // Replace stored-file placeholders with fetchable URLs so the admin
      // page can render <img>/<iframe> straight from these src values.
      if (b.documents && b.documents.driversLicense) {
        b.documents.driversLicense.data = "/api/file/" + row.id + "/driversLicense";
      }
      if (b.documents && b.documents.boatingLicense) {
        b.documents.boatingLicense.data = "/api/file/" + row.id + "/boatingLicense";
      }
      // A stored signature becomes a fetchable PNG URL.
      if (b.signatureStored) {
        b.signature = "/api/file/" + row.id + "/signature";
      }
      return b;
    });

    const blockedRes = await env.DB
      .prepare("SELECT date, reason FROM blocked_dates")
      .all();
    const blocked = (blockedRes.results || []).map((r) => ({
      date: r.date,
      reason: r.reason || ""
    }));

    return json({ bookings: bookings, blocked: blocked });
  } catch (e) {
    return json({ error: (e && e.message) || String(e) }, 500);
  }
}
