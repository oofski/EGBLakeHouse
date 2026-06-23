/* ============================================================
   PATCH  /api/bookings/:id   — merge fields into the stored row
   DELETE /api/bookings/:id   — delete the row + its R2 files
   ------------------------------------------------------------
   PATCH accepts either a partial set of fields (e.g. {status:
   "approved"}) or a whole booking object; both work because the
   incoming fields are merged into the existing data JSON. The
   status column is updated too when a status is supplied.
   ============================================================ */
"use strict";

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}

export async function onRequestPatch(context) {
  const { env, request, params } = context;
  try {
    const id = params.id;
    const incoming = (await request.json()) || {};

    const row = await env.DB
      .prepare("SELECT data FROM bookings WHERE id = ?")
      .bind(id)
      .first();
    if (!row) return json({ error: "not found" }, 404);

    let current;
    try {
      current = JSON.parse(row.data || "{}");
    } catch (e) {
      current = {};
    }

    // Merge incoming fields over the stored booking. Never let a patch change
    // the id away from the path id.
    const merged = Object.assign({}, current, incoming);
    merged.id = id;

    const status = (incoming.status != null) ? incoming.status : merged.status;
    merged.status = status;

    await env.DB.prepare(
      "UPDATE bookings SET status = ?, data = ? WHERE id = ?"
    ).bind(status || "", JSON.stringify(merged), id).run();

    return json({ ok: true });
  } catch (e) {
    return json({ error: (e && e.message) || String(e) }, 500);
  }
}

export async function onRequestDelete(context) {
  const { env, params } = context;
  try {
    const id = params.id;
    await env.DB.prepare("DELETE FROM bookings WHERE id = ?").bind(id).run();

    // Best-effort cleanup of any associated R2 objects.
    const slots = ["driversLicense", "boatingLicense", "signature"];
    for (let i = 0; i < slots.length; i++) {
      try {
        await env.FILES.delete(id + "/" + slots[i]);
      } catch (e) {
        // ignore — file may not exist
      }
    }

    return json({ ok: true });
  } catch (e) {
    return json({ error: (e && e.message) || String(e) }, 500);
  }
}
