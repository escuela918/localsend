import { app as j, BrowserWindow as te, ipcMain as L, Notification as P, dialog as K } from "electron";
import { randomUUID as de } from "node:crypto";
import { fileURLToPath as pe } from "node:url";
import g from "node:path";
import ue from "node:dgram";
import fe from "node:http";
import h from "node:fs";
import W from "node:os";
const oe = g.dirname(
  pe(import.meta.url)
);
process.env.APP_ROOT = g.join(
  oe,
  ".."
);
const U = process.env.VITE_DEV_SERVER_URL, ne = g.join(
  process.env.APP_ROOT,
  "dist"
);
process.env.VITE_PUBLIC = U ? g.join(
  process.env.APP_ROOT,
  "public"
) : ne;
const J = 53317, D = 53318, z = `Desktop-${W.hostname()}`, A = g.join(
  W.homedir(),
  "Downloads",
  "LocalSend"
), me = 5e3, he = 1e3, H = 2e4, ge = 200, ie = 6e4, ye = 2 * 60 * 1e3;
let n = null, S = null, T = null, V = null, B = null;
const _ = {
  udp: !1,
  tcp: !1
};
h.existsSync(
  A
) || h.mkdirSync(
  A,
  {
    recursive: !0
  }
);
const N = /* @__PURE__ */ new Map(), I = /* @__PURE__ */ new Map();
function re(e) {
  const t = N.get(
    e
  );
  t && (t.lastSeen = Date.now());
}
const k = /* @__PURE__ */ new Map(), F = /* @__PURE__ */ new Map();
async function we(e, t, o, i) {
  n && (n.isMinimized() && n.restore(), n.show(), n.focus(), n.flashFrame(
    !0
  ));
  try {
    new P({
      title: "📥 Archivo entrante",
      body: `${o} quiere enviarte "${e}"`
    }).show();
  } catch {
  }
  const a = new AbortController();
  let p = "rejected";
  const v = setTimeout(
    () => {
      p = "timeout", a.abort();
    },
    ie
  ), E = () => {
    p = "cancelled", a.abort();
  };
  i.addEventListener(
    "abort",
    E
  );
  const x = {
    // Ícono de pregunta
    type: "question",
    // Título de la ventanita
    title: "Archivo entrante",
    // Texto principal
    message: `${o} quiere enviarte un archivo`,
    // Texto chico: nombre, tamaño y dónde se va a guardar
    detail: `${e}
${Se(t)}

Se guardará en ${A}`,
    // Botones: el 0 es Aceptar y el 1 es Rechazar
    buttons: [
      "Aceptar",
      "Rechazar"
    ],
    // Botón marcado por defecto (Enter = Aceptar)
    defaultId: 0,
    // Botón que cuenta si cierran con Esc o la X
    // (Rechazar)
    cancelId: 1,
    // Mostrar los botones como botones normales (en
    // Windows)
    noLink: !0,
    // Conecta el cartel con el "botón de cancelar" para
    // cerrarlo desde el código
    signal: a.signal
  };
  try {
    const { response: f } = n ? await K.showMessageBox(n, x) : await K.showMessageBox(x);
    return a.signal.aborted ? p : f === 0 ? "accepted" : "rejected";
  } finally {
    clearTimeout(
      v
    ), i.removeEventListener(
      "abort",
      E
    ), n == null || n.flashFrame(
      !1
    );
  }
}
function Se(e) {
  if (!e)
    return "0 B";
  const t = ["B", "KB", "MB", "GB", "TB"], o = Math.min(
    t.length - 1,
    Math.floor(Math.log(e) / Math.log(1024))
  );
  return `${(e / Math.pow(1024, o)).toFixed(o === 0 ? 0 : 1)} ${t[o]}`;
}
const X = /virtual|vmware|vbox|hyper-v|vethernet|wsl|docker|loopback|tailscale|zerotier|hamachi/i;
function ae() {
  const e = [];
  for (const [
    t,
    o
  ] of Object.entries(
    W.networkInterfaces()
  ))
    for (const i of o ?? [])
      i.family === "IPv4" && !i.internal && e.push({
        name: t,
        address: i.address,
        netmask: i.netmask
      });
  return e.sort(
    (t, o) => Number(X.test(t.name)) - Number(X.test(o.name))
  );
}
function M() {
  var e;
  return ((e = ae()[0]) == null ? void 0 : e.address) ?? "127.0.0.1";
}
function ve() {
  const e = /* @__PURE__ */ new Set([
    "255.255.255.255"
  ]);
  for (const t of ae()) {
    const o = t.address.split(".").map(Number), i = t.netmask.split(".").map(Number);
    e.add(
      o.map(
        (a, p) => a | ~i[p] & 255
      ).join(".")
    );
  }
  return [...e];
}
function Q(e, t, o, i, a = 0) {
  const p = Date.now();
  I.set(
    i,
    (I.get(i) ?? 0) + 1
  );
  let v = !1;
  const E = () => {
    if (v)
      return;
    v = !0;
    const r = (I.get(i) ?? 1) - 1;
    r <= 0 ? I.delete(i) : I.set(i, r), re(
      i
    );
  };
  let x = 0, f = a, d = p, c = 0, s = a;
  const m = () => ({
    direction: e,
    fileName: t,
    peer: i,
    total: o,
    bytes: s,
    // Porcentaje: bytes / total × 100, redondeado para
    // abajo y sin pasar de 100.
    progress: o > 0 ? Math.min(100, Math.floor(s / o * 100)) : 0,
    // Velocidad en bytes por segundo
    speed: c,
    // ETA = segundos que faltan = lo que falta /
    // velocidad. null si todavía no hay velocidad.
    eta: c > 0 && o > 0 ? Math.max(0, Math.round((o - s) / c)) : null
  });
  return {
    // update(): se llama con cada pedacito (chunk) del
    // archivo.
    update(r) {
      s = r;
      const l = Date.now();
      if (l - x < ge)
        return;
      const w = (s - f) * 1e3 / Math.max(1, l - d);
      c = c === 0 ? w : c * 0.7 + w * 0.3, f = s, d = l, x = l, n == null || n.webContents.send(
        "transfer-progress",
        m()
      );
    },
    // complete(): la transferencia terminó bien.
    complete(r) {
      E(), s = r;
      const l = Math.max(1e-3, (Date.now() - p) / 1e3);
      c = (r - a) / l, n == null || n.webContents.send(
        "transfer-complete",
        {
          ...m(),
          total: o || r,
          progress: 100,
          eta: 0,
          size: r
        }
      );
    },
    // fail(): se cortó. Avisa el motivo y en qué % quedó;
    // la barra NO se borra. canRetry = si se puede
    // reintentar.
    fail(r, l) {
      E(), n == null || n.webContents.send(
        "transfer-error",
        {
          ...m(),
          speed: 0,
          eta: null,
          message: r,
          canRetry: l
        }
      );
      try {
        new P({
          title: "❌ Transferencia interrumpida",
          body: `${t}: ${r}`
        }).show();
      } catch {
      }
    }
  };
}
function se() {
  const e = Date.now();
  for (const [
    t,
    o
  ] of N) {
    if (I.has(
      t
    )) {
      o.lastSeen = e;
      continue;
    }
    e - o.lastSeen > me && (console.log(
      "📴 Dispositivo desconectado:",
      o.alias,
      t
    ), N.delete(
      t
    ), n == null || n.webContents.send(
      "device-removed",
      o
    ));
  }
}
function be() {
  S || (S = ue.createSocket({
    // udp4 = usamos direcciones IPv4
    type: "udp4",
    // Si cerrás y abrís la app enseguida, Windows a veces
    // sigue teniendo el puerto "ocupado". Con esto lo
    // podemos usar igual.
    reuseAddr: !0
  }), S.on(
    "error",
    (e) => {
      console.error(
        "UDP error:",
        e
      );
    }
  ), S.on(
    "message",
    (e, t) => {
      try {
        const o = JSON.parse(
          e.toString()
        ), i = M();
        if (t.address === i)
          return;
        if (o.deviceType === "mobile" && o.alias) {
          const a = {
            alias: o.alias,
            ip: t.address,
            port: o.port ?? D,
            deviceType: "mobile",
            lastSeen: Date.now()
          }, p = !N.has(
            t.address
          );
          N.set(
            t.address,
            a
          ), n == null || n.webContents.send(
            "device-found",
            a
          ), p && Y(
            t.address
          );
        }
      } catch {
      }
    }
  ), S.bind(
    J,
    () => {
      try {
        S == null || S.setBroadcast(
          !0
        );
      } catch {
      }
      console.log(
        `📡 UDP activo en ${J}`
      ), _.udp = !0, n == null || n.webContents.send(
        "server-status",
        _
      );
    }
  ), B = setInterval(
    () => {
      for (const e of ve())
        Y(
          e
        );
    },
    he
  ));
}
function Y(e) {
  if (!S)
    return;
  const t = Buffer.from(
    JSON.stringify({
      // Para que sepan que es LocalSend
      service: "LocalSend",
      // Nombre de la PC
      alias: z,
      // IP de la PC
      ip: M(),
      // Puerto donde recibimos archivos (53318)
      port: D,
      // Somos una PC
      deviceType: "desktop"
    })
  );
  try {
    S.send(
      t,
      0,
      t.length,
      J,
      e
    );
  } catch {
  }
}
function ce(e) {
  if (!h.existsSync(
    e
  ))
    return e;
  const t = g.extname(
    e
  ), o = g.basename(
    e,
    t
  ), i = g.dirname(
    e
  );
  let a = 1, p = g.join(
    i,
    `${o}(${a})${t}`
  );
  for (; h.existsSync(
    p
  ); )
    a++, p = g.join(
      i,
      `${o}(${a})${t}`
    );
  return p;
}
const Ce = {
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
function Z(e, t) {
  if (g.extname(
    e
  ))
    return e;
  const o = (t ?? "").split(";")[0].trim().toLowerCase(), i = Ce[o];
  return i ? e + i : e;
}
function Te(e) {
  const t = Buffer.alloc(32);
  let o = 0;
  try {
    const p = h.openSync(
      e,
      "r"
    );
    o = h.readSync(
      p,
      t,
      0,
      32,
      0
    ), h.closeSync(
      p
    );
  } catch {
    return "";
  }
  const i = t.subarray(0, o), a = (p, v) => i.toString("latin1", p, v);
  if (i[0] === 255 && i[1] === 216 && i[2] === 255) return ".jpg";
  if (i[0] === 137 && a(1, 4) === "PNG") return ".png";
  if (a(0, 4) === "GIF8") return ".gif";
  if (a(0, 4) === "RIFF" && a(8, 12) === "WEBP") return ".webp";
  if (a(4, 8) === "ftyp") {
    const p = a(8, 12);
    return /^(heic|heix|hevc|mif1|msf1)$/.test(p) ? ".heic" : p === "qt  " ? ".mov" : p.startsWith("3g") ? ".3gp" : p.startsWith("M4A") ? ".m4a" : ".mp4";
  }
  return a(0, 4) === "RIFF" && a(8, 12) === "WAVE" ? ".wav" : a(0, 4) === "RIFF" && a(8, 11) === "AVI" ? ".avi" : i[0] === 26 && i[1] === 69 && i[2] === 223 && i[3] === 163 ? ".mkv" : a(0, 3) === "ID3" || i[0] === 255 && (i[1] & 224) === 224 ? ".mp3" : a(0, 4) === "OggS" ? ".ogg" : a(0, 4) === "%PDF" ? ".pdf" : i[0] === 80 && i[1] === 75 && i[2] === 3 && i[3] === 4 ? ".zip" : "";
}
function le(e) {
  if (g.extname(
    e
  ))
    return e;
  const t = Te(
    e
  );
  if (!t)
    return e;
  const o = ce(
    e + t
  );
  try {
    return h.renameSync(
      e,
      o
    ), console.log(
      "🏷️ Extensión agregada:",
      g.basename(o)
    ), o;
  } catch {
    return e;
  }
}
function Ne() {
  try {
    for (const e of h.readdirSync(
      A
    )) {
      const t = g.join(
        A,
        e
      );
      h.statSync(t).isFile() && h.statSync(t).size > 0 && le(
        t
      );
    }
  } catch (e) {
    console.error(
      "No se pudieron revisar las descargas:",
      e
    );
  }
}
function q(e) {
  return e.replace(
    /[<>:"/\\|?*\x00-\x1F]/g,
    "_"
  ).trim() || `archivo-${Date.now()}`;
}
function Ae() {
  T || (T = fe.createServer(
    (e, t) => {
      var a, p, v, E, x;
      const o = ((a = e.socket.remoteAddress) == null ? void 0 : a.replace(
        /^::ffff:/,
        ""
      ).replace(
        /^.*:/,
        ""
      )) || "unknown";
      re(
        o
      );
      const i = ((p = e.socket.localAddress) == null ? void 0 : p.replace(
        /^::ffff:/,
        ""
      )) || M();
      if (e.method === "GET" && e.url === "/ping") {
        t.writeHead(
          200,
          {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
          }
        ), t.end(
          JSON.stringify({
            ok: !0,
            service: "LocalSend",
            alias: z,
            ip: i,
            port: D
          })
        );
        return;
      }
      if (e.method === "POST" && e.url === "/register") {
        let f = "";
        e.on(
          "data",
          (d) => {
            f += d.toString();
          }
        ), e.on(
          "end",
          () => {
            try {
              const d = JSON.parse(
                f
              ), c = {
                alias: d.alias || `Android-${o}`,
                ip: o,
                port: d.port ?? D,
                deviceType: "mobile",
                lastSeen: Date.now()
              }, s = N.has(
                o
              );
              N.set(
                o,
                c
              ), s || console.log(
                "📱 Nuevo dispositivo:",
                c.alias,
                o
              ), n == null || n.webContents.send(
                "device-found",
                c
              ), t.writeHead(
                200,
                {
                  "Content-Type": "application/json"
                }
              ), t.end(
                JSON.stringify({
                  ok: !0
                })
              );
            } catch {
              t.writeHead(
                400,
                {
                  "Content-Type": "application/json"
                }
              ), t.end(
                JSON.stringify({
                  ok: !1
                })
              );
            }
          }
        );
        return;
      }
      if (e.method === "GET" && e.url === "/devices") {
        se();
        const d = [
          {
            alias: z,
            ip: i,
            port: D,
            deviceType: "desktop"
          },
          ...N.values()
        ].filter(
          (c) => c.ip !== o
        ).filter(
          (c, s, m) => m.findIndex(
            (r) => r.alias === c.alias && r.deviceType === c.deviceType
          ) === s
        );
        t.writeHead(
          200,
          {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
          }
        ), t.end(
          JSON.stringify(
            d
          )
        );
        return;
      }
      if (e.method === "GET" && e.url === "/incoming") {
        const f = (k.get(
          o
        ) ?? []).map(
          (d) => ({
            id: d.id,
            fileName: d.fileName,
            fileSize: d.fileSize
          })
        );
        t.writeHead(
          200,
          {
            "Content-Type": "application/json"
          }
        ), t.end(
          JSON.stringify(
            f
          )
        );
        return;
      }
      if (e.method === "GET" && ((v = e.url) != null && v.startsWith(
        "/download/"
      ))) {
        const f = decodeURIComponent(
          e.url.substring(
            10
          )
        ), d = k.get(
          o
        ) ?? [], c = d.findIndex(
          (y) => y.id === f
        );
        if (c === -1) {
          t.writeHead(
            404,
            {
              "Content-Type": "application/json"
            }
          ), t.end(
            JSON.stringify({
              error: "Archivo no encontrado"
            })
          );
          return;
        }
        const s = d[c];
        if (!h.existsSync(
          s.filePath
        )) {
          d.splice(
            c,
            1
          ), t.writeHead(
            404
          ), t.end();
          return;
        }
        const m = /^bytes=(\d+)-$/.exec(
          String(
            e.headers.range ?? ""
          )
        ), r = m ? Number(m[1]) : 0;
        if (r >= s.fileSize && s.fileSize > 0) {
          t.writeHead(
            416,
            {
              "Content-Range": `bytes */${s.fileSize}`
            }
          ), t.end();
          return;
        }
        r > 0 && console.log(
          "⏯️ Reanudando",
          s.fileName,
          "desde el byte",
          r
        ), t.writeHead(
          r > 0 ? 206 : 200,
          {
            // Tipo: "bytes cualquiera" (octet-stream)
            "Content-Type": "application/octet-stream",
            // Cuántos bytes mandamos: solo lo que falta
            "Content-Length": s.fileSize - r,
            // Si reanuda, decimos qué parte mandamos:
            // "bytes desde-hasta/total"
            ...r > 0 ? {
              "Content-Range": `bytes ${r}-${s.fileSize - 1}/${s.fileSize}`
            } : {},
            // Le avisamos al celular que esta PC sabe
            // reanudar descargas
            "Accept-Ranges": "bytes",
            // Nombre del archivo (codificado para que
            // viaje bien con acentos y espacios)
            "Content-Disposition": `attachment; filename="${encodeURIComponent(s.fileName)}"`,
            // No guardar en caché
            "Cache-Control": "no-store"
          }
        );
        const l = h.createReadStream(
          s.filePath,
          {
            start: r,
            highWaterMark: 1024 * 1024
          }
        ), w = Q(
          "send",
          s.fileName,
          s.fileSize,
          o,
          r
        );
        let b = r, C = !1, O = !1;
        const R = (y) => {
          C || O || (O = !0, console.log(
            "⚠️ Envío interrumpido:",
            s.fileName,
            y
          ), w.fail(
            y,
            !0
          ), l.destroy());
        };
        t.setTimeout(
          H,
          () => {
            R(
              `Se perdió la conexión con el celular (sin actividad durante ${H / 1e3} s). El celular puede reanudar desde donde quedó.`
            ), t.destroy();
          }
        ), l.on(
          "data",
          (y) => {
            b += y.length, w.update(
              b
            );
          }
        ), l.on(
          "error",
          (y) => {
            console.error(
              "Error leyendo archivo:",
              y
            ), R(
              `No se pudo leer el archivo en la PC: ${y.message}`
            ), t.destroy();
          }
        ), t.on(
          "close",
          () => {
            !C && !t.writableFinished && R(
              `El celular se desconectó al ${s.fileSize > 0 ? Math.floor(b / s.fileSize * 100) : 0}%. Puede reanudar desde ese punto.`
            );
          }
        ), t.on(
          "finish",
          () => {
            C = !0, w.complete(
              b
            );
          }
        ), l.on(
          "close",
          () => {
            if (C) {
              const y = k.get(
                o
              );
              if (y) {
                const u = y.findIndex(
                  ($) => $.id === s.id
                );
                u !== -1 && y.splice(
                  u,
                  1
                );
              }
              try {
                new P({
                  title: "📤 Archivo enviado",
                  body: `${s.fileName} fue descargado por el celular.`
                }).show();
              } catch {
              }
            }
          }
        ), l.pipe(
          t
        );
        return;
      }
      if (e.method === "POST" && e.url === "/prepare-upload") {
        let f = "";
        e.on(
          "data",
          (d) => {
            f += d.toString();
          }
        ), e.on(
          "end",
          async () => {
            var b;
            let d;
            try {
              d = JSON.parse(
                f
              );
            } catch {
              t.writeHead(
                400,
                {
                  "Content-Type": "application/json"
                }
              ), t.end(
                JSON.stringify({
                  accepted: !1,
                  error: "Pedido inválido."
                })
              );
              return;
            }
            const c = Z(
              q(
                String(
                  d.fileName || `archivo-${Date.now()}`
                )
              ),
              typeof d.mimeType == "string" ? d.mimeType : void 0
            ), s = Number(
              d.size
            ) || 0, m = String(
              d.alias || ((b = N.get(o)) == null ? void 0 : b.alias) || o
            ), r = new AbortController();
            t.on(
              "close",
              () => {
                t.writableFinished || r.abort();
              }
            ), console.log(
              "❓ Pidiendo aceptación:",
              c,
              "de",
              m
            );
            let l;
            try {
              l = await we(
                c,
                s,
                m,
                r.signal
              );
            } catch (C) {
              console.error(
                "Diálogo de aceptación:",
                C
              ), l = "rejected";
            }
            if (console.log(
              "➡️ Respuesta:",
              l
            ), l === "cancelled")
              return;
            if (l !== "accepted") {
              const C = l === "timeout" ? `Nadie respondió en la PC durante ${ie / 1e3} s, así que el envío se canceló.` : "El usuario de la PC rechazó el archivo.";
              n == null || n.webContents.send(
                "transfer-error",
                {
                  direction: "receive",
                  fileName: c,
                  peer: o,
                  total: s,
                  bytes: 0,
                  progress: 0,
                  speed: 0,
                  eta: null,
                  message: l === "timeout" ? `No respondiste a tiempo: se canceló "${c}".` : `Rechazaste "${c}". Se le avisó al celular.`,
                  canRetry: !1,
                  rejected: !0
                }
              ), t.writeHead(
                403,
                {
                  "Content-Type": "application/json"
                }
              ), t.end(
                JSON.stringify({
                  accepted: !1,
                  error: C
                })
              );
              return;
            }
            const w = de();
            F.set(
              w,
              {
                ip: o,
                fileName: c,
                expiresAt: Date.now() + ye
              }
            ), t.writeHead(
              200,
              {
                "Content-Type": "application/json"
              }
            ), t.end(
              JSON.stringify({
                accepted: !0,
                token: w
              })
            );
          }
        );
        return;
      }
      if (e.method === "POST" && ((E = e.url) != null && E.startsWith(
        "/upload"
      ))) {
        const f = new URL(
          e.url,
          `http://${e.headers.host}`
        ), d = f.searchParams.get(
          "token"
        ) ?? "", c = F.get(
          d
        );
        if (F.delete(
          d
        ), !c || c.ip !== o || c.expiresAt < Date.now()) {
          console.log(
            "⛔ Subida sin autorización de",
            o
          ), t.writeHead(
            403,
            {
              "Content-Type": "application/json",
              Connection: "close"
            }
          ), t.end(
            JSON.stringify({
              ok: !1,
              error: "La PC no autorizó este envío. Volvé a enviarlo para que aparezca el pedido de aceptación."
            })
          ), e.resume();
          return;
        }
        const s = c.fileName, m = Z(
          q(
            s
          ),
          e.headers["content-type"]
        ), r = ce(
          g.join(
            A,
            m
          )
        ), l = Number(
          e.headers["content-length"] ?? f.searchParams.get(
            "size"
          ) ?? 0
        );
        console.log(
          "📥 Recibiendo:",
          m
        ), console.log(
          "📦 Tamaño esperado:",
          l
        );
        const w = h.createWriteStream(
          r,
          {
            // "w" = crear el archivo para escribir
            flags: "w",
            highWaterMark: 1024 * 1024
          }
        ), b = Q(
          "receive",
          m,
          l,
          o
        );
        let C = 0, O = !1, R = !1;
        const y = (u) => {
          O || R || (R = !0, console.log(
            "❌ Recepción interrumpida:",
            m,
            u
          ), b.fail(
            u,
            !1
          ), e.unpipe(
            w
          ), w.destroy(), h.unlink(
            r,
            () => {
            }
          ));
        };
        e.setTimeout(
          H,
          () => {
            y(
              `No llegaron datos durante ${H / 1e3} s: se perdió la conexión con el celular. Hay que reiniciar el envío desde el celular.`
            ), e.destroy();
          }
        ), e.on(
          "data",
          (u) => {
            C += u.length, b.update(
              C
            );
          }
        ), e.on(
          "close",
          () => {
            if (!e.complete) {
              const u = l > 0 ? Math.floor(C / l * 100) : 0;
              y(
                `La conexión con el celular se cortó al ${u}%. Hay que reiniciar el envío desde el celular.`
              );
            }
          }
        ), e.on(
          "error",
          (u) => {
            console.error(
              "❌ Error request:",
              u
            );
          }
        ), w.on(
          "error",
          (u) => {
            if (R)
              return;
            console.error(
              "❌ Error escribiendo:",
              u
            );
            const $ = u.code === "ENOSPC" ? "No hay espacio suficiente en el disco de la PC." : `No se pudo guardar el archivo en la PC (${u.message}).`;
            y(
              $
            ), e.unpipe(
              w
            ), e.resume();
            try {
              t.headersSent || (t.writeHead(
                500,
                {
                  "Content-Type": "application/json"
                }
              ), t.end(
                JSON.stringify({
                  ok: !1,
                  error: $
                })
              ));
            } catch {
            }
          }
        ), w.on(
          "finish",
          () => {
            if (O || R)
              return;
            O = !0;
            const u = h.statSync(
              r
            ).size;
            if (l > 0 && u !== l) {
              console.error(
                "❌ Tamaño incorrecto:",
                u,
                l
              );
              try {
                h.unlinkSync(
                  r
                );
              } catch {
              }
              b.fail(
                `El archivo llegó incompleto (${u} de ${l} bytes). Se descartó; hay que reiniciar el envío.`,
                !1
              ), t.writeHead(
                400,
                {
                  "Content-Type": "application/json"
                }
              ), t.end(
                JSON.stringify({
                  ok: !1,
                  error: "El tamaño del archivo recibido no coincide.",
                  received: u,
                  expected: l
                })
              );
              return;
            }
            const $ = le(
              r
            ), G = g.basename(
              $
            );
            console.log(
              "✅ Archivo recibido:",
              $
            ), console.log(
              "📦 Bytes:",
              u
            ), b.complete(
              u
            );
            try {
              new P({
                title: "📦 Archivo recibido",
                body: `${G} guardado en ${A}`
              }).show();
            } catch {
            }
            t.writeHead(
              200,
              {
                "Content-Type": "application/json"
              }
            ), t.end(
              JSON.stringify({
                ok: !0,
                fileName: G,
                size: u,
                path: $
              })
            );
          }
        ), e.pipe(
          w
        );
        return;
      }
      if (e.method === "POST" && ((x = e.url) != null && x.startsWith(
        "/discard/"
      ))) {
        const f = new URL(
          e.url,
          `http://${e.headers.host}`
        ), d = decodeURIComponent(
          f.pathname.substring(
            9
          )
        ), c = f.searchParams.get(
          "reason"
        ) === "rejected", s = k.get(
          o
        ) ?? [], m = s.findIndex(
          (r) => r.id === d
        );
        if (m !== -1) {
          const [r] = s.splice(
            m,
            1
          );
          if (n == null || n.webContents.send(
            "transfer-error",
            {
              direction: "send",
              fileName: r.fileName,
              peer: o,
              total: r.fileSize,
              bytes: 0,
              progress: 0,
              speed: 0,
              eta: null,
              message: c ? "El celular rechazó el archivo." : "El celular descartó el archivo después del error. Si querés, volvé a enviarlo.",
              canRetry: !1,
              rejected: c
            }
          ), c)
            try {
              new P({
                title: "🚫 Archivo rechazado",
                body: `El celular rechazó "${r.fileName}".`
              }).show();
            } catch {
            }
        }
        t.writeHead(
          200,
          {
            "Content-Type": "application/json"
          }
        ), t.end(
          JSON.stringify({
            ok: !0
          })
        );
        return;
      }
      t.writeHead(
        200,
        {
          "Content-Type": "text/plain"
        }
      ), t.end(
        "LocalSend TCP Node Active"
      );
    }
  ), T.on(
    "error",
    (e) => {
      console.error(
        "HTTP server error:",
        e
      );
    }
  ), T.requestTimeout = 0, T.timeout = 0, T.headersTimeout = 6e4, T.keepAliveTimeout = 5e3, T.listen(
    D,
    "0.0.0.0",
    () => {
      console.log(
        `🌐 HTTP activo en 0.0.0.0:${D}`
      ), console.log(
        `📁 Descargas: ${A}`
      ), _.tcp = !0, n == null || n.webContents.send(
        "server-status",
        _
      );
    }
  ));
}
function Ee() {
  L.listenerCount(
    "get-device-info"
  ) === 0 && L.handle(
    "get-device-info",
    () => ({
      alias: z,
      ip: M(),
      downloadDir: A
    })
  ), L.listenerCount(
    "send-file"
  ) === 0 && L.handle(
    "send-file",
    async (e, {
      filePath: t,
      targetIP: o
    }) => {
      try {
        if (!t || !o)
          return {
            ok: !1,
            error: "Faltan datos"
          };
        if (!h.existsSync(
          t
        ))
          return {
            ok: !1,
            error: "El archivo no existe"
          };
        const i = h.statSync(
          t
        );
        if (!i.isFile())
          return {
            ok: !1,
            error: "La ruta no es un archivo"
          };
        const a = g.basename(
          t
        ), p = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, v = k.get(
          o
        ) ?? [];
        return v.push({
          id: p,
          filePath: t,
          fileName: a,
          fileSize: i.size
        }), k.set(
          o,
          v
        ), console.log(
          "📤 Archivo puesto en cola:",
          a,
          "→",
          o
        ), n == null || n.webContents.send(
          "transfer-queued",
          {
            fileName: a,
            targetIP: o,
            fileSize: i.size
          }
        ), {
          ok: !0
        };
      } catch (i) {
        return console.error(
          "send-file:",
          i
        ), {
          ok: !1,
          error: "Error interno"
        };
      }
    }
  );
}
function ee() {
  n = new te({
    // Ancho inicial (en píxeles)
    width: 960,
    // Alto inicial
    height: 820,
    // Ancho mínimo
    minWidth: 520,
    // Alto mínimo
    minHeight: 600,
    // Título
    title: "LocalSend",
    // Oculta el menú "File / Edit / View" (en inglés)
    autoHideMenuBar: !0,
    // SEGURIDAD: si alguien lograra meter código
    // malicioso en la pantalla, no podría tocar tus
    // archivos.
    webPreferences: {
      // Archivo "puente" que le da a React solo las
      // funciones que necesita
      preload: g.join(
        oe,
        "preload.mjs"
      ),
      // React y Electron viven separados
      contextIsolation: !0,
      // React NO puede usar Node (ni el disco ni la red)
      nodeIntegration: !1
    }
  }), U ? n.loadURL(
    U
  ) : n.loadFile(
    g.join(
      ne,
      "index.html"
    )
  ), n.webContents.on(
    "did-finish-load",
    () => {
      n == null || n.webContents.send(
        "server-status",
        {
          ..._,
          ip: M(),
          port: D,
          alias: z
        }
      );
    }
  );
}
j.whenReady().then(
  () => {
    Ee(), Ne(), ee(), be(), Ae(), V = setInterval(
      se,
      1e3
    ), j.on(
      "activate",
      () => {
        te.getAllWindows().length === 0 && ee();
      }
    );
  }
);
j.on(
  "window-all-closed",
  () => {
    process.platform !== "darwin" && j.quit();
  }
);
j.on(
  "before-quit",
  () => {
    B && clearInterval(
      B
    ), V && clearInterval(
      V
    );
    try {
      S == null || S.close();
    } catch {
    }
    try {
      T == null || T.close();
    } catch {
    }
  }
);
export {
  ne as RENDERER_DIST,
  U as VITE_DEV_SERVER_URL
};
