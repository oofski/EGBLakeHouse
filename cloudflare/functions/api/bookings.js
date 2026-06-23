/* ============================================================
   POST /api/bookings
   ------------------------------------------------------------
   Body = a full booking object (as produced by booking.html).
   For each file slot whose value is a "data:" URL we decode the
   base64 payload, store the bytes in R2 under `${id}/${slot}`,
   then strip the bytes from the JSON (keeping name/type) before
   the booking row is written to D1. The signature (a data: PNG)
   is handled the same way.

   Response: { ok: true }
   ============================================================ */
"use strict";

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}

// Parse a data: URL into { mime, bytes:Uint8Array } or null if not a data URL.
function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== "string" || dataUrl.slice(0, 5) !== "data:") return null;
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return null;
  const meta = dataUrl.slice(5, comma); // e.g. "image/jpeg;base64"
  const isBase64 = /;base64/i.test(meta);
  const mime = meta.split(";")[0] || "application/octet-stream";
  const raw = dataUrl.slice(comma + 1);
  let bytes;
  if (isBase64) {
    const bin = atob(raw);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } else {
    bytes = new TextEncoder().encode(decodeURIComponent(raw));
  }
  return { mime: mime, bytes: bytes };
}

async function storeSlot(env, id, slot, doc) {
  // doc is documents[slot]; only upload when it carries inline data: bytes.
  if (!doc || typeof doc.data !== "string") return;
  const parsed = parseDataUrl(doc.data);
  if (!parsed) return;
  await env.FILES.put(id + "/" + slot, parsed.bytes, {
    httpMetadata: { contentType: doc.type || parsed.mime }
  });
  delete doc.data;
  doc.stored = true; // keep name/type, drop the bytes
}

export async function onRequestPost(context) {
  const { env, request } = context;
  try {
    const b = await request.json();
    if (!b || !b.id) return json({ error: "missing id" }, 400);

    b.documents = b.documents || {};

    // Move file slots into R2, stripping the bytes from the JSON.
    await storeSlot(env, b.id, "driversLicense", b.documents.driversLicense);
    await storeSlot(env, b.id, "boatingLicense", b.documents.boatingLicense);

    // Signature is a standalone data: PNG, not under documents.
    const sig = parseDataUrl(b.signature);
    if (sig) {
      await env.FILES.put(b.id + "/signature", sig.bytes, {
        httpMetadata: { contentType: sig.mime || "image/png" }
      });
      b.signature = "";
      b.signatureStored = true;
    }

    const renter = b.renter || {};
    const renterName = ((renter.firstName || "") + " " + (renter.lastName || "")).trim();

    await env.DB.prepare(
      "INSERT OR REPLACE INTO bookings " +
      "(id, status, renter_name, email, business, purpose, employee_name, check_in, check_out, submitted_at, data) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      b.id,
      b.status || "pending",
      renterName,
      renter.email || "",
      renter.department || "",
      b.purpose || "",
      b.employeeName || "",
      b.checkIn || "",
      b.checkOut || "",
      b.submittedAt || "",
      JSON.stringify(b)
    ).run();

    return json({ ok: true });
  } catch (e) {
    return json({ error: (e && e.message) || String(e) }, 500);
  }
}
