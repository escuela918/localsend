# LocalSend (clon) — Escritorio + Móvil

Transferencia de archivos entre una PC y un celular en la misma red local, sin internet.

| Parte | Tecnología | Carpeta |
|---|---|---|
| App de escritorio | Electron + React (Vite) | `aplicacion-de-escritorio/` |
| App móvil | React Native (Expo) | `aplicacion-movil/` |

---

## 1. Instrucciones de red

### Requisitos
- La PC y el celular tienen que estar en la **misma red Wi-Fi** (misma subred, por ejemplo `192.168.0.x`).
- Si la red tiene **aislamiento de clientes** (algunas redes de facultad o de invitados), los dispositivos no se ven entre sí. En ese caso, usá el **hotspot del celular** y conectá la PC a esa red.

### Puertos usados
| Puerto | Protocolo | Para qué |
|---|---|---|
| **53317** | UDP | Descubrimiento (beacons por broadcast) |
| **53318** | TCP (HTTP) | Metadatos, handshake de aceptación y transferencia de archivos |

### Firewall de Windows
La primera vez que se abre la app, Windows pregunta si permite el acceso a la red. Hay que tildar **"Redes privadas"** y tocar **Permitir**.

Si se rechazó por error, se puede habilitar a mano desde PowerShell **como administrador**:
```powershell
netsh advfirewall firewall add rule name="LocalSend UDP" dir=in action=allow protocol=UDP localport=53317
netsh advfirewall firewall add rule name="LocalSend HTTP" dir=in action=allow protocol=TCP localport=53318
```
Además, la red Wi-Fi tiene que estar marcada como **Privada** (Configuración → Red e Internet → Wi-Fi → Tipo de perfil de red).

### Si no se encuentran automáticamente
En la app móvil está la opción **"Conectar a la PC manualmente"**: escribís la IP de la PC, que aparece arriba en la app de escritorio.

---

## 2. Cómo ejecutar y compilar

### Escritorio
```bash
cd aplicacion-de-escritorio
npm install
npm run dev      # desarrollo
npm run build    # genera release/1.0.0/LocalSend-Windows-1.0.0-Setup.exe
```
Los archivos recibidos se guardan en `Descargas/LocalSend`.

### Móvil
```bash
cd aplicacion-movil
npm install
npx expo run:android                                # en un celular conectado por USB (requiere Android SDK)
npx eas-cli build -p android --profile preview      # genera el .apk en la nube (requiere cuenta de Expo)
```
> La app usa `react-native-udp`, que es código nativo: **no funciona en Expo Go**. Hay que usar el `.apk` o un development build.

---

## 3. Arquitectura y protocolo

```
  CELULAR                                             PC (Electron, proceso main)
  ───────                                             ───────────────────────────
  Beacon UDP cada 1 s  ── 255.255.255.255:53317 ───▶  Lo agrega a la lista (TTL 5 s)
  Lo encuentra         ◀── broadcast cada 1 s ──────  Beacon UDP {deviceType: 'desktop'}
  POST /register cada 1 s (latido) ───────────────▶   Renueva lastSeen

  Celular → PC
  POST /prepare-upload {fileName, size}  (JSON) ──▶   Diálogo "Aceptar / Rechazar"  ⏸ await
                       ◀── 200 {token}  o  403 {error: "rechazado"}
  POST /upload?token=…  (cuerpo = bytes) ──────────▶  req.pipe(fs.createWriteStream)

  PC → Celular
  GET /incoming cada 2 s ─────────────────────────▶   Cola de archivos pendientes
  Alert "Aceptar / Rechazar" en el celular
     Rechazar → POST /discard/:id?reason=rejected ▶   La PC muestra "El celular lo rechazó"
     Aceptar  → GET /download/:id (Range) ────────▶   fs.createReadStream(...).pipe(res)
```

### Decisiones importantes
- **Descubrimiento:** UDP broadcast a `255.255.255.255` y al broadcast dirigido de cada placa (`IP | ~máscara`). Si una red bloquea UDP, el celular escanea la subred por HTTP (`/ping`) como respaldo.
- **TTL:** si un dispositivo pasa 5 s sin latidos, se borra de la lista. Así, al apagar y prender el Wi-Fi, la lista se actualiza sola.
- **HTTP en lugar de WebSocket:** los metadatos van como JSON en rutas propias y los datos binarios van en el cuerpo de `/upload` y `/download`. HTTP separa headers de body, y nos da `Content-Length` (integridad) y `Range` (reanudar).
- **Handshake:** `/prepare-upload` hace `await` sobre el diálogo. El token es de un solo uso y está atado a la IP del celular, así que nadie puede subir un archivo salteándose el diálogo.
- **Streams:** los archivos se leen y escriben de a 1 MB (`highWaterMark`) con `pipe()`, que maneja la backpressure. Un archivo de 10 GB nunca se carga entero en RAM.
- **Integridad:** se compara el tamaño exacto en bytes en los dos lados. Si no coincide, se descarta el archivo.
- **Nombres repetidos:** `foto.jpg` → `foto(1).jpg` en la PC y `foto (1).jpg` en el celular. Nunca se sobrescribe.
- **Cortes de red:** timeout de inactividad de 20 s. Las descargas PC→celular se reanudan con `Range` (respuesta 206).
- **Seguridad en Electron:** `contextIsolation: true` y `nodeIntegration: false`. React solo accede a las funciones expuestas en `preload.ts` con `contextBridge`.
