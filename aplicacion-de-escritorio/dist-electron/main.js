import { app, BrowserWindow, Notification, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dgram from "node:dgram";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname$1, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
const UDP_PORT = 53317;
const TCP_PORT = 53318;
const DEVICE_ALIAS = `Desktop-${os.hostname()}`;
const DOWNLOAD_DIR = path.join(os.homedir(), "Downloads", "LocalSend");
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
let win;
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
      if (data.type === "beacon" && rinfo.address !== getLocalIP()) {
        win == null ? void 0 : win.webContents.send("device-found", {
          alias: data.alias,
          ip: rinfo.address,
          port: data.port,
          deviceType: data.deviceType ?? "desktop"
        });
      }
      if (data.type === "beacon") {
        const response = Buffer.from(JSON.stringify({
          type: "beacon-response",
          alias: DEVICE_ALIAS,
          port: TCP_PORT,
          deviceType: "desktop"
        }));
        udpServer.send(response, rinfo.port, rinfo.address);
      }
    } catch {
    }
  });
  udpServer.bind(UDP_PORT, () => {
    udpServer.setBroadcast(true);
    win == null ? void 0 : win.webContents.send("server-status", { udp: true });
    console.log(`UDP escuchando en puerto ${UDP_PORT}`);
  });
  setInterval(() => {
    const beacon = Buffer.from(JSON.stringify({
      type: "beacon",
      alias: DEVICE_ALIAS,
      port: TCP_PORT,
      deviceType: "desktop"
    }));
    udpServer.send(beacon, UDP_PORT, "255.255.255.255");
  }, 3e3);
  return udpServer;
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
function startTCPServer() {
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/upload") {
      const fileName = decodeURIComponent(req.headers["x-file-name"] ?? "archivo");
      const fileSize = parseInt(req.headers["x-file-size"] ?? "0");
      const savePath = getUniquePath(path.join(DOWNLOAD_DIR, fileName));
      const writeStream = fs.createWriteStream(savePath);
      let received = 0;
      req.on("data", (chunk) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        received += buf.length;
        writeStream.write(buf);
        const progress = Math.round(received / fileSize * 100);
        win == null ? void 0 : win.webContents.send("transfer-progress", { fileName, progress, received, total: fileSize });
      });
      req.on("end", () => {
        writeStream.end();
        win == null ? void 0 : win.webContents.send("transfer-complete", { fileName, savePath });
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
        new Notification({
          title: "Archivo recibido",
          body: `${fileName} guardado en Descargas/LocalSend`
        }).show();
      });
      req.on("error", () => {
        writeStream.destroy();
        res.writeHead(500);
        res.end();
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(TCP_PORT, () => {
    win == null ? void 0 : win.webContents.send("server-status", { tcp: true });
    console.log(`TCP escuchando en puerto ${TCP_PORT}`);
  });
  return server;
}
function setupIPC() {
  ipcMain.handle("get-device-info", () => ({
    alias: DEVICE_ALIAS,
    ip: getLocalIP(),
    downloadDir: DOWNLOAD_DIR
  }));
  ipcMain.handle("send-file", async (_event, { filePath, targetIP, targetPort }) => {
    return new Promise((resolve, reject) => {
      const fileName = path.basename(filePath);
      const fileSize = fs.statSync(filePath).size;
      const readStream = fs.createReadStream(filePath);
      const options = {
        hostname: targetIP,
        port: targetPort,
        path: "/upload",
        method: "POST",
        headers: {
          "x-file-name": encodeURIComponent(fileName),
          "x-file-size": fileSize,
          "Content-Type": "application/octet-stream"
        }
      };
      const req = http.request(options, (res) => {
        res.on("data", () => {
        });
        res.on("end", () => resolve({ ok: true }));
      });
      req.on("error", reject);
      let sent = 0;
      readStream.on("data", (chunk) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        sent += buf.length;
        const progress = Math.round(sent / fileSize * 100);
        win == null ? void 0 : win.webContents.send("send-progress", { fileName, progress, sent, total: fileSize });
      });
      readStream.pipe(req);
    });
  });
}
function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 650,
    icon: path.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.webContents.on("did-finish-load", () => {
    startUDPServer();
    startTCPServer();
    setupIPC();
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.whenReady().then(createWindow);
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
