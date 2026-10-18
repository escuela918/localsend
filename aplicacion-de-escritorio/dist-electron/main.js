import { app, BrowserWindow, ipcMain, Notification } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dgram from "node:dgram";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
const __dirname$1 = path.dirname(
  fileURLToPath(import.meta.url)
);
process.env.APP_ROOT = path.join(
  __dirname$1,
  ".."
);
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const RENDERER_DIST = path.join(
  process.env.APP_ROOT,
  "dist"
);
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(
  process.env.APP_ROOT,
  "public"
) : RENDERER_DIST;
const UDP_PORT = 53317;
const WS_PORT = 53318;
const DEVICE_ALIAS = `Desktop-${os.hostname()}`;
const DOWNLOAD_DIR = path.join(
  os.homedir(),
  "Downloads",
  "LocalSend"
);
const STALE_MS = 5e3;
const BEACON_INTERVAL = 1e3;
const INACTIVITY_TIMEOUT = 2e4;
const PROGRESS_INTERVAL = 200;
let win = null;
let udpServer = null;
let httpServer = null;
let cleanupTimer = null;
let beaconTimer = null;
const serverStatus = {
  udp: false,
  tcp: false
};
if (!fs.existsSync(
  DOWNLOAD_DIR
)) {
  fs.mkdirSync(
    DOWNLOAD_DIR,
    {
      recursive: true
    }
  );
}
const mobileDevices = /* @__PURE__ */ new Map();
const activeTransferIPs = /* @__PURE__ */ new Map();
function markSeen(ip) {
  const device = mobileDevices.get(
    ip
  );
  if (device) {
    device.lastSeen = Date.now();
  }
}
const pendingByIP = /* @__PURE__ */ new Map();
const VIRTUAL_ADAPTER = /virtual|vmware|vbox|hyper-v|vethernet|wsl|docker|loopback|tailscale|zerotier|hamachi/i;
function getLocalInterfaces() {
  const result = [];
  for (const [
    name,
    infos
  ] of Object.entries(
    os.networkInterfaces()
  )) {
    for (const info of infos ?? []) {
      if (info.family === "IPv4" && !info.internal) {
        result.push({
          name,
          address: info.address,
          netmask: info.netmask
        });
      }
    }
  }
  return result.sort(
    (a, b) => Number(VIRTUAL_ADAPTER.test(a.name)) - Number(VIRTUAL_ADAPTER.test(b.name))
  );
}
function getLocalIP() {
  var _a;
  return ((_a = getLocalInterfaces()[0]) == null ? void 0 : _a.address) ?? "127.0.0.1";
}
function getBroadcastAddresses() {
  const addresses = /* @__PURE__ */ new Set([
    "255.255.255.255"
  ]);
  for (const iface of getLocalInterfaces()) {
    const ip = iface.address.split(".").map(Number);
    const mask = iface.netmask.split(".").map(Number);
    addresses.add(
      ip.map(
        (part, i) => part | ~mask[i] & 255
      ).join(".")
    );
  }
  return [...addresses];
}
function createProgressReporter(direction, fileName, total, peer, initialBytes = 0) {
  const startedAt = Date.now();
  activeTransferIPs.set(
    peer,
    (activeTransferIPs.get(peer) ?? 0) + 1
  );
  let ended = false;
  const end = () => {
    if (ended) {
      return;
    }
    ended = true;
    const count = (activeTransferIPs.get(peer) ?? 1) - 1;
    if (count <= 0) {
      activeTransferIPs.delete(peer);
    } else {
      activeTransferIPs.set(peer, count);
    }
    markSeen(
      peer
    );
  };
  let lastEmit = 0;
  let lastBytes = initialBytes;
  let lastTime = startedAt;
  let speed = 0;
  let bytes = initialBytes;
  const payload = () => ({
    direction,
    fileName,
    peer,
    total,
    bytes,
    progress: total > 0 ? Math.min(100, Math.floor(bytes / total * 100)) : 0,
    // Bytes por segundo
    speed,
    // Segundos restantes
    eta: speed > 0 && total > 0 ? Math.max(0, Math.round((total - bytes) / speed)) : null
  });
  return {
    update(currentBytes) {
      bytes = currentBytes;
      const now = Date.now();
      if (now - lastEmit < PROGRESS_INTERVAL) {
        return;
      }
      const instant = (bytes - lastBytes) * 1e3 / Math.max(1, now - lastTime);
      speed = speed === 0 ? instant : speed * 0.7 + instant * 0.3;
      lastBytes = bytes;
      lastTime = now;
      lastEmit = now;
      win == null ? void 0 : win.webContents.send(
        "transfer-progress",
        payload()
      );
    },
    complete(finalBytes) {
      end();
      bytes = finalBytes;
      const seconds = Math.max(1e-3, (Date.now() - startedAt) / 1e3);
      speed = (finalBytes - initialBytes) / seconds;
      win == null ? void 0 : win.webContents.send(
        "transfer-complete",
        {
          ...payload(),
          total: total || finalBytes,
          progress: 100,
          eta: 0,
          size: finalBytes
        }
      );
    },
    // El progreso NO se pierde: React recibe en qué
    // porcentaje quedó y el motivo del error.
    fail(message, canRetry) {
      end();
      win == null ? void 0 : win.webContents.send(
        "transfer-error",
        {
          ...payload(),
          speed: 0,
          eta: null,
          message,
          canRetry
        }
      );
      try {
        new Notification({
          title: "❌ Transferencia interrumpida",
          body: `${fileName}: ${message}`
        }).show();
      } catch {
      }
    }
  };
}
function cleanupStale() {
  const now = Date.now();
  for (const [
    ip,
    device
  ] of mobileDevices) {
    if (activeTransferIPs.has(
      ip
    )) {
      device.lastSeen = now;
      continue;
    }
    if (now - device.lastSeen > STALE_MS) {
      console.log(
        "📴 Dispositivo desconectado:",
        device.alias,
        ip
      );
      mobileDevices.delete(
        ip
      );
      win == null ? void 0 : win.webContents.send(
        "device-removed",
        device
      );
    }
  }
}
function startUDPServer() {
  if (udpServer) {
    return;
  }
  udpServer = dgram.createSocket({
    type: "udp4",
    // Permite reabrir la app sin esperar a que
    // Windows libere el puerto.
    reuseAddr: true
  });
  udpServer.on(
    "error",
    (error) => {
      console.error(
        "UDP error:",
        error
      );
    }
  );
  udpServer.on(
    "message",
    (msg, rinfo) => {
      try {
        const data = JSON.parse(
          msg.toString()
        );
        const myIP = getLocalIP();
        if (rinfo.address === myIP) {
          return;
        }
        if (data.deviceType === "mobile" && data.alias) {
          const device = {
            alias: data.alias,
            ip: rinfo.address,
            port: data.port ?? WS_PORT,
            deviceType: "mobile",
            lastSeen: Date.now()
          };
          const isNew = !mobileDevices.has(
            rinfo.address
          );
          mobileDevices.set(
            rinfo.address,
            device
          );
          win == null ? void 0 : win.webContents.send(
            "device-found",
            device
          );
          if (isNew) {
            sendBeacon(
              rinfo.address
            );
          }
        }
      } catch {
      }
    }
  );
  udpServer.bind(
    UDP_PORT,
    () => {
      try {
        udpServer == null ? void 0 : udpServer.setBroadcast(
          true
        );
      } catch {
      }
      console.log(
        `📡 UDP activo en ${UDP_PORT}`
      );
      serverStatus.udp = true;
      win == null ? void 0 : win.webContents.send(
        "server-status",
        serverStatus
      );
    }
  );
  beaconTimer = setInterval(
    () => {
      for (const address of getBroadcastAddresses()) {
        sendBeacon(
          address
        );
      }
    },
    BEACON_INTERVAL
  );
}
function sendBeacon(address) {
  if (!udpServer) {
    return;
  }
  const beacon = Buffer.from(
    JSON.stringify({
      service: "LocalSend",
      alias: DEVICE_ALIAS,
      ip: getLocalIP(),
      port: WS_PORT,
      deviceType: "desktop"
    })
  );
  try {
    udpServer.send(
      beacon,
      0,
      beacon.length,
      UDP_PORT,
      address
    );
  } catch {
  }
}
function getUniquePath(filePath) {
  if (!fs.existsSync(
    filePath
  )) {
    return filePath;
  }
  const ext = path.extname(
    filePath
  );
  const base = path.basename(
    filePath,
    ext
  );
  const dir = path.dirname(
    filePath
  );
  let i = 1;
  let candidate = path.join(
    dir,
    `${base}(${i})${ext}`
  );
  while (fs.existsSync(
    candidate
  )) {
    i++;
    candidate = path.join(
      dir,
      `${base}(${i})${ext}`
    );
  }
  return candidate;
}
const MIME_TO_EXT = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "video/mp4": ".mp4",
  "video/3gpp": ".3gp",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "video/x-matroska": ".mkv",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "application/pdf": ".pdf",
  "application/zip": ".zip",
  "text/plain": ".txt",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.android.package-archive": ".apk"
};
function ensureExtension(fileName, contentType) {
  if (path.extname(
    fileName
  )) {
    return fileName;
  }
  const mime = (contentType ?? "").split(";")[0].trim().toLowerCase();
  const ext = MIME_TO_EXT[mime];
  return ext ? fileName + ext : fileName;
}
function detectExtension(filePath) {
  const header = Buffer.alloc(32);
  let read = 0;
  try {
    const fd = fs.openSync(
      filePath,
      "r"
    );
    read = fs.readSync(
      fd,
      header,
      0,
      32,
      0
    );
    fs.closeSync(
      fd
    );
  } catch {
    return "";
  }
  const h = header.subarray(0, read);
  const ascii = (start, end) => h.toString("latin1", start, end);
  if (h[0] === 255 && h[1] === 216 && h[2] === 255) return ".jpg";
  if (h[0] === 137 && ascii(1, 4) === "PNG") return ".png";
  if (ascii(0, 4) === "GIF8") return ".gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return ".webp";
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (/^(heic|heix|hevc|mif1|msf1)$/.test(brand)) return ".heic";
    if (brand === "qt  ") return ".mov";
    if (brand.startsWith("3g")) return ".3gp";
    if (brand.startsWith("M4A")) return ".m4a";
    return ".mp4";
  }
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return ".wav";
  if (ascii(0, 4) === "RIFF" && ascii(8, 11) === "AVI") return ".avi";
  if (h[0] === 26 && h[1] === 69 && h[2] === 223 && h[3] === 163) return ".mkv";
  if (ascii(0, 3) === "ID3" || h[0] === 255 && (h[1] & 224) === 224) return ".mp3";
  if (ascii(0, 4) === "OggS") return ".ogg";
  if (ascii(0, 4) === "%PDF") return ".pdf";
  if (h[0] === 80 && h[1] === 75 && h[2] === 3 && h[3] === 4) return ".zip";
  return "";
}
function fixMissingExtension(filePath) {
  if (path.extname(
    filePath
  )) {
    return filePath;
  }
  const ext = detectExtension(
    filePath
  );
  if (!ext) {
    return filePath;
  }
  const newPath = getUniquePath(
    filePath + ext
  );
  try {
    fs.renameSync(
      filePath,
      newPath
    );
    console.log(
      "🏷️ Extensión agregada:",
      path.basename(newPath)
    );
    return newPath;
  } catch {
    return filePath;
  }
}
function fixOldDownloads() {
  try {
    for (const name of fs.readdirSync(
      DOWNLOAD_DIR
    )) {
      const fullPath = path.join(
        DOWNLOAD_DIR,
        name
      );
      if (fs.statSync(fullPath).isFile() && fs.statSync(fullPath).size > 0) {
        fixMissingExtension(
          fullPath
        );
      }
    }
  } catch (error) {
    console.error(
      "No se pudieron revisar las descargas:",
      error
    );
  }
}
function sanitizeFileName(name) {
  return name.replace(
    /[<>:"/\\|?*\x00-\x1F]/g,
    "_"
  ).trim() || `archivo-${Date.now()}`;
}
function startHttpServer() {
  if (httpServer) {
    return;
  }
  httpServer = http.createServer(
    (req, res) => {
      var _a, _b, _c, _d, _e;
      const clientIP = ((_a = req.socket.remoteAddress) == null ? void 0 : _a.replace(
        /^::ffff:/,
        ""
      ).replace(
        /^.*:/,
        ""
      )) || "unknown";
      markSeen(
        clientIP
      );
      const serverIP = ((_b = req.socket.localAddress) == null ? void 0 : _b.replace(
        /^::ffff:/,
        ""
      )) || getLocalIP();
      if (req.method === "GET" && req.url === "/ping") {
        res.writeHead(
          200,
          {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
          }
        );
        res.end(
          JSON.stringify({
            ok: true,
            service: "LocalSend",
            alias: DEVICE_ALIAS,
            ip: serverIP,
            port: WS_PORT
          })
        );
        return;
      }
      if (req.method === "POST" && req.url === "/register") {
        let body = "";
        req.on(
          "data",
          (chunk) => {
            body += chunk.toString();
          }
        );
        req.on(
          "end",
          () => {
            try {
              const data = JSON.parse(
                body
              );
              const device = {
                alias: data.alias || `Android-${clientIP}`,
                ip: clientIP,
                port: data.port ?? WS_PORT,
                deviceType: "mobile",
                lastSeen: Date.now()
              };
              const existed = mobileDevices.has(
                clientIP
              );
              mobileDevices.set(
                clientIP,
                device
              );
              if (!existed) {
                console.log(
                  "📱 Nuevo dispositivo:",
                  device.alias,
                  clientIP
                );
              }
              win == null ? void 0 : win.webContents.send(
                "device-found",
                device
              );
              res.writeHead(
                200,
                {
                  "Content-Type": "application/json"
                }
              );
              res.end(
                JSON.stringify({
                  ok: true
                })
              );
            } catch {
              res.writeHead(
                400,
                {
                  "Content-Type": "application/json"
                }
              );
              res.end(
                JSON.stringify({
                  ok: false
                })
              );
            }
          }
        );
        return;
      }
      if (req.method === "GET" && req.url === "/devices") {
        cleanupStale();
        const selfEntry = {
          alias: DEVICE_ALIAS,
          ip: serverIP,
          port: WS_PORT,
          deviceType: "desktop"
        };
        const list = [
          selfEntry,
          ...mobileDevices.values()
        ].filter(
          (device) => device.ip !== clientIP
        ).filter(
          (device, index, all) => all.findIndex(
            (other) => other.alias === device.alias && other.deviceType === device.deviceType
          ) === index
        );
        res.writeHead(
          200,
          {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
          }
        );
        res.end(
          JSON.stringify(
            list
          )
        );
        return;
      }
      if (req.method === "GET" && req.url === "/incoming") {
        const list = (pendingByIP.get(
          clientIP
        ) ?? []).map(
          (file) => ({
            id: file.id,
            fileName: file.fileName,
            fileSize: file.fileSize
          })
        );
        res.writeHead(
          200,
          {
            "Content-Type": "application/json"
          }
        );
        res.end(
          JSON.stringify(
            list
          )
        );
        return;
      }
      if (req.method === "GET" && ((_c = req.url) == null ? void 0 : _c.startsWith(
        "/download/"
      ))) {
        const id = decodeURIComponent(
          req.url.substring(
            "/download/".length
          )
        );
        const list = pendingByIP.get(
          clientIP
        ) ?? [];
        const index = list.findIndex(
          (file2) => file2.id === id
        );
        if (index === -1) {
          res.writeHead(
            404,
            {
              "Content-Type": "application/json"
            }
          );
          res.end(
            JSON.stringify({
              error: "Archivo no encontrado"
            })
          );
          return;
        }
        const file = list[index];
        if (!fs.existsSync(
          file.filePath
        )) {
          list.splice(
            index,
            1
          );
          res.writeHead(
            404
          );
          res.end();
          return;
        }
        const rangeMatch = /^bytes=(\d+)-$/.exec(
          String(
            req.headers.range ?? ""
          )
        );
        const start = rangeMatch ? Number(rangeMatch[1]) : 0;
        if (start >= file.fileSize && file.fileSize > 0) {
          res.writeHead(
            416,
            {
              "Content-Range": `bytes */${file.fileSize}`
            }
          );
          res.end();
          return;
        }
        if (start > 0) {
          console.log(
            "⏯️ Reanudando",
            file.fileName,
            "desde el byte",
            start
          );
        }
        res.writeHead(
          start > 0 ? 206 : 200,
          {
            "Content-Type": "application/octet-stream",
            // Solo lo que falta mandar.
            "Content-Length": file.fileSize - start,
            ...start > 0 ? {
              "Content-Range": `bytes ${start}-${file.fileSize - 1}/${file.fileSize}`
            } : {},
            // Le avisamos al celular que puede reanudar.
            "Accept-Ranges": "bytes",
            "Content-Disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"`,
            "Cache-Control": "no-store"
          }
        );
        const readStream = fs.createReadStream(
          file.filePath,
          {
            start,
            highWaterMark: 1024 * 1024
          }
        );
        const reporter = createProgressReporter(
          "send",
          file.fileName,
          file.fileSize,
          clientIP,
          start
        );
        let sentBytes = start;
        let completed = false;
        let failed = false;
        const fail = (message) => {
          if (completed || failed) {
            return;
          }
          failed = true;
          console.log(
            "⚠️ Envío interrumpido:",
            file.fileName,
            message
          );
          reporter.fail(
            message,
            true
          );
          readStream.destroy();
        };
        res.setTimeout(
          INACTIVITY_TIMEOUT,
          () => {
            fail(
              `Se perdió la conexión con el celular (sin actividad durante ${INACTIVITY_TIMEOUT / 1e3} s). El celular puede reanudar desde donde quedó.`
            );
            res.destroy();
          }
        );
        readStream.on(
          "data",
          (chunk) => {
            sentBytes += chunk.length;
            reporter.update(
              sentBytes
            );
          }
        );
        readStream.on(
          "error",
          (error) => {
            console.error(
              "Error leyendo archivo:",
              error
            );
            fail(
              `No se pudo leer el archivo en la PC: ${error.message}`
            );
            res.destroy();
          }
        );
        res.on(
          "close",
          () => {
            if (!completed && !res.writableFinished) {
              fail(
                `El celular se desconectó al ${file.fileSize > 0 ? Math.floor(sentBytes / file.fileSize * 100) : 0}%. Puede reanudar desde ese punto.`
              );
            }
          }
        );
        res.on(
          "finish",
          () => {
            completed = true;
            reporter.complete(
              sentBytes
            );
          }
        );
        readStream.on(
          "close",
          () => {
            if (completed) {
              const current = pendingByIP.get(
                clientIP
              );
              if (current) {
                const currentIndex = current.findIndex(
                  (item) => item.id === file.id
                );
                if (currentIndex !== -1) {
                  current.splice(
                    currentIndex,
                    1
                  );
                }
              }
              try {
                new Notification({
                  title: "📤 Archivo enviado",
                  body: `${file.fileName} fue descargado por el celular.`
                }).show();
              } catch {
              }
            }
          }
        );
        readStream.pipe(
          res
        );
        return;
      }
      if (req.method === "POST" && ((_d = req.url) == null ? void 0 : _d.startsWith(
        "/upload"
      ))) {
        const urlObj = new URL(
          req.url,
          `http://${req.headers.host}`
        );
        const rawName = urlObj.searchParams.get(
          "fileName"
        ) || `archivo-${Date.now()}`;
        const fileName = ensureExtension(
          sanitizeFileName(
            rawName
          ),
          req.headers["content-type"]
        );
        const finalPath = getUniquePath(
          path.join(
            DOWNLOAD_DIR,
            fileName
          )
        );
        const expectedSize = Number(
          req.headers["content-length"] ?? urlObj.searchParams.get(
            "size"
          ) ?? 0
        );
        console.log(
          "📥 Recibiendo:",
          fileName
        );
        console.log(
          "📦 Tamaño esperado:",
          expectedSize
        );
        const writeStream = fs.createWriteStream(
          finalPath,
          {
            flags: "w",
            highWaterMark: 1024 * 1024
          }
        );
        const reporter = createProgressReporter(
          "receive",
          fileName,
          expectedSize,
          clientIP
        );
        let receivedBytes = 0;
        let finished = false;
        let failed = false;
        const fail = (message) => {
          if (finished || failed) {
            return;
          }
          failed = true;
          console.log(
            "❌ Recepción interrumpida:",
            fileName,
            message
          );
          reporter.fail(
            message,
            false
          );
          req.unpipe(
            writeStream
          );
          writeStream.destroy();
          fs.unlink(
            finalPath,
            () => {
            }
          );
        };
        req.setTimeout(
          INACTIVITY_TIMEOUT,
          () => {
            fail(
              `No llegaron datos durante ${INACTIVITY_TIMEOUT / 1e3} s: se perdió la conexión con el celular. Hay que reiniciar el envío desde el celular.`
            );
            req.destroy();
          }
        );
        req.on(
          "data",
          (chunk) => {
            receivedBytes += chunk.length;
            reporter.update(
              receivedBytes
            );
          }
        );
        req.on(
          "close",
          () => {
            if (!req.complete) {
              const percent = expectedSize > 0 ? Math.floor(receivedBytes / expectedSize * 100) : 0;
              fail(
                `La conexión con el celular se cortó al ${percent}%. Hay que reiniciar el envío desde el celular.`
              );
            }
          }
        );
        req.on(
          "error",
          (error) => {
            console.error(
              "❌ Error request:",
              error
            );
          }
        );
        writeStream.on(
          "error",
          (error) => {
            if (failed) {
              return;
            }
            console.error(
              "❌ Error escribiendo:",
              error
            );
            const reason = error.code === "ENOSPC" ? "No hay espacio suficiente en el disco de la PC." : `No se pudo guardar el archivo en la PC (${error.message}).`;
            fail(
              reason
            );
            req.unpipe(
              writeStream
            );
            req.resume();
            try {
              if (!res.headersSent) {
                res.writeHead(
                  500,
                  {
                    "Content-Type": "application/json"
                  }
                );
                res.end(
                  JSON.stringify({
                    ok: false,
                    error: reason
                  })
                );
              }
            } catch {
            }
          }
        );
        writeStream.on(
          "finish",
          () => {
            if (finished || failed) {
              return;
            }
            finished = true;
            const actualSize = fs.statSync(
              finalPath
            ).size;
            if (expectedSize > 0 && actualSize !== expectedSize) {
              console.error(
                "❌ Tamaño incorrecto:",
                actualSize,
                expectedSize
              );
              try {
                fs.unlinkSync(
                  finalPath
                );
              } catch {
              }
              reporter.fail(
                `El archivo llegó incompleto (${actualSize} de ${expectedSize} bytes). Se descartó; hay que reiniciar el envío.`,
                false
              );
              res.writeHead(
                400,
                {
                  "Content-Type": "application/json"
                }
              );
              res.end(
                JSON.stringify({
                  ok: false,
                  error: "El tamaño del archivo recibido no coincide.",
                  received: actualSize,
                  expected: expectedSize
                })
              );
              return;
            }
            const savedPath = fixMissingExtension(
              finalPath
            );
            const savedName = path.basename(
              savedPath
            );
            console.log(
              "✅ Archivo recibido:",
              savedPath
            );
            console.log(
              "📦 Bytes:",
              actualSize
            );
            reporter.complete(
              actualSize
            );
            try {
              new Notification({
                title: "📦 Archivo recibido",
                body: `${savedName} guardado en ${DOWNLOAD_DIR}`
              }).show();
            } catch {
            }
            res.writeHead(
              200,
              {
                "Content-Type": "application/json"
              }
            );
            res.end(
              JSON.stringify({
                ok: true,
                fileName: savedName,
                size: actualSize,
                path: savedPath
              })
            );
          }
        );
        req.pipe(
          writeStream
        );
        return;
      }
      if (req.method === "POST" && ((_e = req.url) == null ? void 0 : _e.startsWith(
        "/discard/"
      ))) {
        const id = req.url.substring(
          "/discard/".length
        );
        const list = pendingByIP.get(
          clientIP
        ) ?? [];
        const index = list.findIndex(
          (file) => file.id === id
        );
        if (index !== -1) {
          const [file] = list.splice(
            index,
            1
          );
          win == null ? void 0 : win.webContents.send(
            "transfer-error",
            {
              direction: "send",
              fileName: file.fileName,
              peer: clientIP,
              total: file.fileSize,
              bytes: 0,
              progress: 0,
              speed: 0,
              eta: null,
              message: "El celular descartó el archivo después del error. Si querés, volvé a enviarlo.",
              canRetry: false
            }
          );
        }
        res.writeHead(
          200,
          {
            "Content-Type": "application/json"
          }
        );
        res.end(
          JSON.stringify({
            ok: true
          })
        );
        return;
      }
      res.writeHead(
        200,
        {
          "Content-Type": "text/plain"
        }
      );
      res.end(
        "LocalSend TCP Node Active"
      );
    }
  );
  httpServer.on(
    "error",
    (error) => {
      console.error(
        "HTTP server error:",
        error
      );
    }
  );
  httpServer.requestTimeout = 0;
  httpServer.timeout = 0;
  httpServer.headersTimeout = 6e4;
  httpServer.keepAliveTimeout = 5e3;
  httpServer.listen(
    WS_PORT,
    "0.0.0.0",
    () => {
      console.log(
        `🌐 HTTP activo en 0.0.0.0:${WS_PORT}`
      );
      console.log(
        `📁 Descargas: ${DOWNLOAD_DIR}`
      );
      serverStatus.tcp = true;
      win == null ? void 0 : win.webContents.send(
        "server-status",
        serverStatus
      );
    }
  );
}
function setupIPC() {
  if (ipcMain.listenerCount(
    "get-device-info"
  ) === 0) {
    ipcMain.handle(
      "get-device-info",
      () => ({
        alias: DEVICE_ALIAS,
        ip: getLocalIP(),
        downloadDir: DOWNLOAD_DIR
      })
    );
  }
  if (ipcMain.listenerCount(
    "send-file"
  ) === 0) {
    ipcMain.handle(
      "send-file",
      async (_event, {
        filePath,
        targetIP
      }) => {
        try {
          if (!filePath || !targetIP) {
            return {
              ok: false,
              error: "Faltan datos"
            };
          }
          if (!fs.existsSync(
            filePath
          )) {
            return {
              ok: false,
              error: "El archivo no existe"
            };
          }
          const stats = fs.statSync(
            filePath
          );
          if (!stats.isFile()) {
            return {
              ok: false,
              error: "La ruta no es un archivo"
            };
          }
          const fileName = path.basename(
            filePath
          );
          const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
          const list = pendingByIP.get(
            targetIP
          ) ?? [];
          list.push({
            id,
            filePath,
            fileName,
            fileSize: stats.size
          });
          pendingByIP.set(
            targetIP,
            list
          );
          console.log(
            "📤 Archivo puesto en cola:",
            fileName,
            "→",
            targetIP
          );
          win == null ? void 0 : win.webContents.send(
            "transfer-queued",
            {
              fileName,
              targetIP,
              fileSize: stats.size
            }
          );
          return {
            ok: true
          };
        } catch (error) {
          console.error(
            "send-file:",
            error
          );
          return {
            ok: false,
            error: "Error interno"
          };
        }
      }
    );
  }
}
function createWindow() {
  win = new BrowserWindow({
    width: 960,
    height: 820,
    minWidth: 520,
    minHeight: 600,
    title: "LocalSend",
    // Oculta el menú "File / Edit / View" (en inglés).
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(
        __dirname$1,
        "preload.mjs"
      ),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(
      VITE_DEV_SERVER_URL
    );
  } else {
    win.loadFile(
      path.join(
        RENDERER_DIST,
        "index.html"
      )
    );
  }
  win.webContents.on(
    "did-finish-load",
    () => {
      win == null ? void 0 : win.webContents.send(
        "server-status",
        {
          ...serverStatus,
          ip: getLocalIP(),
          port: WS_PORT,
          alias: DEVICE_ALIAS
        }
      );
    }
  );
}
app.whenReady().then(
  () => {
    setupIPC();
    fixOldDownloads();
    createWindow();
    startUDPServer();
    startHttpServer();
    cleanupTimer = setInterval(
      cleanupStale,
      1e3
    );
    app.on(
      "activate",
      () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindow();
        }
      }
    );
  }
);
app.on(
  "window-all-closed",
  () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  }
);
app.on(
  "before-quit",
  () => {
    if (beaconTimer) {
      clearInterval(
        beaconTimer
      );
    }
    if (cleanupTimer) {
      clearInterval(
        cleanupTimer
      );
    }
    try {
      udpServer == null ? void 0 : udpServer.close();
    } catch {
    }
    try {
      httpServer == null ? void 0 : httpServer.close();
    } catch {
    }
  }
);
export {
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
