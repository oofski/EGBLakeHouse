/* ============================================================
   EBG Lake House — Electron main process (cloud edition)
   ------------------------------------------------------------
   This desktop app is now a dedicated window onto the CLOUD
   admin dashboard hosted on Cloudflare Pages. It loads the live
   admin page so the admin sees every booking — including ones
   made remotely by scanning the QR. All data lives in Cloudflare
   (D1 + R2), not on this PC.

   The app still auto-updates itself from GitHub Releases, so
   pushing a new build updates every installed copy.
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, shell, dialog } = require("electron");

let mainWindow = null;

// The live cloud admin dashboard this app opens. Can be overridden by a
// settings.json in the app's userData folder:
//   { "cloudUrl": "https://your-custom-domain/admin.html" }
// so moving to a custom domain later doesn't require a rebuild.
const DEFAULT_CLOUD_URL = "https://egblakehouse.pages.dev/admin.html";

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

function cloudUrl() {
  const s = loadSettings();
  if (s && typeof s.cloudUrl === "string" && s.cloudUrl.trim()) {
    return s.cloudUrl.trim();
  }
  return DEFAULT_CLOUD_URL;
}

// Friendly fallback shown if the cloud can't be reached (no internet, etc.).
function showOfflinePage(win, url) {
  const safe = String(url).replace(/'/g, "%27");
  const html =
    "<!doctype html><html><head><meta charset='utf-8'>" +
    "<meta name='viewport' content='width=device-width, initial-scale=1'>" +
    "<title>EBG Lake House</title>" +
    "<style>body{font-family:'Segoe UI',Helvetica,Arial,sans-serif;background:#F5F0E8;" +
    "color:#2C2C2C;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}" +
    ".box{background:#FDFAF5;border:1px solid #D4C9B5;border-radius:14px;padding:40px 44px;" +
    "max-width:460px;text-align:center;box-shadow:0 10px 30px rgba(44,44,44,.14);}" +
    "h1{font-family:Georgia,serif;color:#8B6E3A;margin:0 0 12px;font-size:1.6rem;}" +
    "p{color:#6B6B6B;line-height:1.6;margin:0 0 8px;}" +
    "button{margin-top:20px;background:#B8965A;color:#fff;border:none;border-radius:50px;" +
    "padding:12px 30px;font-size:1rem;cursor:pointer;}button:hover{background:#8B6E3A;}</style>" +
    "</head><body><div class='box'><h1>Can't reach the Lake House cloud</h1>" +
    "<p>This app needs an internet connection to load the live booking dashboard.</p>" +
    "<p>Check your Wi-Fi or network, then try again.</p>" +
    "<button onclick=\"location.href='" + safe + "'\">Try again</button>" +
    "</div></body></html>";
  win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
}

function createWindow() {
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

  const url = cloudUrl();
  mainWindow.loadURL(url);

  // On a load failure (offline / cloud unreachable), show a retry page.
  mainWindow.webContents.on("did-fail-load", function (e, code, desc, validatedURL, isMainFrame) {
    // code -3 is an aborted load (e.g. a redirect) — ignore it, and never loop
    // on the data: fallback page itself.
    if (isMainFrame && code !== -3 && String(validatedURL).indexOf("data:") !== 0) {
      showOfflinePage(mainWindow, url);
    }
  });

  // Open any external links (mailto:, Venmo, etc.) in the system browser.
  mainWindow.webContents.setWindowOpenHandler(function (details) {
    try { shell.openExternal(details.url); } catch (e) {}
    return { action: "deny" };
  });

  mainWindow.on("closed", function () { mainWindow = null; });
}

// ---- auto-update (GitHub Releases via electron-updater) -----------------
// In the packaged app, checks GitHub Releases for a newer version, downloads
// it in the background, and offers to restart to apply. New versions are
// published automatically by the GitHub Actions build whenever we push.
function setupAutoUpdate() {
  if (!app.isPackaged) return; // only the installed app self-updates
  let autoUpdater;
  try { autoUpdater = require("electron-updater").autoUpdater; }
  catch (e) { console.warn("[update] electron-updater unavailable:", e && e.message); return; }
  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("error", function (e) { console.warn("[update] error:", e && e.message); });
    autoUpdater.on("update-available", function (info) { console.log("[update] downloading v" + (info && info.version)); });
    autoUpdater.on("update-downloaded", function (info) {
      const v = info && info.version ? " (v" + info.version + ")" : "";
      dialog.showMessageBox(mainWindow, {
        type: "info",
        buttons: ["Restart now", "Later"],
        defaultId: 0,
        cancelId: 1,
        title: "Update ready",
        message: "A new version of EBG Lake House is ready" + v + ".",
        detail: "It installs when you restart the app. Restart now?"
      }).then(function (res) { if (res.response === 0) autoUpdater.quitAndInstall(); }).catch(function () {});
    });
    autoUpdater.checkForUpdates().catch(function (e) { console.warn("[update] check failed:", e && e.message); });
    setInterval(function () { autoUpdater.checkForUpdates().catch(function () {}); }, 60 * 60 * 1000); // hourly while open
  } catch (e) {
    console.warn("[update] setup failed:", e && e.message);
  }
}

app.whenReady().then(function () {
  createWindow();
  setupAutoUpdate();

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});
