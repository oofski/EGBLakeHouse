/* ============================================================
   DELETE /api/blocked/:date
   ------------------------------------------------------------
   Removes a blocked date.

   Response: { ok: true }
   ============================================================ */
"use strict";

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}

export async function onRequestDelete(context) {
  const { env, params } = context;
  try {
    const date = String(params.date).slice(0, 10);
    await env.DB.prepare("DELETE FROM blocked_dates WHERE date = ?").bind(date).run();
    return json({ ok: true });
  } catch (e) {
    return json({ error: (e && e.message) || String(e) }, 500);
  }
}
