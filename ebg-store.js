/**
 * ebg-store.js  v13
 * Shared data layer for EBG Lake House booking + admin pages.
 * Reads/writes to Google Sheets via the deployed Apps Script Web App.
 *
 * HOW TO USE:
 *   1. Deploy your Code.gs as a Web App (see instructions).
 *   2. Paste your Web App URL into SCRIPT_URL below.
 *   3. Upload this file alongside both HTML pages (or host anywhere both can reach it).
 *
 * Both index.html (booking) and admin.html load this file with:
 *   <script src="ebg-store.js?v=13"></script>
 *
 * Falls back to localStorage automatically if the script URL is not yet set.
 */

(function (global) {
  "use strict";

  // ── !! PASTE YOUR DEPLOYED WEB APP URL HERE !! ──────────────────────────────
  // After deploying Code.gs, copy the URL that ends in /exec and paste it below.
  // Example: "https://script.google.com/macros/s/AKfy.../exec"
  var SCRIPT_URL = "PASTE_YOUR_WEB_APP_URL_HERE";
  // ────────────────────────────────────────────────────────────────────────────

  var LS_BOOKINGS = "ebg_bookings";
  var LS_BLOCKED  = "ebg_blocked_dates";

  var _lastError  = null;

  /* ── helpers ── */
  function lsGet(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; } catch (e) { return []; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
  }

  function useSheets() {
    return SCRIPT_URL && SCRIPT_URL !== "https://script.google.com/macros/s/AKfycbwBSPya42-ABLrLG1gW-GMwj_20UdqMAT65EGUoAiojzKLdtpbCBebriIDQgD2Q2Xng0A/exec";
  }

  /* ── GET from Sheets ── */
  function sheetsGet(action) {
    return fetch(SCRIPT_URL + "?action=" + action)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) throw new Error(j.error || "Sheets read error");
        return j.data;
      });
  }

  /* ── POST to Sheets ── */
  function sheetsPost(action, payload) {
    return fetch(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: action, payload: payload })
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) throw new Error(j.error || "Sheets write error");
        return true;
      })
      .catch(function (err) {
        _lastError = err.message;
        return false;
      });
  }

  /* ══════════════════════════════════════════════════════════════════════
     PUBLIC API  (matches what the booking + admin HTML files expect)
     ══════════════════════════════════════════════════════════════════════ */

  var EBGStore = {

    /* init — call once on page load; resolves when data is ready */
    init: function () {
      if (!useSheets()) return Promise.resolve({ mode: "local" });
      // Warm the cache so the UI can paint quickly
      return Promise.all([
        sheetsGet("bookings").then(function (d) { lsSet(LS_BOOKINGS, d); }).catch(function(){}),
        sheetsGet("blocked").then(function (d)  { lsSet(LS_BLOCKED, d);  }).catch(function(){})
      ]).then(function () { return { mode: "sheets" }; });
    },

    /* ── bookings ── */
    getBookings: function () {
      return lsGet(LS_BOOKINGS);
    },

    /**
     * saveBookings(bookings)
     * Called by the admin page whenever the full list changes (approve/reject/delete/clear).
     * The booking page only ever *appends* one booking, so it calls saveBooking() instead.
     */
    saveBookings: function (bookings) {
      lsSet(LS_BOOKINGS, bookings);
      if (!useSheets()) return Promise.resolve(true);
      return sheetsPost("saveAllBookings", bookings);
    },

    /**
     * saveBooking(booking)          ← NEW: append a single booking (used by booking page)
     * Also updates localStorage so the admin page (same browser) sees it instantly.
     */
    saveBooking: function (booking) {
      var all = lsGet(LS_BOOKINGS);
      all.push(booking);
      lsSet(LS_BOOKINGS, all);
      if (!useSheets()) return Promise.resolve(true);
      return sheetsPost("saveBooking", booking);
    },

    /**
     * updateBooking(partialObj)     ← NEW: patch one booking's fields (approve/reject)
     * partialObj must include { id, ...fieldsToChange }
     */
    updateBooking: function (partial) {
      // update localStorage copy
      var all = lsGet(LS_BOOKINGS);
      for (var i = 0; i < all.length; i++) {
        if (all[i].id === partial.id) {
          Object.assign(all[i], partial);
          break;
        }
      }
      lsSet(LS_BOOKINGS, all);
      if (!useSheets()) return Promise.resolve(true);
      return sheetsPost("updateBooking", partial);
    },

    /* ── blocked dates ── */
    getBlocked: function () {
      return lsGet(LS_BLOCKED);
    },

    saveBlocked: function (blocked) {
      lsSet(LS_BLOCKED, blocked);
      if (!useSheets()) return Promise.resolve(true);
      return sheetsPost("saveBlocked", blocked);
    },

    /* ── error info (for the submit-error banner) ── */
    lastErrorText: function () { return _lastError; }
  };

  global.EBGStore = EBGStore;

})(window);
