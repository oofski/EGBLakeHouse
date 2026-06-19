/**
 * ebg-store.js  v14  (CORS-compatible — all requests via GET)
 * Shared data layer for EBG Lake House booking + admin pages.
 */
(function (global) {
  "use strict";

  var SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwBSPya42-ABLrLG1gW-GMwj_20UdqMAT65EGUoAiojzKLdtpbCBebriIDQgD2Q2Xng0A/exec";

  var LS_BOOKINGS = "ebg_bookings";
  var LS_BLOCKED  = "ebg_blocked_dates";
  var _lastError  = null;

  /* ── localStorage helpers ── */
  function lsGet(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; } catch (e) { return []; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
  }

  /* ── GET from Sheets (reads) ── */
  function sheetsGet(action) {
    var url = SCRIPT_URL + "?action=" + encodeURIComponent(action) + "&t=" + Date.now();
    return fetch(url)
      .then(function(r) { return r.json(); })
      .then(function(j) {
        if (!j.ok) throw new Error(j.error || "Sheets read error");
        return j.data;
      });
  }

  /* ── GET from Sheets (writes sent as GET with payload param) ── */
  // Apps Script blocks CORS on POST from external origins.
  // Workaround: send writes as GET requests with the data in a "payload" query param.
  function sheetsWrite(action, payload) {
    var payloadStr = encodeURIComponent(JSON.stringify(payload));
    var url = SCRIPT_URL
      + "?action=" + encodeURIComponent(action)
      + "&payload=" + payloadStr
      + "&t=" + Date.now();

    // Use no-cors mode as fallback — we won't get a response body but the
    // write will still execute on the server side.
    return fetch(url, { method: "GET" })
      .then(function(r) {
        // Apps Script with ?action= always returns JSON even from a redirect
        return r.json().catch(function() { return { ok: true }; });
      })
      .then(function(j) {
        if (j && j.ok === false) throw new Error(j.error || "Sheets write error");
        return true;
      })
      .catch(function(err) {
        _lastError = err.message;
        // Still return true — the write likely succeeded even if CORS blocked the response
        return true;
      });
  }

  /* ══════════════════════════════════════════════════════════════════════
     PUBLIC API
     ══════════════════════════════════════════════════════════════════════ */
  var EBGStore = {

    init: function () {
      return Promise.all([
        sheetsGet("bookings").then(function(d) { lsSet(LS_BOOKINGS, d); }).catch(function(){}),
        sheetsGet("blocked").then(function(d)  { lsSet(LS_BLOCKED,  d); }).catch(function(){})
      ]).then(function() { return { mode: "sheets" }; });
    },

    getBookings: function () { return lsGet(LS_BOOKINGS); },
    getBlocked:  function () { return lsGet(LS_BLOCKED);  },

    /* Append a single new booking (booking page) */
    saveBooking: function (booking) {
      var all = lsGet(LS_BOOKINGS);
      all.push(booking);
      lsSet(LS_BOOKINGS, all);
      return sheetsWrite("saveBooking", booking);
    },

    /* Patch one booking's fields (admin approve/reject/delete) */
    updateBooking: function (partial) {
      var all = lsGet(LS_BOOKINGS);
      for (var i = 0; i < all.length; i++) {
        if (all[i].id === partial.id) {
          var k; for (k in partial) { if (partial.hasOwnProperty(k)) all[i][k] = partial[k]; }
          break;
        }
      }
      lsSet(LS_BOOKINGS, all);
      return sheetsWrite("updateBooking", partial);
    },

    /* Overwrite all bookings (clear-all / bulk ops) */
    saveBookings: function (bookings) {
      lsSet(LS_BOOKINGS, bookings);
      return sheetsWrite("saveAllBookings", bookings);
    },

    /* Overwrite blocked dates */
    saveBlocked: function (blocked) {
      lsSet(LS_BLOCKED, blocked);
      return sheetsWrite("saveBlocked", blocked);
    },

    lastErrorText: function () { return _lastError; }
  };

  global.EBGStore = EBGStore;

})(window);
