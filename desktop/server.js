/* ============================================================
   EBG Lake House — local LAN web server
   ------------------------------------------------------------
   Hosts the booking + admin pages and a small JSON API on the
   office WiFi. Phones scan a QR code (the LAN URL) to open the
   booking page and submit; new bookings are pushed LIVE to the
   admin dashboard via Server-Sent Events.

   Runnable standalone:   DATA_DIR=./data PORT=4399 node server.js
   Or embedded from Electron via startServer({dataDir, port}).
   ============================================================ */
"use strict";

const os = require("os");
const path = require("path");
const express = require("express");
const QRCode = require("qrcode");
const { initStore } = require("./store");

// Pick the first non-internal IPv4 address (the LAN address phones use).
function getLanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      const family = typeof ni.family === "string" ? ni.family : (ni.family === 4 ? "IPv4" : "");
      if (family === "IPv4" && !ni.internal) return ni.address;
    }
  }
  return "127.0.0.1";
}

function startServer(opts) {
  opts = opts || {};
  const port = Number(opts.port) || Number(process.env.PORT) || 4399;
  const store = initStore(opts.dataDir);

  const ip = getLanIp();
  const baseUrl = "http://" + ip + ":" + port + "/";

  const app = express();
  app.use(express.json({ limit: "25mb" }));

  // ---- live updates (Server-Sent Events) ----
  const sseClients = new Set();
  function broadcast() {
    const payload = "data: " + JSON.stringify({ type: "change" }) + "\n\n";
    for (const res of sseClients) {
      try { res.write(payload); } catch (e) { /* client gone */ }
    }
  }

  // ---- static pages (booking page at "/", adapter + assets) ----
  const pub = path.join(__dirname, "public");
  app.use(express.static(pub, { index: "booking.html" }));

  // Admin page aliases
  app.get(["/admin", "/admin.html"], (req, res) => {
    res.sendFile(path.join(pub, "admin.html"));
  });

  // ---- API ----
  app.get("/api/info", (req, res) => {
    res.json({ url: baseUrl, ip, port });
  });

  app.get("/api/state", (req, res) => {
    res.json(store.getState());
  });

  app.post("/api/bookings", (req, res) => {
    const b = req.body;
    if (!b || !b.id) return res.status(400).json({ ok: false, error: "missing id" });
    const booking = store.upsertBooking(b);
    broadcast();
    res.json({ ok: true, booking });
  });

  app.patch("/api/bookings/:id", (req, res) => {
    const updated = store.patchBooking(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ ok: false, error: "not found" });
    broadcast();
    res.json({ ok: true });
  });

  app.delete("/api/bookings/:id", (req, res) => {
    store.deleteBooking(req.params.id);
    broadcast();
    res.json({ ok: true });
  });

  app.post("/api/blocked", (req, res) => {
    const { date, reason } = req.body || {};
    if (!date) return res.status(400).json({ ok: false, error: "missing date" });
    store.addBlocked({ date, reason });
    broadcast();
    res.json({ ok: true });
  });

  app.delete("/api/blocked/:date", (req, res) => {
    store.removeBlocked(req.params.date);
    broadcast();
    res.json({ ok: true });
  });

  app.get("/api/qr.png", (req, res) => {
    QRCode.toBuffer(baseUrl, { type: "png", width: 240 }, (err, buf) => {
      if (err) return res.status(500).end();
      res.set("Content-Type", "image/png");
      res.send(buf);
    });
  });

  app.get("/api/events", (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    if (typeof res.flushHeaders === "function") res.flushHeaders();
    res.write(": connected\n\n");
    sseClients.add(res);

    // heartbeat comment keeps proxies/firewalls from dropping the connection
    const hb = setInterval(() => {
      try { res.write(": ping\n\n"); } catch (e) { /* ignore */ }
    }, 25000);

    req.on("close", () => {
      clearInterval(hb);
      sseClients.delete(res);
    });
  });

  const server = app.listen(port, "0.0.0.0");

  return {
    url: baseUrl,
    port,
    ip,
    close() {
      for (const res of sseClients) { try { res.end(); } catch (e) {} }
      sseClients.clear();
      try { server.close(); } catch (e) {}
    }
  };
}

module.exports = { startServer, getLanIp };

// Standalone mode: node server.js
if (require.main === module) {
  const info = startServer({
    dataDir: process.env.DATA_DIR,
    port: Number(process.env.PORT) || 4399
  });
  console.log("EBG Lake House server running.");
  console.log("  Booking page (phones): " + info.url);
  console.log("  Admin page:            " + info.url + "admin");
}
