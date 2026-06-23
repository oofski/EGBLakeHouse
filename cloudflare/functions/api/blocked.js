/* ============================================================
   POST /api/blocked
   ------------------------------------------------------------
   Body = { date, reason }. Inserts or replaces a blocked date.

   Response: { ok: true }
   ============================================================ */
"use strict";

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  try {
    const body = (await request.json()) || {};
    const date = body.date;
    if (!date) return json({ error: "missing date" }, 400);
    const reason = body.reason || "";

    await env.DB.prepare(
      "INSERT OR REPLACE INTO blocked_dates (date, reason) VALUES (?, ?)"
    ).bind(String(date).slice(0, 10), reason).run();

    return json({ ok: true });
  } catch (e) {
    return json({ error: (e && e.message) || String(e) }, 500);
  }
}
