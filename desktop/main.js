/* ============================================================
   EBG Lake House — Electron main process
   ------------------------------------------------------------
   Starts the local LAN server, then opens a window showing the
   admin dashboard. All data lives in the app's userData folder.

   On every new booking it notifies three EBG recipients by email:
     • If a settings.json with an smtp block exists in userData,
       the email is sent automatically via nodemailer (zero clicks).
     • Otherwise it opens the host PC's default mail client with a
       pre-addressed, pre-filled draft (just hit Send).
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, shell, dialog } = require("electron");
const { startServer } = require("./server");

let serverHandle = null;
let mainWindow = null;

// People who get notified of every new booking.
const NOTIFY = [
  { name: "Jennifer Garcia", email: "Jennifer@edgelessbeauty.com" },
  { name: "Susan Haise", email: "susan@edgelessbeauty.com" },
  { name: "Bonnie Zeutzius", email: "bonnie@nerolispa.com" }
];

// ---- email content -----------------------------------------------------

// Build { subject, body } (plain text) summarizing a booking.
function buildBookingEmail(booking) {
  const b = booking || {};
  const r = b.renter || {};
  const pricing = b.pricing || {};
  const amenities = b.amenities || {};

  const first = (r.firstName || "").trim();
  const last = (r.lastName || "").trim();
  const fullName = (first + " " + last).trim() || "(no name)";

  const checkIn = b.checkIn || "?";
  const checkOut = b.checkOut || "?";
  const nights = (b.nights != null) ? b.nights : "?";

  const numGuests = 1 + (Array.isArray(b.guests) ? b.guests.length : 0); // renter + guests
  const numVehicles = Array.isArray(b.vehicles) ? b.vehicles.length : 0;

  const yesNo = (v) => (v ? "Yes" : "No");
  const money = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  // Cleaning fee label is $250 per spec; prefer the value from the booking if present.
  const cleaningFee = (pricing.cleaningFee != null) ? money(pricing.cleaningFee) : 250;
  const gasDeposit = money(pricing.watercraftGas);
  const total = (pricing.total != null) ? money(pricing.total) : (cleaningFee + gasDeposit);

  const subject =
    "New Lake House Booking — " + fullName + " (" + checkIn + " → " + checkOut + ")";

  const lines = [];
  lines.push("A new EBG Lake House booking has been submitted.");
  lines.push("");
  lines.push("Booking ID: " + (b.id || "(none)"));
  lines.push("");
  lines.push("RENTER");
  lines.push("  Name:     " + fullName);
  lines.push("  Business: " + (r.department || "(not provided)"));
  lines.push("  Email:    " + (r.email || "(not provided)"));
  lines.push("  Phone:    " + (r.phone || "(not provided)"));
  lines.push("");
  lines.push("BOOKING REASON: " + (b.purpose || "(not provided)"));
  if (b.purpose === "Team Use") {
    lines.push("  Employee: " + (b.employeeName || "(not provided)"));
  }
  lines.push("");
  lines.push("STAY");
  lines.push("  Check-in:  " + checkIn + " (4:00 PM)");
  lines.push("  Check-out: " + checkOut + " (10:00 AM)");
  lines.push("  Nights:    " + nights);
  lines.push("  Guests:    " + numGuests + " (renter + " + (numGuests - 1) + " guest(s))");
  lines.push("  Vehicles:  " + numVehicles);
  lines.push("");
  lines.push("AMENITIES REQUESTED");
  lines.push("  Boat:         " + yesNo(amenities.boat));
  lines.push("  Wave Runners: " + yesNo(amenities.waveRunners));
  lines.push("");
  lines.push("PRICING");
  lines.push("  Cleaning Fee: $" + cleaningFee);
  lines.push("  Gas Deposit:  $" + gasDeposit);
  lines.push("  Total:        $" + total);
  lines.push("");
  lines.push("Booking documents (driver's / boating license) and the signed");
  lines.push("agreement are attached to this booking in the EBG Lake House admin app.");

  return { subject, body: lines.join("\n") };
}

// ---- settings (optional smtp config) -----------------------------------

function loadSettings() {
  try {
    const file = path.join(app.getPath("userData"), "settings.json");
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (e) {
    return null;
  }
}

// ---- the two send mechanisms -------------------------------------------

// Send automatically over SMTP using nodemailer. Returns true on success.
function sendViaSmtp(smtp, subject, body) {
  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch (e) {
    console.warn("[booking-email] nodemailer not available:", e && e.message);
    return false;
  }

  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port) || 587,
    secure: !!smtp.secure,
    auth: (smtp.user || smtp.pass) ? { user: smtp.user, pass: smtp.pass } : undefined
  });

  const to = NOTIFY.map((p) => p.name + " <" + p.email + ">").join(", ");

  // Fire and forget; log the outcome but never throw out of here.
  transport.sendMail(
    { from: smtp.from || smtp.user, to, subject, text: body },
    (err, info) => {
      if (err) console.warn("[booking-email] SMTP send failed:", err && err.message);
      else console.log("[booking-email] sent via SMTP:", info && info.messageId);
    }
  );
  return true;
}

// Fall back to opening the host PC's default mail client with a pre-filled draft.
function openMailDraft(subject, body) {
  const to = NOTIFY.map((p) => p.email).join(",");
  const mailto =
    "mailto:" + to +
    "?subject=" + encodeURIComponent(subject) +
    "&body=" + encodeURIComponent(body);
  shell.openExternal(mailto);
}

// Top-level booking handler the server calls. Always guarded so a failure
// here can never break booking creation.
function notifyNewBooking(booking) {
  try {
    const { subject, body } = buildBookingEmail(booking);
    const settings = loadSettings();
    const smtp = settings && settings.smtp;

    if (smtp && smtp.host) {
      const ok = sendViaSmtp(smtp, subject, body);
      if (ok) return; // automatic send dispatched
    }
    // No SMTP config (or nodemailer missing): pop a ready-to-send draft.
    openMailDraft(subject, body);
  } catch (e) {
    console.warn("[booking-email] notify failed:", e && e.message);
  }
}

// ---- server + window ----------------------------------------------------

// Try a few ports in case 4399 is already in use.
function startServerWithFallback(dataDir, basePort) {
  const candidates = [basePort, basePort + 1, basePort + 2, basePort + 3, basePort + 4];
  let lastErr = null;
  for (const port of candidates) {
    try {
      return startServer({ dataDir, port, onBookingCreated: notifyNewBooking });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Could not start server on any port");
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "EBG Lake House",
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadURL("http://127.0.0.1:" + port + "/admin");
  mainWindow.on("closed", () => { mainWindow = null; });
}

// ---- auto-update (GitHub Releases via electron-updater) -----------------
// In the packaged app, checks GitHub Releases for a newer version, downloads it
// in the background, and offers to restart to apply. New versions are published
// automatically by the GitHub Actions build whenever we push changes.
function setupAutoUpdate() {
  if (!app.isPackaged) return; // only the installed app self-updates
  let autoUpdater;
  try { autoUpdater = require("electron-updater").autoUpdater; }
  catch (e) { console.warn("[update] electron-updater unavailable:", e && e.message); return; }
  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("error", (e) => console.warn("[update] error:", e && e.message));
    autoUpdater.on("update-available", (info) => console.log("[update] downloading v" + (info && info.version)));
    autoUpdater.on("update-downloaded", (info) => {
      const v = info && info.version ? " (v" + info.version + ")" : "";
      dialog.showMessageBox(mainWindow, {
        type: "info",
        buttons: ["Restart now", "Later"],
        defaultId: 0,
        cancelId: 1,
        title: "Update ready",
        message: "A new version of EBG Lake House is ready" + v + ".",
        detail: "It installs when you restart the app. Restart now?"
      }).then((res) => { if (res.response === 0) autoUpdater.quitAndInstall(); }).catch(() => {});
    });
    autoUpdater.checkForUpdates().catch((e) => console.warn("[update] check failed:", e && e.message));
    setInterval(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 60 * 60 * 1000); // hourly while open
  } catch (e) {
    console.warn("[update] setup failed:", e && e.message);
  }
}

app.whenReady().then(() => {
  serverHandle = startServerWithFallback(app.getPath("userData"), 4399);
  createWindow(serverHandle.port);
  setupAutoUpdate();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(serverHandle.port);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("quit", () => {
  if (serverHandle && serverHandle.close) {
    try { serverHandle.close(); } catch (e) {}
  }
});
