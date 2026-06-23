/* ============================================================
   EBG Lake House — Cloudflare cloud storage adapter
   ------------------------------------------------------------
   Drop-in replacement for the desktop/LAN storage layer. Exposes
   the SAME window.EBGStore interface the booking + admin pages
   already use, but backed by the Cloudflare Pages Functions API
   (D1 for records, R2 for uploaded files).

   - init()        : load state, start polling, and (on the admin
                     page) show a "scan to book on your phone" QR.
   - getBookings() : deep copy of the in-memory booking cache.
   - getBlocked()  : deep copy of the in-memory blocked cache.
   - saveBookings(): diffs vs cache and POST/PATCH/DELETEs.
   - saveBlocked() : diffs vs cache and POST/DELETEs.

   Polling re-fetches /api/state every 12s; when the payload
   changes we update the caches and fire synthetic `storage`
   events so the pages re-render exactly as they would on a real
   cross-tab localStorage change.
   ============================================================ */
(function () {
  "use strict";

  var bookings = [];          // in-memory cache of full booking objects
  var blocked = [];           // in-memory cache of {date, reason}
  var lastError = "";
  var lastStateJson = "";     // last raw /api/state payload (for change detection)
  var pollTimer = null;

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

  // Fire the same storage events the pages listen for, so they re-render.
  function notifyPages() {
    try { window.dispatchEvent(new StorageEvent("storage", { key: "ebg_bookings" })); } catch (e) {
      try { var ev = new Event("storage"); ev.key = "ebg_bookings"; window.dispatchEvent(ev); } catch (e2) {}
    }
    try { window.dispatchEvent(new StorageEvent("storage", { key: "ebg_blocked_dates" })); } catch (e) {
      try { var ev2 = new Event("storage"); ev2.key = "ebg_blocked_dates"; window.dispatchEvent(ev2); } catch (e2) {}
    }
  }

  // Pull /api/state and, if it changed since last time, update caches
  // and notify the page. `firstLoad` skips the notify (boot renders itself).
  function fetchState(firstLoad) {
    return fetch("/api/state").then(function (res) {
      if (!res.ok) throw new Error("/api/state -> " + res.status);
      return res.text();
    }).then(function (txt) {
      var changed = txt !== lastStateJson;
      lastStateJson = txt;
      var state;
      try { state = JSON.parse(txt); } catch (e) { state = {}; }
      bookings = Array.isArray(state.bookings) ? state.bookings : [];
      blocked = Array.isArray(state.blocked) ? state.blocked : [];
      if (changed && !firstLoad) notifyPages();
      return state;
    });
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      fetchState(false).catch(function (e) {
        lastError = (e && e.message) || String(e);
      });
    }, 12000);
  }

  function isAdminPage() {
    return !!document.getElementById("dashboard");
  }

  // Compare two bookings while ignoring the hydrated/transient file fields.
  // After a poll, cached bookings carry documents[slot].data = "/api/file/..."
  // URLs and signature = "/api/file/..."; comparing those against a freshly
  // built booking (which has base64 / a real PNG) would PATCH on every save.
  // We strip those fields so only meaningful changes (status, adminNotes,
  // rejectionReason, dates, etc.) trigger a PATCH.
  function stripVolatile(b) {
    var c = deepCopy(b) || {};
    if (c.documents) {
      ["driversLicense", "boatingLicense"].forEach(function (slot) {
        if (c.documents[slot]) {
          delete c.documents[slot].data;
          delete c.documents[slot].stored;
        }
      });
    }
    delete c.signature;
    delete c.signatureStored;
    return c;
  }

  function sameIgnoringFiles(a, b) {
    return JSON.stringify(stripVolatile(a)) === JSON.stringify(stripVolatile(b));
  }

  // Small "scan to book on your phone" card for the admin window.
  function injectSharePanel() {
    if (document.getElementById("ebgSharePanel")) return;
    var bookingUrl = location.origin + "/booking.html";
    var qrSrc = "https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=" +
      encodeURIComponent(bookingUrl);
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
      '<img id="ebgShareQr" src="' + qrSrc + '" alt="QR code to booking page" ' +
        'style="width:180px;height:180px;border-radius:10px;background:#fff;border:1px solid #E8E3DA;padding:6px;">' +
      '<div id="ebgShareUrl" style="margin-top:10px;font-size:.78rem;color:#6B6B6B;word-break:break-all;">' +
        bookingUrl + '</div>';
    document.body.appendChild(card);
  }

  var EBGStore = {
    mode: "cloud",
    ready: false,

    init: function () {
      var self = this;
      return fetchState(true).then(function () {
        startPolling();
        if (isAdminPage()) {
          try { injectSharePanel(); } catch (e) {}
        }
        self.ready = true;
        return { mode: "cloud" };
      }).catch(function (e) {
        lastError = (e && e.message) || String(e);
        // Still start polling so a transient boot failure can recover.
        try { startPolling(); } catch (e2) {}
        self.ready = true;
        return { mode: "cloud", error: lastError };
      });
    },

    isCloud: function () { return true; },
    lastErrorText: function () { return lastError; },

    getBookings: function () { return deepCopy(bookings); },
    getBlocked: function () { return deepCopy(blocked); },

    // Diff `all` vs the booking cache by id and sync the differences.
    saveBookings: function (all) {
      all = Array.isArray(all) ? all : [];
      var byId = {};
      bookings.forEach(function (b) { if (b && b.id) byId[b.id] = b; });
      var seen = {};
      var ops = [];

      all.forEach(function (b) {
        if (!b || !b.id) return;
        seen[b.id] = true;
        var cur = byId[b.id];
        if (!cur) {
          // new booking -> create (carries base64 data: + signature to upload)
          ops.push(api("POST", "/api/bookings", b));
        } else if (!sameIgnoringFiles(cur, b)) {
          // meaningful change -> send the whole object; the server merges fields
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
      blocked.forEach(function (x) { if (x && x.date) have[x.date] = x; });
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

    refresh: function () { return fetchState(false); },

    // App version + update capability for the admin Settings page. The cloud
    // build is always served at its latest version and never self-updates.
    getAppInfo: function () {
      return Promise.resolve({ version: "Web (always latest)", canUpdate: false, mode: "cloud" });
    },

    // No-op in the cloud build; there is nothing to update client-side.
    checkForUpdates: function () {
      return Promise.resolve(false);
    }
  };

  window.EBGStore = EBGStore;
})();
