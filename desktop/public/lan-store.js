/* ============================================================
   EBG Lake House — LAN storage adapter (desktop app)
   ------------------------------------------------------------
   Drop-in replacement for the Microsoft 365 / localStorage
   storage layer. Exposes the SAME window.EBGStore interface the
   booking + admin pages already use, but backed by the local
   HTTP API served by server.js on the office WiFi.

   - init()        : load state, open a live SSE stream, and (on
                     the admin page) show a "scan to book" QR card.
   - getBookings() : deep copy of the in-memory booking cache.
   - getBlocked()  : deep copy of the in-memory blocked cache.
   - saveBookings(): diffs vs cache and POST/PATCH/DELETEs.
   - saveBlocked() : diffs vs cache and POST/DELETEs.

   When the server tells us something changed, we re-fetch and
   fire synthetic `storage` events so the pages re-render exactly
   as they would on a real cross-tab localStorage change.
   ============================================================ */
(function () {
  "use strict";

  var bookings = [];   // in-memory cache of full booking objects
  var blocked = [];    // in-memory cache of {date, reason}
  var lastError = "";

  function deepCopy(x) {
    try { return JSON.parse(JSON.stringify(x)); } catch (e) { return x; }
  }

  function api(method, url, body) {
    var opts = { method: method, headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (res) {
      if (!res.ok) throw new Error(method + " " + url + " -> " + res.status);
      return res;
    });
  }

  function fetchState() {
    return fetch("/api/state").then(function (res) {
      if (!res.ok) throw new Error("/api/state -> " + res.status);
      return res.json();
    }).then(function (state) {
      bookings = Array.isArray(state.bookings) ? state.bookings : [];
      blocked = Array.isArray(state.blocked) ? state.blocked : [];
      return state;
    });
  }

  // Fire the same storage events the pages listen for, so they re-render.
  function notifyPages() {
    try { window.dispatchEvent(new StorageEvent("storage", { key: "ebg_bookings" })); } catch (e) {
      // Older engines: fall back to a generic Event with the key attached.
      try { var ev = new Event("storage"); ev.key = "ebg_bookings"; window.dispatchEvent(ev); } catch (e2) {}
    }
    try { window.dispatchEvent(new StorageEvent("storage", { key: "ebg_blocked_dates" })); } catch (e) {
      try { var ev2 = new Event("storage"); ev2.key = "ebg_blocked_dates"; window.dispatchEvent(ev2); } catch (e2) {}
    }
  }

  function isAdminPage() {
    return !!document.getElementById("dashboard");
  }

  // Small "scan to book on your phone" card for the admin window.
  function injectSharePanel() {
    if (document.getElementById("ebgSharePanel")) return;
    var card = document.createElement("div");
    card.id = "ebgSharePanel";
    card.style.cssText =
      "position:fixed;right:18px;bottom:18px;z-index:9998;width:230px;" +
      "background:#FDFAF5;border:1px solid #D4C9B5;border-radius:14px;" +
      "box-shadow:0 10px 30px rgba(44,44,44,.18);padding:16px 16px 14px;" +
      "font-family:'Jost','Helvetica Neue',sans-serif;color:#2C2C2C;text-align:center;";
    card.innerHTML =
      '<div style="font-family:\'Cormorant Garamond\',serif;font-size:1.05rem;color:#8B6E3A;font-weight:600;margin-bottom:10px;">' +
        '📱 Scan to book on your phone</div>' +
      '<img id="ebgShareQr" src="/api/qr.png" alt="QR code" ' +
        'style="width:180px;height:180px;border-radius:10px;background:#fff;border:1px solid #E8E3DA;padding:6px;">' +
      '<div id="ebgShareUrl" style="margin-top:10px;font-size:.78rem;color:#6B6B6B;word-break:break-all;">' +
        'Loading address…</div>' +
      '<div style="margin-top:6px;font-size:.7rem;color:#B8965A;letter-spacing:.5px;">SAME WI-FI ONLY</div>';
    document.body.appendChild(card);

    fetch("/api/info").then(function (r) { return r.json(); }).then(function (info) {
      var el = document.getElementById("ebgShareUrl");
      if (el && info && info.url) el.textContent = info.url;
    }).catch(function () {});
  }

  function openEventStream() {
    if (typeof EventSource === "undefined") return;
    var es = new EventSource("/api/events");
    es.onmessage = function () {
      // Any change on the server -> re-pull state and re-render the page.
      fetchState().then(notifyPages).catch(function () {});
    };
    es.onerror = function () {
      // EventSource auto-reconnects; nothing to do here.
    };
  }

  var EBGStore = {
    mode: "lan",
    ready: false,

    init: function () {
      var self = this;
      return fetchState().then(function () {
        openEventStream();
        if (isAdminPage()) injectSharePanel();
        self.ready = true;
        return { mode: "lan" };
      }).catch(function (e) {
        lastError = (e && e.message) || String(e);
        self.ready = true;
        return { mode: "lan", error: lastError };
      });
    },

    isCloud: function () { return false; },
    lastErrorText: function () { return lastError; },

    getBookings: function () { return deepCopy(bookings); },
    getBlocked: function () { return deepCopy(blocked); },

    // Diff `all` vs the booking cache by id and sync the differences.
    saveBookings: function (all) {
      all = Array.isArray(all) ? all : [];
      var byId = {};
      bookings.forEach(function (b) { byId[b.id] = b; });
      var seen = {};
      var ops = [];

      all.forEach(function (b) {
        if (!b || !b.id) return;
        seen[b.id] = true;
        var cur = byId[b.id];
        if (!cur) {
          // new booking -> create
          ops.push(api("POST", "/api/bookings", b));
        } else if (JSON.stringify(cur) !== JSON.stringify(b)) {
          // changed -> send the whole object as the patch (server merges fields)
          ops.push(api("PATCH", "/api/bookings/" + encodeURIComponent(b.id), b));
        }
      });

      // anything in the cache that's no longer present -> delete
      bookings.forEach(function (b) {
        if (b && b.id && !seen[b.id]) {
          ops.push(api("DELETE", "/api/bookings/" + encodeURIComponent(b.id)));
        }
      });

      bookings = deepCopy(all);
      return Promise.all(ops).then(function () {
        return true;
      }).catch(function (e) {
        lastError = (e && e.message) || String(e);
        return false;
      });
    },

    // Diff `all` vs the blocked cache by date and sync the differences.
    saveBlocked: function (all) {
      all = Array.isArray(all) ? all : [];
      var have = {};
      blocked.forEach(function (x) { have[x.date] = x; });
      var want = {};
      all.forEach(function (x) { if (x && x.date) want[x.date] = x; });
      var ops = [];

      Object.keys(want).forEach(function (date) {
        if (!have[date]) {
          ops.push(api("POST", "/api/blocked", { date: date, reason: want[date].reason || "" }));
        }
      });
      Object.keys(have).forEach(function (date) {
        if (!want[date]) {
          ops.push(api("DELETE", "/api/blocked/" + encodeURIComponent(date)));
        }
      });

      blocked = deepCopy(all);
      return Promise.all(ops).then(function () {
        return true;
      }).catch(function (e) {
        lastError = (e && e.message) || String(e);
        return false;
      });
    },

    refresh: function () { return fetchState(); }
  };

  window.EBGStore = EBGStore;
})();
