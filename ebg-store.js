/* ============================================================
   EBG Lake House — Microsoft 365 storage layer (shared)
   ------------------------------------------------------------
   Used by booking.html and admin.html. When configured and the
   user can sign in, bookings + blocked dates live in SharePoint
   (shared across everyone). If Microsoft 365 is unavailable for
   any reason, it transparently falls back to this browser's
   localStorage so the app keeps working.

   No build step. Loaded as a plain <script> alongside MSAL.
   ============================================================ */
(function () {
  "use strict";

  var CONFIG = {
    enabled: true,
    tenantId: "3c96cae6-ac92-4495-b92c-52b97d5a0b5e",
    clientId: "3835e7f3-703d-46e1-986d-d337167b16a0",
    siteHost: "ibw0.sharepoint.com",
    sitePath: "/sites/EBGLakeHouse",
    bookingsList: "EBG Bookings",
    blockedList: "EBG Blocked Dates",
    docLibrary: "EBG Documents",
    scopes: ["User.Read", "Sites.ReadWrite.All"]
  };

  var LS_BOOKINGS = "ebg_bookings", LS_BLOCKED = "ebg_blocked_dates";
  var GRAPH = "https://graph.microsoft.com/v1.0";

  // Safe rollout: M365 is only attempted when explicitly requested, so the public
  // links keep working in local mode until sign-in is confirmed. Open any page with
  //   ?m365=1  → turn sync ON for this browser (sticky)
  //   ?m365=0  → turn it back OFF (escape hatch if anything misbehaves)
  function m365Requested() {
    try {
      if (/[?&#]m365=1/.test(location.href)) { localStorage.setItem("ebg_use_m365", "1"); return true; }
      if (/[?&#]m365=0/.test(location.href)) { localStorage.removeItem("ebg_use_m365"); return false; }
      return localStorage.getItem("ebg_use_m365") === "1";
    } catch (e) { return false; }
  }

  // Wait for the MSAL library to be present (handles slow CDN / onerror fallback).
  function waitForMsal(timeout) {
    return new Promise(function (resolve) {
      if (typeof msal !== "undefined") return resolve(true);
      var start = Date.now();
      var iv = setInterval(function () {
        if (typeof msal !== "undefined") { clearInterval(iv); resolve(true); }
        else if (Date.now() - start > timeout) { clearInterval(iv); resolve(false); }
      }, 100);
    });
  }

  // ---- runtime state ----
  var state = {
    mode: "local",            // "local" | "m365"
    ready: false,
    account: null,
    siteId: null,
    driveId: null,
    listIds: {},              // displayName -> id
    cols: {},                 // listName -> {displayName:internalName}
    bookings: [],             // cache of booking objects
    blocked: [],              // cache of {date, reason}
    itemIds: { bookings: {}, blocked: {} }, // businessId -> sharepoint item id
    lastJson: {},             // booking id -> last-committed canonical JSON (to skip no-op writes)
    pca: null,
    lastError: null
  };

  /* ---------- tiny status chip (diagnostics) ---------- */
  var chip;
  function statusChip(text, kind) {
    if (!chip) {
      chip = document.createElement("div");
      chip.id = "ebgM365Status";
      chip.style.cssText =
        "position:fixed;left:12px;bottom:12px;z-index:9999;font:500 12px/1.4 'Jost',sans-serif;" +
        "padding:8px 14px;border-radius:50px;box-shadow:0 4px 16px rgba(44,44,44,.18);max-width:340px;cursor:pointer;";
      chip.title = "Click to copy diagnostic details";
      chip.addEventListener("click", function () {
        var t = (state.lastError ? ("ERROR: " + state.lastError + "\n\n") : "") +
          "mode=" + state.mode + " | site=" + (state.siteId ? "ok" : "not resolved") +
          " | user=" + (state.account ? state.account.username : "(not signed in)");
        try { navigator.clipboard.writeText(t); } catch (e) {}
        try { alert(t); } catch (e) {}   // show on screen so it can be screenshotted
      });
      document.body.appendChild(chip);
    }
    var colors = {
      ok:   "background:#4A7C59;color:#fff;",
      work: "background:#B8965A;color:#fff;",
      err:  "background:#A0442A;color:#fff;",
      local:"background:#E8E3DA;color:#2C2C2C;"
    };
    chip.style.cssText = chip.style.cssText.replace(/background:[^;]*;color:[^;]*;/, "");
    chip.setAttribute("style", chip.getAttribute("style") + (colors[kind] || colors.work));
    chip.textContent = text;
  }

  /* ---------- MSAL auth ---------- */
  function buildPca() {
    return new msal.PublicClientApplication({
      auth: {
        clientId: CONFIG.clientId,
        authority: "https://login.microsoftonline.com/" + CONFIG.tenantId,
        redirectUri: location.origin + location.pathname
      },
      cache: { cacheLocation: "localStorage", storeAuthStateInCookie: false }
    });
  }

  function signIn() {
    // returns account or triggers a redirect (and resolves null)
    return state.pca.handleRedirectPromise().then(function (resp) {
      if (resp && resp.account) return resp.account;
      var accts = state.pca.getAllAccounts();
      if (accts.length) return accts[0];
      // no session yet -> redirect to Microsoft sign-in (page will reload)
      statusChip("Signing in to Microsoft 365…", "work");
      state.pca.loginRedirect({ scopes: CONFIG.scopes });
      return null;
    });
  }

  function getToken() {
    var req = { scopes: CONFIG.scopes, account: state.account };
    return state.pca.acquireTokenSilent(req).then(function (r) { return r.accessToken; })
      .catch(function (e) {
        // interaction required -> popup keeps any in-progress form intact
        return state.pca.acquireTokenPopup({ scopes: CONFIG.scopes }).then(function (r) { return r.accessToken; });
      });
  }

  /* ---------- Graph helper ---------- */
  function graph(method, path, body, opts) {
    opts = opts || {};
    return getToken().then(function (token) {
      var headers = { Authorization: "Bearer " + token };
      var fetchOpts = { method: method, headers: headers };
      if (opts.binary) {
        headers["Content-Type"] = opts.contentType || "application/octet-stream";
        fetchOpts.body = body;
      } else if (body !== undefined && body !== null) {
        headers["Content-Type"] = "application/json";
        fetchOpts.body = JSON.stringify(body);
      }
      var url = path.indexOf("http") === 0 ? path : (GRAPH + path);
      return fetch(url, fetchOpts).then(function (res) {
        if (!res.ok) {
          return res.text().then(function (t) {
            throw new Error(method + " " + path + " → " + res.status + " " + t.slice(0, 300));
          });
        }
        if (res.status === 204) return null;
        var ct = res.headers.get("content-type") || "";
        return ct.indexOf("json") >= 0 ? res.json() : res;
      });
    });
  }

  /* ---------- site / list / drive resolution ---------- */
  function resolveSite() {
    return graph("GET", "/sites/" + CONFIG.siteHost + ":" + CONFIG.sitePath).then(function (s) {
      state.siteId = s.id;
    });
  }
  function resolveLists() {
    return graph("GET", "/sites/" + state.siteId + "/lists?$select=id,displayName&$top=100").then(function (r) {
      (r.value || []).forEach(function (l) { state.listIds[l.displayName] = l.id; });
    });
  }
  function ensureList(name, columns) {
    if (state.listIds[name]) return Promise.resolve();
    var body = { displayName: name, list: { template: "genericList" }, columns: columns };
    return graph("POST", "/sites/" + state.siteId + "/lists", body).then(function (l) {
      state.listIds[name] = l.id;
    });
  }
  function resolveDrive() {
    return graph("GET", "/sites/" + state.siteId + "/drives?$select=id,name&$top=100").then(function (r) {
      var lib = (r.value || []).filter(function (d) { return d.name === CONFIG.docLibrary; })[0]
             || (r.value || [])[0]; // fall back to default library
      if (lib) state.driveId = lib.id;
    });
  }

  // Add any missing columns to a list (works whether the list was pre-created by an
  // admin or auto-created here). Needs site write access; per-column failures are
  // swallowed so a non-owner visitor isn't blocked (the site owner adds them first).
  function ensureColumns(listName, defs) {
    var listId = state.listIds[listName];
    if (!listId) return Promise.resolve();
    return graph("GET", "/sites/" + state.siteId + "/lists/" + listId + "/columns?$select=name&$top=200").then(function (r) {
      var have = {};
      (r.value || []).forEach(function (c) { have[(c.name || "").toLowerCase()] = true; });
      var toAdd = defs.filter(function (d) { return !have[d.name.toLowerCase()]; });
      return toAdd.reduce(function (p, d) {
        return p.then(function () {
          return graph("POST", "/sites/" + state.siteId + "/lists/" + listId + "/columns", d)
            .catch(function (e) { console.warn("[EBGStore] could not add column '" + d.name + "':", e && e.message); });
        });
      }, Promise.resolve());
    }).catch(function (e) { console.warn("[EBGStore] ensureColumns(" + listName + "):", e && e.message); });
  }

  function ensureSchema() {
    var bookingCols = [
      { name: "Status", text: {} },
      { name: "RenterName", text: {} },
      { name: "Email", text: {} },
      { name: "CheckIn", text: {} },
      { name: "CheckOut", text: {} },
      { name: "SubmittedAt", text: {} },
      { name: "DataJson", text: { allowMultipleLines: true, textType: "plain" } }
    ];
    var blockedCols = [
      { name: "BlockDate", text: {} },
      { name: "Reason", text: {} }
    ];
    return ensureList(CONFIG.bookingsList, bookingCols)
      .then(function () { return ensureColumns(CONFIG.bookingsList, bookingCols); })
      .then(function () { return ensureList(CONFIG.blockedList, blockedCols); })
      .then(function () { return ensureColumns(CONFIG.blockedList, blockedCols); });
  }

  /* ---------- files (license images + signature) ---------- */
  function dataUrlToBlob(dataUrl) {
    var parts = dataUrl.split(",");
    var mime = (parts[0].match(/:(.*?);/) || [])[1] || "application/octet-stream";
    var bin = atob(parts[1]); var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return { blob: new Blob([arr], { type: mime }), mime: mime };
  }
  function uploadFile(bookingId, filename, dataUrl) {
    if (!state.driveId || !dataUrl || dataUrl.indexOf("data:") !== 0) return Promise.resolve(null);
    var b = dataUrlToBlob(dataUrl);
    var path = "/drives/" + state.driveId + "/root:/" + encodeURIComponent(bookingId) + "/" + encodeURIComponent(filename) + ":/content";
    return graph("PUT", path, b.blob, { binary: true, contentType: b.mime })
      .then(function (item) { return { id: item.id, name: filename, type: b.mime }; });
  }
  function fileDownloadUrl(itemId) {
    return graph("GET", "/drives/" + state.driveId + "/items/" + itemId + "?$select=@microsoft.graph.downloadUrl")
      .then(function (r) { return r["@microsoft.graph.downloadUrl"]; });
  }

  /* ---------- map booking <-> list item ---------- */
  function bookingToFields(b) {
    return {
      Title: b.id, Status: b.status || "pending",
      RenterName: ((b.renter && b.renter.firstName) || "") + " " + ((b.renter && b.renter.lastName) || ""),
      Email: (b.renter && b.renter.email) || "",
      CheckIn: b.checkIn || "", CheckOut: b.checkOut || "",
      SubmittedAt: b.submittedAt || "",
      DataJson: JSON.stringify(stripFiles(b))
    };
  }
  // store file references (not base64) inside DataJson to stay small
  function stripFiles(b) {
    var copy = JSON.parse(JSON.stringify(b));
    if (copy.documents) {
      ["driversLicense", "boatingLicense"].forEach(function (k) {
        if (copy.documents[k] && copy.documents[k]._ref) { delete copy.documents[k].data; }
      });
    }
    if (copy._sigRef) { delete copy.signature; }   // signature lives in the drive, not the JSON
    return copy;
  }

  /* ---------- load all from SharePoint ---------- */
  function loadAll() {
    return graph("GET", "/sites/" + state.siteId + "/lists/" + state.listIds[CONFIG.bookingsList] + "/items?expand=fields&$top=500")
      .then(function (r) {
        state.bookings = []; state.itemIds.bookings = {}; state.lastJson = {};
        var hydrations = [];
        (r.value || []).forEach(function (it) {
          var f = it.fields || {};
          if (!f.DataJson) return;
          var b;
          try { b = JSON.parse(f.DataJson); } catch (e) { return; }
          b.status = f.Status || b.status;
          state.itemIds.bookings[b.id] = it.id;
          state.lastJson[b.id] = JSON.stringify(stripFiles(b)); // canonical snapshot to detect real changes
          state.bookings.push(b);
          // hydrate file refs -> usable download URLs for display
          hydrations.push(hydrateFiles(b));
        });
        return Promise.all(hydrations);
      })
      .then(function () {
        return graph("GET", "/sites/" + state.siteId + "/lists/" + state.listIds[CONFIG.blockedList] + "/items?expand=fields&$top=500");
      })
      .then(function (r) {
        state.blocked = []; state.itemIds.blocked = {};
        (r.value || []).forEach(function (it) {
          var f = it.fields || {};
          var date = (f.BlockDate || f.Title || "").slice(0, 10);
          if (!date) return;
          state.blocked.push({ date: date, reason: f.Reason || "" });
          state.itemIds.blocked[date] = it.id;
        });
      });
  }
  function hydrateFiles(b) {
    var jobs = [];
    if (b.documents) {
      ["driversLicense", "boatingLicense"].forEach(function (k) {
        var d = b.documents[k];
        if (d && d._ref) {
          jobs.push(fileDownloadUrl(d._ref).then(function (u) { d.data = u; }).catch(function () {}));
        }
      });
    }
    if (b._sigRef) {
      jobs.push(fileDownloadUrl(b._sigRef).then(function (u) { b.signature = u; }).catch(function () {}));
    }
    return Promise.all(jobs);
  }

  /* ---------- write reconciliation ---------- */
  function createBookingRemote(b) {
    // upload files first, replace with refs, then create the item
    var uploads = [];
    var dl = b.documents && b.documents.driversLicense;
    var bl = b.documents && b.documents.boatingLicense;
    if (dl && dl.data && dl.data.indexOf("data:") === 0)
      uploads.push(uploadFile(b.id, "drivers-license-" + safeExt(dl), dl.data).then(function (ref) { if (ref) { dl._ref = ref.id; delete dl.data; } }));
    if (bl && bl.data && bl.data.indexOf("data:") === 0)
      uploads.push(uploadFile(b.id, "boating-license-" + safeExt(bl), bl.data).then(function (ref) { if (ref) { bl._ref = ref.id; delete bl.data; } }));
    if (b.signature && b.signature.indexOf("data:") === 0)
      uploads.push(uploadFile(b.id, "signature.png", b.signature).then(function (ref) { if (ref) { b._sigRef = ref.id; delete b.signature; } }));
    return Promise.all(uploads).then(function () {
      return postItem(CONFIG.bookingsList, bookingToFields(b));
    }).then(function (item) {
      state.itemIds.bookings[b.id] = item.id;
    });
  }
  function safeExt(d) { return (d.type && d.type.indexOf("pdf") >= 0) ? "file.pdf" : "photo.jpg"; }

  function postItem(listName, fields) {
    return retryFields("/sites/" + state.siteId + "/lists/" + state.listIds[listName] + "/items", fields);
  }
  function patchItem(listName, itemId, fields) {
    var base = "/sites/" + state.siteId + "/lists/" + state.listIds[listName] + "/items/" + itemId + "/fields";
    return graph("PATCH", base, fields).catch(function () {
      // retry with only Title + DataJson if an auxiliary column is unexpected/typed
      var minimal = {}; if (fields.Title) minimal.Title = fields.Title; if (fields.DataJson) minimal.DataJson = fields.DataJson;
      return graph("PATCH", base, minimal);
    });
  }
  function retryFields(itemsPath, fields) {
    return graph("POST", itemsPath, { fields: fields }).catch(function (e) {
      // last resort: the full record is preserved in DataJson; Title is always present.
      var minimal = { Title: fields.Title };
      if (fields.DataJson !== undefined) minimal.DataJson = fields.DataJson;
      return graph("POST", itemsPath, { fields: minimal });
    });
  }

  function commitBookings(all) {
    var ops = [];
    var seen = {};
    all.forEach(function (b) {
      seen[b.id] = true;
      var itemId = state.itemIds.bookings[b.id];
      if (!itemId) {
        // brand new booking -> upload files + create the item
        ops.push(createBookingRemote(b).then(function () { state.lastJson[b.id] = JSON.stringify(stripFiles(b)); }));
      } else {
        // existing booking -> only write if it actually changed (skip no-ops)
        var cur = JSON.stringify(stripFiles(b));
        if (cur !== state.lastJson[b.id]) {
          ops.push(patchItem(CONFIG.bookingsList, itemId, bookingToFields(b)).then(function () { state.lastJson[b.id] = cur; }));
        }
      }
    });
    // deletions (e.g. "clear all bookings")
    Object.keys(state.itemIds.bookings).forEach(function (id) {
      if (!seen[id]) {
        var itemId = state.itemIds.bookings[id];
        ops.push(graph("DELETE", "/sites/" + state.siteId + "/lists/" + state.listIds[CONFIG.bookingsList] + "/items/" + itemId).then(function () {
          delete state.itemIds.bookings[id]; delete state.lastJson[id];
        }));
      }
    });
    return Promise.all(ops).then(function () { state.bookings = all.slice(); return true; });
  }

  function commitBlocked(all) {
    var ops = [];
    var want = {}; all.forEach(function (x) { want[x.date] = x.reason; });
    // add new
    Object.keys(want).forEach(function (date) {
      if (!state.itemIds.blocked[date]) {
        ops.push(postItem(CONFIG.blockedList, { Title: date, BlockDate: date + "T00:00:00Z", Reason: want[date] }).then(function (item) {
          state.itemIds.blocked[date] = item.id;
        }));
      }
    });
    // remove gone
    Object.keys(state.itemIds.blocked).forEach(function (date) {
      if (!(date in want)) {
        var itemId = state.itemIds.blocked[date];
        ops.push(graph("DELETE", "/sites/" + state.siteId + "/lists/" + state.listIds[CONFIG.blockedList] + "/items/" + itemId).then(function () {
          delete state.itemIds.blocked[date];
        }));
      }
    });
    return Promise.all(ops).then(function () { state.blocked = all.slice(); return true; });
  }

  /* ---------- localStorage fallback ---------- */
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)) || []; } catch (e) { return []; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }

  /* ---------- public API ---------- */
  var EBGStore = {
    mode: "local",
    ready: false,
    init: function () {
      var self = this;
      function goLocal(extra) {
        state.mode = "local"; self.mode = "local"; self.ready = true; state.ready = true;
        return Promise.resolve(Object.assign({ mode: "local" }, extra || {}));
      }
      function fail(e) {
        state.lastError = (e && e.message) || String(e);
        statusChip("⚠ Microsoft 365 error (tap to copy details). Add ?m365=0 to use this device only.", "err");
        console.error("[EBGStore] falling back to local:", e);
        return goLocal({ error: state.lastError });
      }
      // Not switched on (or disabled) -> stay local silently; the public links keep working.
      if (!CONFIG.enabled || !m365Requested()) return goLocal();
      statusChip("Connecting to Microsoft 365…", "work");
      return waitForMsal(6000).then(function (loaded) {
        if (!loaded) {
          state.lastError = "Microsoft sign-in library (msal-browser) failed to load — blocked by the network or a wrong CDN URL.";
          statusChip("⚠ Microsoft sign-in didn't load (tap to copy). Add ?m365=0 to use this device only.", "err");
          return goLocal({ error: state.lastError });
        }
        try { state.pca = buildPca(); } catch (e) { return fail(e); }
        return signIn().then(function (account) {
          if (!account) return { mode: "redirecting" }; // page is navigating to sign-in
          state.account = account; state.pca.setActiveAccount(account);
          return resolveSite()
            .then(resolveLists)
            .then(ensureSchema)
            .then(resolveDrive)
            .then(loadAll)
            .then(function () {
              state.mode = "m365"; self.mode = "m365"; self.ready = true; state.ready = true;
              statusChip("✓ Microsoft 365 — " + account.username, "ok");
              return { mode: "m365" };
            });
        });
      }).catch(fail);
    },
    isCloud: function () { return state.mode === "m365"; },
    lastErrorText: function () { return state.lastError || ""; },
    getBookings: function () {
      return state.mode === "m365" ? state.bookings.slice() : lsGet(LS_BOOKINGS);
    },
    getBlocked: function () {
      return state.mode === "m365" ? state.blocked.slice() : lsGet(LS_BLOCKED);
    },
    // returns a Promise<boolean>; updates cache synchronously for snappy UI
    saveBookings: function (all) {
      if (state.mode !== "m365") return Promise.resolve(lsSet(LS_BOOKINGS, all));
      state.bookings = all.slice();
      return commitBookings(all).catch(function (e) {
        state.lastError = (e && e.message) || String(e);
        statusChip("⚠ Couldn't save to Microsoft 365 (click for details)", "err");
        console.error("[EBGStore] saveBookings:", e);
        return false;
      });
    },
    saveBlocked: function (all) {
      if (state.mode !== "m365") return Promise.resolve(lsSet(LS_BLOCKED, all));
      state.blocked = all.slice();
      return commitBlocked(all).catch(function (e) {
        state.lastError = (e && e.message) || String(e);
        statusChip("⚠ Couldn't save blocked dates to Microsoft 365 (click for details)", "err");
        console.error("[EBGStore] saveBlocked:", e);
        return false;
      });
    },
    refresh: function () { return state.mode === "m365" ? loadAll() : Promise.resolve(); },
    signOut: function () { if (state.pca && state.account) state.pca.logoutRedirect({ account: state.account }); }
  };

  window.EBGStore = EBGStore;
})();
