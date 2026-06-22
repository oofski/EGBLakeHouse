/* ============================================================
   EBG Lake House — Electron main process
   ------------------------------------------------------------
   Starts the local LAN server, then opens a window showing the
   admin dashboard. All data lives in the app's userData folder.
   ============================================================ */
"use strict";

const { app, BrowserWindow } = require("electron");
const { startServer } = require("./server");

let serverHandle = null;
let mainWindow = null;

// Try a few ports in case 4399 is already in use.
function startServerWithFallback(dataDir, basePort) {
  const candidates = [basePort, basePort + 1, basePort + 2, basePort + 3, basePort + 4];
  let lastErr = null;
  for (const port of candidates) {
    try {
      return startServer({ dataDir, port });
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
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadURL("http://127.0.0.1:" + port + "/admin");
  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(() => {
  serverHandle = startServerWithFallback(app.getPath("userData"), 4399);
  createWindow(serverHandle.port);

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
