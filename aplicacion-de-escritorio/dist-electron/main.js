import { app, BrowserWindow, Notification, ipcMain } from "electron";
import { fileURLToPath, URL } from "node:url";
import path from "node:path";
import dgram from "node:dgram";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname$1, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
const UDP_PORT = 53317;
const WS_PORT = 53318;
const DEVICE_ALIAS = `Desktop-${os.hostname()}`;
const DOWNLOAD_DIR = path.join(os.homedir(), "Downloads", "LocalSend");
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
let win = null;
const mobileDevices = /* @__PURE__ */ new Map();
const STALE_MS = 15e3;
const pendingByIP = /* @__PURE__ */ new Map();
function cleanupStale() {
  const now = Date.now();
  for (const [ip, d] of mobileDevices) {
    if (now - d.lastSeen > STALE_MS) mobileDevices.delete(ip);
  }
}
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    for (const info of iface ?? []) {
      if (info.family === "IPv4" && !info.internal) return info.address;
    }
  }
  return "127.0.0.1";
}
function startUDPServer() {
  const udpServer = dgram.createSocket("udp4");
  udpServer.on("message", (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString());
      const myIP = getLocalIP();
      if (rinfo.address === myIP || data.alias === DEVICE_ALIAS) return;
      if (data.deviceType === "mobile" && data.alias) {
        mobileDevices.set(rinfo.address, {
          alias: data.alias,
          ip: rinfo.address,
          port: data.port ?? WS_PORT,
          deviceType: "mobile",
          lastSeen: Date.now()
        });
        win == null ? void 0 : win.webContents.send("device-found", mobileDevices.get(rinfo.address));
      }
    } catch (e) {
    }
  });
  udpServer.bind(UDP_PORT, () => {
    udpServer.setBroadcast(true);
    win == null ? void 0 : win.webContents.send("server-status", { udp: true });
  });
  setInterval(() => {
    const beacon = Buffer.from(
      JSON.stringify({ alias: DEVICE_ALIAS, port: WS_PORT, deviceType: "desktop" })
    );
    udpServer.send(beacon, UDP_PORT, "255.255.255.255");
  }, 3e3);
}
function getUniquePath(filePath) {
  if (!fs.existsSync(filePath)) return filePath;
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const dir = path.dirname(filePath);
  let i = 1;
  while (fs.existsSync(path.join(dir, `${base}(${i})${ext}`))) i++;
  return path.join(dir, `${base}(${i})${ext}`);
}
function startHttpServer() {
  const server = http.createServer((req, res) => {
    var _a, _b, _c;
    const clientIP = ((_a = req.socket.remoteAddress) == null ? void 0 : _a.replace(/^.*:/, "")) || "unknown";
    if (req.method === "POST" && req.url === "/register") {
      let body = "";
      req.on("data", (chunk) => body += chunk);
      req.on("end", () => {
        try {
          const data = JSON.parse(body);
          mobileDevices.set(clientIP, {
            alias: data.alias,
            ip: clientIP,
            port: data.port ?? WS_PORT,
            deviceType: "mobile",
            lastSeen: Date.now()
          });
          win == null ? void 0 : win.webContents.send("device-found", mobileDevices.get(clientIP));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "bad json" }));
        }
      });
      return;
    }
    if (req.method === "GET" && req.url === "/devices") {
      cleanupStale();
      const selfEntry = {
        alias: DEVICE_ALIAS,
        ip: getLocalIP(),
        port: WS_PORT,
        deviceType: "desktop"
      };
      const list = [selfEntry, ...mobileDevices.values()].filter((d) => d.ip !== clientIP);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(list));
      return;
    }
    if (req.method === "GET" && req.url === "/incoming") {
      const list = (pendingByIP.get(clientIP) ?? []).map((f) => ({
        id: f.id,
        fileName: f.fileName,
        fileSize: f.fileSize
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(list));
      return;
    }
    if (req.method === "GET" && ((_b = req.url) == null ? void 0 : _b.startsWith("/download/"))) {
      const id = req.url.split("/download/")[1];
      const list = pendingByIP.get(clientIP) ?? [];
      const idx = list.findIndex((f) => f.id === id);
      if (idx === -1) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }
      const file = list[idx];
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": file.fileSize,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"`
      });
      const readStream = fs.createReadStream(file.filePath);
      readStream.pipe(res);
      readStream.on("close", () => {
        list.splice(idx, 1);
        win == null ? void 0 : win.webContents.send("transfer-complete");
        new Notification({
          title: "📤 Enviado",
          body: `${file.fileName} fue descargado por el celular.`
        }).show();
      });
      readStream.on("error", () => {
        list.splice(idx, 1);
      });
      return;
    }
    if (req.method === "POST" && ((_c = req.url) == null ? void 0 : _c.startsWith("/upload"))) {
      const urlObj = new URL(req.url, `http://${req.headers.host}`);
      const rawName = urlObj.searchParams.get("fileName") || `archivo-${Date.now()}`;
      const fileName = decodeURIComponent(rawName);
      const fullPath = getUniquePath(path.join(DOWNLOAD_DIR, fileName));
      const writeStream = fs.createWriteStream(fullPath);
      const fileSize = parseInt(req.headers["content-length"] || "0", 10);
      let receivedBytes = 0;
      req.on("data", (chunk) => {
        receivedBytes += chunk.length;
        if (fileSize > 0) {
          const progress = Math.round(receivedBytes / fileSize * 100);
          win == null ? void 0 : win.webContents.send("transfer-progress", { fileName, progress, total: fileSize });
        }
      });
      req.pipe(writeStream);
      writeStream.on("finish", () => {
        win == null ? void 0 : win.webContents.send("transfer-complete");
        new Notification({
          title: "📦 Archivo recibido con éxito",
          body: `${fileName} guardado en ${DOWNLOAD_DIR}`
        }).show();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      writeStream.on("error", () => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false }));
      });
      return;
    }
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("LocalSend TCP Node Active");
  });
  server.listen(WS_PORT, "0.0.0.0", () => {
    win == null ? void 0 : win.webContents.send("server-status", { tcp: true });
  });
}
function setupIPC() {
  ipcMain.handle("get-device-info", () => ({
    alias: DEVICE_ALIAS,
    ip: getLocalIP(),
    downloadDir: DOWNLOAD_DIR
  }));
  ipcMain.handle("send-file", async (_event, { filePath, targetIP }) => {
    try {
      if (!fs.existsSync(filePath)) return { ok: false, error: "archivo no existe" };
      const fileName = path.basename(filePath);
      const fileSize = fs.statSync(filePath).size;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const list = pendingByIP.get(targetIP) ?? [];
      list.push({ id, filePath, fileName, fileSize });
      pendingByIP.set(targetIP, list);
      win == null ? void 0 : win.webContents.send("transfer-queued", { fileName, targetIP });
      return { ok: true };
    } catch (e) {
      return { ok: false };
    }
  });
}
function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 650,
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.webContents.on("did-finish-load", () => {
    startUDPServer();
    startHttpServer();
    setupIPC();
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}
app.whenReady().then(createWindow);
export {
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
