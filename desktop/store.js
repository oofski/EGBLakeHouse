/* ============================================================
   EBG Lake House — local JSON persistence
   ------------------------------------------------------------
   A single file `bookings.json` in the chosen data directory
   holds { bookings: [...], blocked: [...] }. Every mutation is
   written to disk synchronously and crash-safely (temp file +
   rename) so a crash can never leave a half-written file.
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");

function initStore(dataDir) {
  // Resolve the data directory: explicit arg wins, else DATA_DIR env, else ./data
  const dir = dataDir || process.env.DATA_DIR || path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "bookings.json");
  const tmp = file + ".tmp";

  let data = { bookings: [], blocked: [] };

  function load() {
    try {
      const raw = fs.readFileSync(file, "utf8");
      const parsed = JSON.parse(raw);
      data = {
        bookings: Array.isArray(parsed.bookings) ? parsed.bookings : [],
        blocked: Array.isArray(parsed.blocked) ? parsed.blocked : []
      };
    } catch (e) {
      // Missing or corrupt file -> start empty (and create it on first save).
      data = { bookings: [], blocked: [] };
    }
  }

  function persist() {
    // crash-safe: write to a temp file, then atomically rename over the target.
    const json = JSON.stringify(data, null, 2);
    fs.writeFileSync(tmp, json, "utf8");
    fs.renameSync(tmp, file);
  }

  load();
  // Make sure a file exists from the start so backups/exports always have something.
  try { if (!fs.existsSync(file)) persist(); } catch (e) {}

  return {
    dir,
    file,

    getState() {
      // return copies so callers can't mutate our cache directly
      return {
        bookings: JSON.parse(JSON.stringify(data.bookings)),
        blocked: JSON.parse(JSON.stringify(data.blocked))
      };
    },

    // Insert a new booking or replace an existing one with the same id.
    upsertBooking(b) {
      if (!b || !b.id) return null;
      const i = data.bookings.findIndex((x) => x.id === b.id);
      if (i >= 0) data.bookings[i] = b;
      else data.bookings.push(b);
      persist();
      return b;
    },

    // Merge `fields` into the stored record. Sending the whole booking works
    // (full replace of those keys); sending just {status} works too.
    patchBooking(id, fields) {
      const i = data.bookings.findIndex((x) => x.id === id);
      if (i < 0) return null;
      data.bookings[i] = Object.assign({}, data.bookings[i], fields || {});
      // never let a patch change the id away from the path id
      data.bookings[i].id = id;
      persist();
      return data.bookings[i];
    },

    deleteBooking(id) {
      const before = data.bookings.length;
      data.bookings = data.bookings.filter((x) => x.id !== id);
      if (data.bookings.length !== before) persist();
      return before !== data.bookings.length;
    },

    addBlocked(entry) {
      if (!entry || !entry.date) return null;
      const date = String(entry.date).slice(0, 10);
      const reason = entry.reason || "";
      const i = data.blocked.findIndex((x) => x.date === date);
      if (i >= 0) data.blocked[i] = { date, reason };
      else data.blocked.push({ date, reason });
      persist();
      return { date, reason };
    },

    removeBlocked(date) {
      const d = String(date).slice(0, 10);
      const before = data.blocked.length;
      data.blocked = data.blocked.filter((x) => x.date !== d);
      if (data.blocked.length !== before) persist();
      return before !== data.blocked.length;
    },

    setBlocked(arr) {
      data.blocked = (Array.isArray(arr) ? arr : []).map((x) => ({
        date: String(x.date).slice(0, 10),
        reason: x.reason || ""
      }));
      persist();
      return data.blocked.slice();
    }
  };
}

module.exports = { initStore };
