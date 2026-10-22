
// Traemos de Electron lo que necesitamos: app (la
// aplicación), BrowserWindow (la ventana), dialog
// (carteles), ipcMain (hablar con la pantalla) y
// Notification (avisos de Windows).
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Notification,
} from 'electron'

// randomUUID genera códigos al azar imposibles de adivinar.
// Los usamos como token (permiso de un solo uso).
import {
  randomUUID,
} from 'node:crypto'

// fileURLToPath convierte una dirección "file://..." en una
// ruta normal de Windows.
import {
  fileURLToPath,
} from 'node:url'

// path: armar rutas de carpetas sin preocuparse por las
// barras / o \.
import path from 'node:path'
// dgram: mandar y recibir mensajes UDP (para encontrar
// dispositivos).
import dgram from 'node:dgram'
// http: crear el servidor por donde viajan los archivos.
import http from 'node:http'
// fs (file system): leer, escribir, renombrar y borrar
// archivos del disco.
import fs from 'node:fs'
// os: datos de la computadora (nombre, carpeta del usuario,
// placas de red).
import os from 'node:os'


// ============================================================
// RUTAS DE LA APP
// ============================================================
//
// Acá calculamos en qué carpeta está la app y de dónde se
// carga la pantalla (React).
// En desarrollo (npm run dev) la pantalla viene de Vite
// (VITE_DEV_SERVER_URL). En el .exe viene de la carpeta
// "dist".

// __dirname = carpeta donde está este archivo. En los
// módulos modernos (ESM) no existe, así que la calculamos
// desde la URL del archivo (import.meta.url).
const __dirname =
  path.dirname(
    fileURLToPath(import.meta.url)
  )

// APP_ROOT = carpeta raíz de la app (una arriba de esta).
// La guardamos en las variables de entorno para usarla
// desde cualquier lado.
process.env.APP_ROOT =
  path.join(
    __dirname,
    '..'
  )

// Dirección del servidor de Vite. Solo existe cuando corrés
// "npm run dev"; en el .exe está vacía.
export const VITE_DEV_SERVER_URL =
  process.env['VITE_DEV_SERVER_URL']

// Carpeta "dist" donde queda la pantalla ya compilada (la
// que usa el .exe).
export const RENDERER_DIST =
  path.join(
    process.env.APP_ROOT!,
    'dist'
  )

// Carpeta de archivos públicos (íconos, imágenes): en
// desarrollo es "public" y en el .exe es "dist".
process.env.VITE_PUBLIC =
  VITE_DEV_SERVER_URL
    ? path.join(
        process.env.APP_ROOT!,
        'public'
      )
    : RENDERER_DIST


// ============================================================
// CONFIGURACIÓN (números que usa toda la app)
// ============================================================

// Puerto por donde los dispositivos se "gritan" para
// encontrarse (UDP). Es el mismo número que usa el
// LocalSend original.
const PUERTO_UDP =
  53317

// Puerto por donde viajan los archivos. Usamos HTTP (y no
// WebSocket) porque HTTP ya trae dos cosas que necesitamos:
// - Content-Length: el tamaño total, para comprobar que
//   el archivo llegó completo.
// - Range: pedir "mandame desde el byte X", para reanudar
//   una descarga cortada.
const PUERTO_HTTP =
  53318

// Nombre con el que la PC aparece en el celular. Ej:
// "Desktop-MI-PC".
const NOMBRE_DE_LA_PC =
  `Desktop-${os.hostname()}`

// Carpeta donde se guardan los archivos que llegan:
// Descargas/LocalSend (dentro de tu usuario).
const CARPETA_DESCARGAS =
  path.join(
    os.homedir(),
    'Downloads',
    'LocalSend'
  )

// Si un celular pasa 5 segundos sin dar señales de vida, lo
// sacamos de la lista (se apagó, se fue del Wi-Fi, etc.).
const TIEMPO_SIN_SENALES =
  5000

// Cada cuánto la PC avisa "acá estoy" a toda la red. Cada 1
// segundo: así el celular nos encuentra en menos de 5 s
// aunque se pierda algún aviso.
const CADA_CUANTO_AVISAR =
  1000

// Si durante 20 segundos no pasa ni un byte, damos la
// transferencia por cortada (por ejemplo, alguien apagó el
// Wi-Fi).
const TIEMPO_SIN_ACTIVIDAD =
  20000

// Cada cuánto actualizamos la barra de progreso en la
// pantalla (200 ms = 5 veces por segundo). Si la
// actualizáramos con cada pedacito del archivo serían miles
// de veces por segundo y la pantalla se trabaría.
const CADA_CUANTO_PROGRESO =
  200

// Tiempo que tiene el usuario de la PC para tocar Aceptar o
// Rechazar. Si no toca nada en 60 segundos, cuenta como
// rechazado.
const TIEMPO_PARA_ACEPTAR =
  60000

// Después de tocar Aceptar, el celular tiene 2 minutos para
// empezar a mandar el archivo con su "permiso" (token).
// Pasado ese tiempo, el permiso vence.
const DURACION_DEL_PERMISO =
  2 * 60 * 1000


// ============================================================
// VENTANA
// ============================================================
//
// La ventana de la app. Empieza en null (vacía) porque se
// crea recién cuando Electron está listo (ver crearVentana
// más abajo).

// ventana = la ventana de la app. Empieza en null (vacía)
// porque se crea recién cuando Electron está listo.
let ventana:
  BrowserWindow | null =
  null


// ============================================================
// SERVIDORES
// ============================================================
//
// Guardamos los dos servidores y los dos relojes
// (setInterval) en variables para poder apagarlos cuando se
// cierra la app.
// - servidorUDP: busca dispositivos en la red.
// - servidorHTTP: recibe y manda archivos.
// - relojDeLimpieza: cada 1 s borra celulares que se fueron.
// - relojDeAviso: cada 1 s avisa "acá estoy".

// Servidor UDP: busca dispositivos en la red. null =
// todavía no arrancó.
let servidorUDP:
  dgram.Socket | null =
  null

// Servidor HTTP: recibe y manda archivos.
let servidorHTTP:
  http.Server | null =
  null

// Reloj que cada 1 s borra los celulares que se fueron.
let relojDeLimpieza:
  NodeJS.Timeout | null =
  null

// Reloj que cada 1 s le avisa a la red "acá estoy".
let relojDeAviso:
  NodeJS.Timeout | null =
  null

// Anotamos si cada servidor ya arrancó (udp = buscar
// dispositivos, tcp = archivos). Los servidores pueden
// arrancar ANTES de que la pantalla termine de cargar;
// cuando carga, le mandamos este estado y el LED se pone
// verde.
const estadoServidores =
  {
    udp:
      false,
    tcp:
      false,
  }


// ============================================================
// CREAR CARPETA DE DESCARGAS
// ============================================================
//
// Si la carpeta Descargas/LocalSend no existe, la creamos.
// recursive: true crea también las carpetas de arriba si
// faltan.

// Si la carpeta Descargas/LocalSend NO existe...
if (
  !fs.existsSync(
    CARPETA_DESCARGAS
  )
) {

  // ...la creamos. recursive: true crea también las
  // carpetas de arriba si faltan.
  fs.mkdirSync(
    CARPETA_DESCARGAS,
    {
      recursive:
        true,
    }
  )

}


// ============================================================
// DISPOSITIVOS (celulares encontrados)
// ============================================================
//
// Lista de celulares encontrados. Usamos un Map (como un
// diccionario) con la IP como clave: si el mismo celular
// avisa 100 veces, sigue habiendo una sola entrada que se
// actualiza. Nunca hay repetidos.

// Ficha de cada celular encontrado:
interface Celular {

  // Nombre del celular (ej: Galaxy A54)
  alias: string

  // Su IP en la red
  ip: string

  // Puerto donde escucha
  port: number

  // Tipo: siempre "mobile" (celular)
  deviceType: 'mobile'

  // Hora (en milisegundos) de la última vez que dio señales
  // de vida
  lastSeen: number

}

// Lista de celulares encontrados. Map = diccionario con la
// IP como clave: si el mismo celular avisa 100 veces, sigue
// habiendo una sola entrada.
const celulares =
  new Map<
    string,
    Celular
  >()

// Celulares en medio de una transferencia (IP → cuántas
// tiene abiertas). Mientras se pasa un archivo el Wi-Fi va
// lleno y los avisos de "sigo vivo" pueden llegar tarde: a
// estos NO los borramos de la lista.
const celularesTransfiriendo =
  new Map<
    string,
    number
  >()

// Anota que un celular dio señales de vida justo ahora.
function marcarComoVisto(
  ip: string
) {

  // Buscamos el celular por su IP en la lista.
  const device =
    celulares.get(
      ip
    )

  // Si está en la lista...
  if (
    device
  ) {

    // ...actualizamos su "última vez visto" a ahora
    // (Date.now() = hora actual en milisegundos).
    device.lastSeen =
      Date.now()

  }

}


// ============================================================
// ARCHIVOS PENDIENTES (cola PC → celular)
// ============================================================
//
// Archivos que la PC quiere mandarle a un celular. El
// celular no tiene servidor, así que la PC no le puede
// "empujar" el archivo: lo deja anotado acá, en una cola
// por IP.
// El celular pregunta cada segundo "¿hay algo para mí?"
// (/incoming) y, cuando ve algo, lo descarga
// (/download/<id>).

// Ficha de un archivo que espera ser descargado por el
// celular:
interface ArchivoPendiente {

  // Código único para pedirlo (/download/<id>)
  id: string

  // Dónde está el archivo en la PC
  filePath: string

  // Nombre del archivo
  fileName: string

  // Tamaño en bytes
  fileSize: number

}

// Cola de archivos por celular: IP → lista de archivos que
// tiene para descargar.
const colaPorCelular =
  new Map<
    string,
    ArchivoPendiente[]
  >()


// ============================================================
// SUBIDAS ACEPTADAS (HANDSHAKE)
// ============================================================
//
// Handshake = "apretón de manos": antes de mandar el
// archivo, el celular pregunta si lo queremos.
// Cuando el usuario toca Aceptar, generamos un token: un
// código secreto que sirve UNA sola vez, como una entrada
// de cine. /upload solo guarda el archivo si el celular
// trae una entrada válida, de su misma IP y sin vencer. Así
// nadie puede mandar archivos sin pasar por el cartel de
// Aceptar.

// Ficha de un permiso (token) entregado:
interface PermisoDeSubida {

  // IP del celular que lo recibió (solo él lo puede usar)
  ip: string

  // Nombre del archivo que se aceptó
  fileName: string

  // Hora en que vence el permiso
  expiresAt: number

}

// Permisos entregados: token → ficha. Map para encontrarlos
// rápido por el token.
const permisosEntregados =
  new Map<
    string,
    PermisoDeSubida
  >()


// ============================================================
// DIÁLOGO DE ACEPTACIÓN
// ============================================================
//
// Muestra el cartel "X quiere enviarte un archivo" con
// Aceptar / Rechazar.
// Devuelve una Promesa: es como decir "te contesto cuando
// el usuario toque un botón". El servidor hace await de
// esta promesa, así que el envío queda FRENADO acá hasta
// que el usuario responde.
// Respuestas posibles:
// - accepted: aceptó.
// - rejected: rechazó.
// - timeout: no tocó nada en 60 s.
// - cancelled: el celular se desconectó mientras
//   esperábamos.

// Las 4 respuestas posibles del cartel: aceptó, rechazó, se
// acabó el tiempo o el celular se desconectó.
type RespuestaDelCartel =
  'accepted' | 'rejected' | 'timeout' | 'cancelled'

// Muestra el cartel y espera la respuesta. async = puede
// esperar (await) sin congelar la app. Devuelve una
// Promesa: "te contesto cuando el usuario toque un botón".
async function preguntarSiAcepta(
  // Nombre del archivo que quieren mandar
  fileName: string,
  // Tamaño en bytes
  fileSize: number,
  // Nombre del celular que lo manda
  nombreDelQueEnvia: string,
  // "Alarma" que suena si el celular se desconecta mientras
  // el cartel está abierto
  alarmaDeCancelacion: AbortSignal
): Promise<RespuestaDelCartel> {

  // Si la ventana existe, la traemos al frente para que el
  // usuario vea el pedido:
  if (
    ventana
  ) {

    // Si está minimizada...
    if (
      ventana.isMinimized()
    ) {
      // ...la volvemos a abrir.
      ventana.restore()
    }

    // La mostramos.
    ventana.show()

    // La ponemos adelante de todas las ventanas.
    ventana.focus()

    // Hacemos parpadear su ícono en la barra de tareas para
    // llamar la atención.
    ventana.flashFrame(
      true
    )

  }

  // Notificación de Windows (abajo a la derecha) con el
  // archivo y quién lo manda. Va en try/catch porque si las
  // notificaciones están desactivadas no queremos que se
  // rompa nada.
  try {

    new Notification({
      title:
        '📥 Archivo entrante',
      body:
        `${nombreDelQueEnvia} quiere enviarte "${fileName}"`,
    }).show()

  } catch {}

  // AbortController = un "botón de cancelar" que podemos
  // apretar desde el código para cerrar el cartel solo.
  const cancelador =
    new AbortController()

  // Motivo por el que se cerró el cartel. Si nadie lo
  // cambia: rechazado.
  let reason: RespuestaDelCartel =
    'rejected'

  // Reloj de 60 s: si se cumple, anotamos "timeout" y
  // cerramos el cartel.
  const reloj =
    setTimeout(
      () => {
        reason = 'timeout'
        cancelador.abort()
      },
      TIEMPO_PARA_ACEPTAR
    )

  // Qué hacer si el celular se desconecta: anotamos
  // "cancelled" y cerramos el cartel.
  const alCancelar =
    () => {
      reason = 'cancelled'
      cancelador.abort()
    }

  // Conectamos la "alarma" de desconexión con alCancelar.
  alarmaDeCancelacion.addEventListener(
    'abort',
    alCancelar
  )

  // Cómo es el cartel:
  const options: Electron.MessageBoxOptions =
    {
      // Ícono de pregunta
      type:
        'question',
      // Título de la ventanita
      title:
        'Archivo entrante',
      // Texto principal
      message:
        `${nombreDelQueEnvia} quiere enviarte un archivo`,
      // Texto chico: nombre, tamaño y dónde se va a guardar
      detail:
        `${fileName}\n${formatearTamano(fileSize)}\n\nSe guardará en ${CARPETA_DESCARGAS}`,
      // Botones: el 0 es Aceptar y el 1 es Rechazar
      buttons: [
        'Aceptar',
        'Rechazar',
      ],
      // Botón marcado por defecto (Enter = Aceptar)
      defaultId:
        0,
      // Botón que cuenta si cierran con Esc o la X
      // (Rechazar)
      cancelId:
        1,
      // Mostrar los botones como botones normales (en
      // Windows)
      noLink:
        true,
      // Conecta el cartel con el "botón de cancelar" para
      // cerrarlo desde el código
      signal:
        cancelador.signal,
    }

  try {

    // Mostramos el cartel y ESPERAMOS (await) a que se
    // cierre. response = número del botón tocado. Si la
    // ventana existe, el cartel aparece pegado a ella.
    const { response } =
      ventana
        ? await dialog.showMessageBox(ventana, options)
        : await dialog.showMessageBox(options)

    // Si el cartel se cerró solo (por tiempo o
    // desconexión), devolvemos ese motivo.
    if (
      cancelador.signal.aborted
    ) {
      return reason
    }

    // Si tocó el botón 0 (Aceptar) → "accepted"; si no →
    // "rejected".
    return response === 0
      ? 'accepted'
      : 'rejected'

  } finally {
  // finally = se ejecuta SIEMPRE al terminar, pase lo que
  // pase. Limpiamos:

    // Apagamos el reloj de 60 s
    clearTimeout(
      reloj
    )

    // Desconectamos la alarma
    alarmaDeCancelacion.removeEventListener(
      'abort',
      alCancelar
    )

    // Dejamos de hacer parpadear el ícono (ventana?. = solo si
    // la ventana existe)
    ventana?.flashFrame(
      false
    )

  }

}

// Convierte bytes a texto fácil de leer. Ej: 1536 → "1.5
// KB".
function formatearTamano(
  bytes: number
): string {

  // Si es 0, devolvemos "0 B".
  if (
    !bytes
  ) {
    return '0 B'
  }

  // Unidades posibles
  const units =
    ['B', 'KB', 'MB', 'GB', 'TB']

  // Cuántas veces hay que dividir por 1024 (con logaritmo).
  // Math.min evita pasarse de TB.
  const i =
    Math.min(
      units.length - 1,
      Math.floor(Math.log(bytes) / Math.log(1024))
    )

  // Dividimos y dejamos 1 decimal (ninguno si son bytes).
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`

}


// ============================================================
// IP LOCAL
// ============================================================
//
// Averigua la IP de esta PC en la red (ej: 192.168.0.10),
// que es la que el celular necesita para conectarse.

// Nombres de placas de red "de mentira" (VirtualBox, WSL,
// Docker, VPN...). No son tu Wi-Fi real. La /i del final =
// no importan mayúsculas o minúsculas.
const PLACA_VIRTUAL =
  /virtual|vmware|vbox|hyper-v|vethernet|wsl|docker|loopback|tailscale|zerotier|hamachi/i

// Ficha de una placa de red: nombre, IP y máscara.
interface PlacaDeRed {

  name: string

  address: string

  netmask: string

}

// Devuelve las placas de red que sirven (IPv4 y no
// internas), con las reales primero.
function obtenerPlacasDeRed(): PlacaDeRed[] {

  // Lista donde vamos juntando las placas que sirven.
  const result: PlacaDeRed[] =
    []

  // Recorremos cada placa de red de la PC
  // (os.networkInterfaces()). Cada placa puede tener varias
  // direcciones.
  for (
    const [
      name,
      infos
    ] of Object.entries(
      os.networkInterfaces()
    )
  ) {

    // Recorremos cada dirección de esa placa.
    for (
      const info of
        infos ?? []
    ) {

      // Nos quedamos con las IPv4 (formato 192.168.x.x) que
      // no sean internas (127.0.0.1 solo sirve para que la
      // PC se hable a sí misma).
      if (
        info.family === 'IPv4' &&
        !info.internal
      ) {

        // La agregamos a la lista.
        result.push({
          name,
          address:
            info.address,
          netmask:
            info.netmask,
        })

      }

    }

  }

  // Ordenamos: primero las placas reales y al final las
  // virtuales. test() da true/false y Number() lo pasa a
  // 1/0 para ordenar.
  return result.sort(
    (a, b) =>
      Number(PLACA_VIRTUAL.test(a.name)) -
      Number(PLACA_VIRTUAL.test(b.name))
  )

}

// La IP principal de la PC = la primera de la lista (la
// real).
function obtenerMiIP(): string {

  // Si no hay ninguna red (?? = "si no hay"), devolvemos
  // 127.0.0.1.
  return obtenerPlacasDeRed()[0]?.address ??
    '127.0.0.1'

}


// ============================================================
// DIRECCIONES DE BROADCAST
// ============================================================
//
// Broadcast = mandar un mensaje a TODOS los equipos de la
// red a la vez, como hablar por un megáfono.
// La dirección general es 255.255.255.255, pero en Windows
// a veces ese mensaje sale solo por una placa virtual (ej:
// VirtualBox) y el celular nunca lo escucha. Por eso
// también mandamos al "megáfono" propio de cada red. Se
// calcula con la IP y la máscara: 192.168.0.10 con máscara
// 255.255.255.0 → 192.168.0.255.

// Devuelve las direcciones de "megáfono" (broadcast) a las
// que mandamos el aviso.
function obtenerDireccionesBroadcast(): string[] {

  // Set = lista sin repetidos. Empieza con el megáfono
  // general 255.255.255.255.
  const addresses =
    new Set<string>([
      '255.255.255.255',
    ])

  // Para cada placa de red...
  for (
    const iface of
      obtenerPlacasDeRed()
  ) {

    // Partimos la IP en sus 4 números: "192.168.0.10" →
    // [192, 168, 0, 10].
    const ip =
      iface.address
        .split('.')
        .map(Number)

    // Lo mismo con la máscara: [255, 255, 255, 0].
    const mask =
      iface.netmask
        .split('.')
        .map(Number)

    // Calculamos el broadcast de esa red: cada número de la
    // IP | (OR) lo contrario de la máscara (~). Resultado:
    // 192.168.0.255.
    addresses.add(
      ip.map(
        (part, i) =>
          (part | (~mask[i] & 255))
      ).join('.')
    )

  }

  // Convertimos el Set en una lista normal.
  return [...addresses]

}


// ============================================================
// REPORTE DE PROGRESO
// ============================================================
//
// Crea un "reportero" para UNA transferencia. Tiene tres
// funciones:
// - update(): se llama con cada pedacito que entra o
//   sale; calcula %, velocidad (MB/s) y tiempo restante.
// - complete(): la transferencia terminó bien.
// - fail(): se cortó; avisa el motivo SIN borrar en qué %
//   quedó.
// A la pantalla (React) le manda datos como mucho cada 200
// ms.

// Sentido de la transferencia: "receive" (celular → PC) o
// "send" (PC → celular).
type Sentido =
  'receive' | 'send'

// Crea un "reportero" para UNA transferencia. Devuelve tres
// funciones: update, complete y fail.
function crearReportero(
  // Sentido
  direction: Sentido,
  // Nombre del archivo
  fileName: string,
  // Tamaño total en bytes
  total: number,
  // IP del celular
  peer: string,
  // Si es una descarga reanudada, desde qué byte arranca
  // (si no, 0)
  initialBytes = 0
) {

  // Hora en que empezó (para calcular la velocidad
  // promedio).
  const horaDeInicio =
    Date.now()

  // Marcamos al celular como "ocupado transfiriendo" (le
  // sumamos 1) para que no lo borren de la lista. ?? 0 = si
  // no tenía ninguna, cuenta desde 0.
  celularesTransfiriendo.set(
    peer,
    (celularesTransfiriendo.get(peer) ?? 0) + 1
  )

  // ¿Ya se ejecutó end()? (para no hacerlo dos veces)
  let yaTermino =
    false

  // end(): desmarca al celular como ocupado cuando la
  // transferencia termina (bien o mal).
  const end =
    () => {

      // Si ya se ejecutó, no hacemos nada.
      if (
        yaTermino
      ) {
        return
      }

      // Lo marcamos como ejecutado.
      yaTermino =
        true

      // Le restamos 1 a sus transferencias abiertas.
      const count =
        (celularesTransfiriendo.get(peer) ?? 1) - 1

      // Si no le quedan, lo sacamos de la lista de
      // ocupados; si le quedan, guardamos el número nuevo.
      if (
        count <= 0
      ) {
        celularesTransfiriendo.delete(peer)
      } else {
        celularesTransfiriendo.set(peer, count)
      }

      // Lo damos por visto ahora, para que no lo borren
      // justo al terminar.
      marcarComoVisto(
        peer
      )

    }

  // Última vez que le mandamos el progreso a la pantalla.
  let ultimoAviso =
    0

  // Bytes que llevábamos en la medición anterior.
  let bytesAnteriores =
    initialBytes

  // Hora de la medición anterior.
  let horaAnterior =
    horaDeInicio

  // Velocidad actual en bytes por segundo.
  let speed =
    0

  // Bytes transferidos hasta ahora.
  let bytes =
    initialBytes

  // Arma el paquete de datos que le mandamos a la pantalla.
  const payload =
    () => ({
      direction,
      fileName,
      peer,
      total,
      bytes,
      // Porcentaje: bytes / total × 100, redondeado para
      // abajo y sin pasar de 100.
      progress:
        total > 0
          ? Math.min(100, Math.floor((bytes / total) * 100))
          : 0,
      // Velocidad en bytes por segundo
      speed,
      // ETA = segundos que faltan = lo que falta /
      // velocidad. null si todavía no hay velocidad.
      eta:
        speed > 0 && total > 0
          ? Math.max(0, Math.round((total - bytes) / speed))
          : null,
    })

  // Devolvemos las tres funciones del reportero.
  return {

    // update(): se llama con cada pedacito (chunk) del
    // archivo.
    update(
      currentBytes: number
    ) {

      // Guardamos cuántos bytes van.
      bytes =
        currentBytes

      // Hora actual.
      const now =
        Date.now()

      // Si pasaron menos de 200 ms desde el último aviso,
      // no mandamos nada (si no, se traba la pantalla).
      if (
        now - ultimoAviso <
        CADA_CUANTO_PROGRESO
      ) {
        return
      }

      // Velocidad de este momento = bytes nuevos / tiempo
      // pasado (× 1000 porque el tiempo está en
      // milisegundos). Math.max(1, ...) evita dividir por
      // 0.
      const velocidadDelMomento =
        ((bytes - bytesAnteriores) * 1000) /
        Math.max(1, now - horaAnterior)

      // Velocidad "suavizada": 70 % la anterior + 30 % la
      // nueva, para que el número no salte. En la primera
      // medición usamos la del momento.
      speed =
        speed === 0
          ? velocidadDelMomento
          : speed * 0.7 + velocidadDelMomento * 0.3

      // Guardamos esta medición para la próxima.
      bytesAnteriores =
        bytes

      horaAnterior =
        now

      ultimoAviso =
        now

      // Le mandamos el progreso a la pantalla por el canal
      // "transfer-progress".
      ventana?.webContents.send(
        'transfer-progress',
        payload()
      )

    },

    // complete(): la transferencia terminó bien.
    complete(
      finalBytes: number
    ) {

      // Desmarcamos al celular como ocupado.
      end()

      // Bytes finales.
      bytes =
        finalBytes

      // Cuántos segundos duró (mínimo 0.001 para no dividir
      // por 0).
      const seconds =
        Math.max(0.001, (Date.now() - horaDeInicio) / 1000)

      // Velocidad promedio de toda la transferencia.
      speed =
        (finalBytes - initialBytes) / seconds

      // Avisamos a la pantalla por "transfer-complete" con
      // 100 %.
      ventana?.webContents.send(
        'transfer-complete',
        {
          ...payload(),
          total: total || finalBytes,
          progress: 100,
          eta: 0,
          size: finalBytes,
        }
      )

    },

    // fail(): se cortó. Avisa el motivo y en qué % quedó;
    // la barra NO se borra. canRetry = si se puede
    // reintentar.
    fail(
      message: string,
      canRetry: boolean
    ) {

      // Desmarcamos al celular como ocupado.
      end()

      // Avisamos a la pantalla por "transfer-error" con el
      // motivo (velocidad 0 y sin tiempo restante).
      ventana?.webContents.send(
        'transfer-error',
        {
          ...payload(),
          speed: 0,
          eta: null,
          message,
          canRetry,
        }
      )

      // Notificación de Windows: "Transferencia
      // interrumpida".
      try {

        new Notification({
          title:
            '❌ Transferencia interrumpida',
          body:
            `${fileName}: ${message}`,
        }).show()

      } catch {}

    },

  }

}


// ============================================================
// LIMPIAR DISPOSITIVOS VIEJOS
// ============================================================
//
// Corre cada 1 segundo. Borra de la lista a los celulares
// que hace más de 5 s no dan señales y se lo avisa a la
// pantalla ("device-removed").
// Gracias a esto, si apagás el Wi-Fi del celular desaparece
// de la lista, y cuando lo prendés vuelve a aparecer solo.

// Se ejecuta cada 1 s: borra los celulares que hace más de
// 5 s no dan señales.
function borrarCelularesInactivos() {

  // Hora actual.
  const now =
    Date.now()

  // Recorremos todos los celulares de la lista.
  for (
    const [
      ip,
      device
    ] of celulares
  ) {

    // Si está transfiriendo no lo borramos: lo damos por
    // visto ahora y pasamos al siguiente (continue).
    if (
      celularesTransfiriendo.has(
        ip
      )
    ) {

      device.lastSeen =
        now

      continue

    }

    // Si pasaron más de 5 s desde su última señal...
    if (
      now -
      device.lastSeen >
      TIEMPO_SIN_SENALES
    ) {

      // ...lo anotamos en la consola,
      console.log(
        '📴 Dispositivo desconectado:',
        device.alias,
        ip
      )

      // lo sacamos de la lista
      celulares.delete(
        ip
      )

      // y le avisamos a la pantalla ("device-removed") para
      // que desaparezca.
      ventana?.webContents.send(
        'device-removed',
        device
      )

    }

  }

}


// ============================================================
// DESCUBRIMIENTO POR UDP (encontrar celulares)
// ============================================================
//
// UDP es un protocolo "rápido y sin garantías": manda
// mensajes cortos sin conectarse antes, y alguno se puede
// perder. Es ideal para gritar "acá estoy" a toda la red.
// (Para los archivos usamos HTTP/TCP, que sí garantiza que
// llegue todo y en orden.)
// Esta función hace dos cosas:
// 1) ESCUCHA en el puerto 53317 los avisos de los
//    celulares.
// 2) Cada 1 s MANDA el aviso de la PC (beacon).

// Arranca el servidor UDP: escucha los avisos de los
// celulares y manda los de la PC.
function iniciarServidorUDP() {

  // Si ya está prendido, no lo prendemos otra vez.
  if (
    servidorUDP
  ) {

    return

  }

  // Creamos el "enchufe" (socket) UDP.
  servidorUDP =
    dgram.createSocket({
      // udp4 = usamos direcciones IPv4
      type:
        'udp4',
      // Si cerrás y abrís la app enseguida, Windows a veces
      // sigue teniendo el puerto "ocupado". Con esto lo
      // podemos usar igual.
      reuseAddr:
        true,
    })


  // Si hay un error en UDP, lo mostramos en la consola (la
  // app sigue andando).
  servidorUDP.on(
    'error',
    error => {

      console.error(
        'UDP error:',
        error
      )

    }
  )


  // Se ejecuta cada vez que llega un mensaje UDP. msg = el
  // contenido, rinfo = quién lo mandó (su IP).
  servidorUDP.on(
    'message',
    (
      msg,
      rinfo
    ) => {

      try {

        // Convertimos el mensaje (bytes) a texto, y el
        // texto JSON a objeto. Si no es JSON válido salta
        // al catch.
        const data =
          JSON.parse(
            msg.toString()
          )

        // Nuestra propia IP.
        const myIP =
          obtenerMiIP()

        // Si el mensaje lo mandamos nosotros mismos, lo
        // ignoramos.
        if (
          rinfo.address ===
          myIP
        ) {

          return

        }

        // Solo nos interesan los celulares que mandan su
        // nombre.
        if (
          data.deviceType ===
            'mobile' &&
          data.alias
        ) {

          // Ficha del celular: nombre, IP (la de quien
          // mandó el mensaje), puerto y hora actual.
          const device:
            Celular =
            {

              alias:
                data.alias,

              ip:
                rinfo.address,

              port:
                data.port ??
                PUERTO_HTTP,

              deviceType:
                'mobile',

              lastSeen:
                Date.now(),

            }

          // ¿Es la primera vez que lo vemos?
          const esNuevo =
            !celulares.has(
              rinfo.address
            )

          // Lo guardamos (o actualizamos) en la lista.
          celulares.set(
            rinfo.address,
            device
          )

          // Le avisamos a la pantalla para que lo muestre
          // ("device-found").
          ventana?.webContents.send(
            'device-found',
            device
          )

          // Si es nuevo, le mandamos el aviso de la PC
          // directo a SU IP (unicast = a uno solo). Así nos
          // encuentra al instante, sin esperar al próximo
          // aviso general.
          if (
            esNuevo
          ) {

            enviarAviso(
              rinfo.address
            )

          }

        }

      } catch {
      // Llegó algo que no es JSON (otro programa usando el
      // puerto). Lo ignoramos.

        // Llegó algo que no es JSON (otro programa usando
        // el puerto). Lo ignoramos.

      }

    }
  )


  // bind = "ocupar" el puerto 53317 para empezar a
  // escuchar.
  servidorUDP.bind(
    PUERTO_UDP,
    () => {

      try {

        // Habilitamos mandar mensajes a toda la red
        // (broadcast).
        servidorUDP?.setBroadcast(
          true
        )

      } catch {}

      // Avisamos en la consola que UDP está activo.
      console.log(
        `📡 UDP activo en ${PUERTO_UDP}`
      )

      // Anotamos que UDP arrancó...
      estadoServidores.udp =
        true

      // ...y se lo avisamos a la pantalla (para el LED).
      ventana?.webContents.send(
        'server-status',
        estadoServidores
      )

    }
  )


  // Cada 1 s (CADA_CUANTO_AVISAR) mandamos el aviso de la PC a
  // cada dirección de broadcast.
  relojDeAviso =
    setInterval(
      () => {

        for (
          const address of
            obtenerDireccionesBroadcast()
        ) {

          enviarAviso(
            address
          )

        }

      },
      CADA_CUANTO_AVISAR
    )

}


// ============================================================
// BEACON ("Soy un receptor activo")
// ============================================================
//
// Beacon = "faro". Es un mensajito JSON que dice: soy
// LocalSend, me llamo X, mi IP es Y, recibo archivos en el
// puerto 53318 y soy una PC (desktop).
// Buffer.from convierte el texto a bytes, que es lo que
// viaja por la red.

// Manda el aviso "acá estoy" de la PC a una dirección (a
// toda la red o a un celular).
function enviarAviso(
  address: string
) {

  // Si UDP no está prendido, no hacemos nada.
  if (
    !servidorUDP
  ) {

    return

  }

  // Armamos el aviso en JSON y lo pasamos a bytes (Buffer),
  // que es lo que viaja por la red.
  const beacon =
    Buffer.from(

      JSON.stringify({

        // Para que sepan que es LocalSend
        service:
          'LocalSend',

        // Nombre de la PC
        alias:
          NOMBRE_DE_LA_PC,

        // IP de la PC
        ip:
          obtenerMiIP(),

        // Puerto donde recibimos archivos (53318)
        port:
          PUERTO_HTTP,

        // Somos una PC
        deviceType:
          'desktop',

      })

    )

  try {

    // Lo mandamos: (datos, desde el byte 0, todos los
    // bytes, al puerto 53317, a esta dirección).
    servidorUDP.send(
      beacon,
      0,
      beacon.length,
      PUERTO_UDP,
      address
    )

  } catch {}

}


// ============================================================
// NOMBRE ÚNICO (no pisar archivos)
// ============================================================
//
// Si "foto.jpg" ya existe en Descargas, devuelve
// "foto(1).jpg"; si ese también existe, "foto(2).jpg", y
// así. Nunca se borra un archivo que ya tenías.

// Devuelve un nombre que todavía no exista, para no pisar
// archivos.
function rutaSinRepetir(
  filePath: string
): string {

  // Si no hay ningún archivo con ese nombre, lo usamos tal
  // cual.
  if (
    !fs.existsSync(
      filePath
    )
  ) {

    return filePath

  }

  // Extensión. Ej: ".jpg"
  const ext =
    path.extname(
      filePath
    )

  // Nombre sin extensión. Ej: "foto"
  const base =
    path.basename(
      filePath,
      ext
    )

  // Carpeta
  const dir =
    path.dirname(
      filePath
    )

  // Número que vamos a agregar, empezando por 1.
  let i =
    1

  // Primer intento: "foto(1).jpg".
  let candidate =
    path.join(
      dir,
      `${base}(${i})${ext}`
    )

  // Mientras ese nombre también exista, probamos con el
  // siguiente: foto(2), foto(3)...
  while (
    fs.existsSync(
      candidate
    )
  ) {

    i++

    candidate =
      path.join(
        dir,
        `${base}(${i})${ext}`
      )

  }

  // Devolvemos el primero que esté libre.
  return candidate

}


// ============================================================
// EXTENSIÓN SEGÚN EL TIPO (MIME)
// ============================================================
//
// MIME = el "tipo" de archivo que manda el celular. Ej:
// image/jpeg.
// Algunos celulares mandan el nombre sin extensión (ej:
// "image_1000211109"). Sin ".jpg" Windows no sabe con qué
// programa abrirlo, así que con esta tabla le agregamos la
// extensión según el tipo.

// Tabla: tipo de archivo (MIME) → extensión. Ej:
// "image/jpeg" → ".jpg".
const TIPO_A_EXTENSION: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'video/mp4': '.mp4',
  'video/3gpp': '.3gp',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/x-matroska': '.mkv',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  'text/plain': '.txt',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.android.package-archive': '.apk',
}

// Si al nombre le falta la extensión, se la agrega según el
// tipo (MIME).
function asegurarExtension(
  fileName: string,
  contentType: string | undefined
): string {

  // Si ya tiene extensión, lo devolvemos igual.
  if (
    path.extname(
      fileName
    )
  ) {
    return fileName
  }

  // Limpiamos el tipo: de "image/jpeg; charset=x" nos
  // quedamos con "image/jpeg", en minúsculas.
  const mime =
    (contentType ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase()

  // Buscamos la extensión en la tabla.
  const ext =
    TIPO_A_EXTENSION[mime]

  // Si la encontramos, la agregamos; si no, el nombre queda
  // igual.
  return ext
    ? fileName + ext
    : fileName

}


// ============================================================
// DETECTAR EL TIPO POR EL CONTENIDO ("magic numbers")
// ============================================================
//
// Plan B: si el archivo sigue sin extensión (el celular no
// mandó el tipo), miramos sus primeros bytes. Cada formato
// empieza con una "firma" fija, como un DNI: todo JPG
// empieza con FF D8 FF y todo PDF con las letras "%PDF".
// Solo leemos 32 bytes, no el archivo entero, así que es
// instantáneo aunque pese 2 GB.

// Adivina la extensión mirando los primeros 32 bytes del
// archivo (su "firma").
function detectarExtension(
  filePath: string
): string {

  // Espacio para 32 bytes.
  const header =
    Buffer.alloc(32)

  // Cuántos bytes se pudieron leer.
  let read =
    0

  try {

    // Abrimos el archivo para leer ("r"). fd = número que
    // identifica al archivo abierto.
    const fd =
      fs.openSync(
        filePath,
        'r'
      )

    // Leemos los primeros 32 bytes, desde el principio.
    read =
      fs.readSync(
        fd,
        header,
        0,
        32,
        0
      )

    // Cerramos el archivo.
    fs.closeSync(
      fd
    )

  } catch {
  // Si no se pudo leer, no adivinamos nada.

    return ''

  }

  // Nos quedamos solo con los bytes que se leyeron.
  const h =
    header.subarray(0, read)

  // ascii(a, b) = leer los bytes de la posición a hasta la
  // b como letras.
  const ascii =
    (start: number, end: number) =>
      h.toString('latin1', start, end)

  // JPG: empieza con los bytes FF D8 FF
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return '.jpg'
  // PNG: byte 89 + las letras "PNG"
  if (h[0] === 0x89 && ascii(1, 4) === 'PNG') return '.png'
  // GIF: empieza con "GIF8"
  if (ascii(0, 4) === 'GIF8') return '.gif'
  // WEBP: "RIFF" + "WEBP"
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return '.webp'

  // Videos y audio modernos tienen "ftyp" en la posición 4.
  // Los 4 bytes siguientes (la "marca") dicen cuál es:
  if (ascii(4, 8) === 'ftyp') {

    // Marca del formato
    const brand =
      ascii(8, 12)

    // HEIC (fotos de iPhone)
    if (/^(heic|heix|hevc|mif1|msf1)$/.test(brand)) return '.heic'
    // MOV (videos de iPhone)
    if (brand === 'qt  ') return '.mov'
    // 3GP (videos de celulares viejos)
    if (brand.startsWith('3g')) return '.3gp'
    // M4A (audio)
    if (brand.startsWith('M4A')) return '.m4a'
    // Si no es ninguno de esos, es MP4
    return '.mp4'

  }

  // WAV: "RIFF" + "WAVE"
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return '.wav'
  // AVI: "RIFF" + "AVI"
  if (ascii(0, 4) === 'RIFF' && ascii(8, 11) === 'AVI') return '.avi'
  // MKV: empieza con 1A 45 DF A3
  if (h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3) return '.mkv'
  // MP3: empieza con "ID3" o con FF Ex
  if (ascii(0, 3) === 'ID3' || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0)) return '.mp3'
  // OGG: empieza con "OggS"
  if (ascii(0, 4) === 'OggS') return '.ogg'

  // PDF: empieza con "%PDF"
  if (ascii(0, 4) === '%PDF') return '.pdf'
  // ZIP: empieza con "PK" (los .docx y .xlsx también son
  // ZIP por dentro)
  if (h[0] === 0x50 && h[1] === 0x4b && h[2] === 0x03 && h[3] === 0x04) return '.zip'

  // No lo reconocimos: lo dejamos sin extensión.
  return ''

}


// Si el archivo no tiene extensión, la adivina por el
// contenido y lo renombra. Devuelve la ruta final.
function arreglarExtension(
  filePath: string
): string {

  // Si ya tiene extensión, no hacemos nada.
  if (
    path.extname(
      filePath
    )
  ) {
    return filePath
  }

  // Adivinamos por el contenido.
  const ext =
    detectarExtension(
      filePath
    )

  // Si no lo reconocimos, lo dejamos igual.
  if (
    !ext
  ) {
    return filePath
  }

  // Nombre nuevo con la extensión (sin pisar otro archivo).
  const newPath =
    rutaSinRepetir(
      filePath + ext
    )

  try {

    // Renombramos el archivo.
    fs.renameSync(
      filePath,
      newPath
    )

    console.log(
      '🏷️ Extensión agregada:',
      path.basename(newPath)
    )

    return newPath

  } catch {

    return filePath

  }

}


// Al abrir la app revisa la carpeta de descargas y arregla
// los archivos viejos que hayan quedado sin extensión.
function arreglarDescargasViejas() {

  try {

    // Recorremos cada archivo de la carpeta de descargas.
    for (
      const name of
        fs.readdirSync(
          CARPETA_DESCARGAS
        )
    ) {

      // Ruta completa del archivo.
      const fullPath =
        path.join(
          CARPETA_DESCARGAS,
          name
        )

      // Si es un archivo (no una carpeta) y no está vacío,
      // le arreglamos la extensión.
      if (
        fs.statSync(fullPath).isFile() &&
        fs.statSync(fullPath).size > 0
      ) {

        arreglarExtension(
          fullPath
        )

      }

    }

  } catch (error) {

    console.error(
      'No se pudieron revisar las descargas:',
      error
    )

  }

}


// ============================================================
// LIMPIAR EL NOMBRE DEL ARCHIVO
// ============================================================
//
// Reemplaza por "_" los caracteres que Windows no permite
// en un nombre ( < > : " / \ | ? * ) y los caracteres
// invisibles.
// Como también saca las barras, evita trucos como
// "../../Windows/archivo" para escribir fuera de la carpeta
// de descargas. Si el nombre queda vacío, inventa uno:
// "archivo-<número>".

// Limpia el nombre: cambia por "_" los caracteres
// prohibidos en Windows ( < > : " / \ | ? * ) y los
// invisibles. trim() saca espacios del principio y del
// final. Si queda vacío, inventa "archivo-<número>".
function limpiarNombre(
  name: string
): string {

  return name
    .replace(
      /[<>:"/\\|?*\x00-\x1F]/g,
      '_'
    )
    .trim() ||
    `archivo-${Date.now()}`

}


// ============================================================
// SERVIDOR HTTP (por acá viajan los archivos)
// ============================================================
//
// Escucha en el puerto 53318. El celular le hace "pedidos"
// (requests) a direcciones como /ping, /upload o /download.
// Cada bloque "if" de abajo atiende una dirección distinta,
// como las ventanillas de un banco.
// req = lo que pide el celular, res = lo que le
// respondemos.
// Códigos de respuesta: 200 = OK, 206 = parte del archivo,
// 400 = pedido mal hecho, 403 = prohibido, 404 = no existe,
// 500 = error en la PC.

// Arranca el servidor HTTP en el puerto 53318.
function iniciarServidorHTTP() {

  // Si ya está prendido, no lo prendemos otra vez.
  if (
    servidorHTTP
  ) {

    return

  }


  // Creamos el servidor. La función de adentro se ejecuta
  // CADA VEZ que llega un pedido: req = el pedido, res =
  // nuestra respuesta.
  servidorHTTP =
    http.createServer(
      (
        req,
        res
      ) => {

        // IP del celular que hizo el pedido. Le sacamos el
        // prefijo "::ffff:" que agrega Node cuando la IP
        // viene en formato IPv6.
        const ipDelCelular =
          req.socket.remoteAddress
            ?.replace(
              /^::ffff:/,
              ''
            )
            .replace(
              /^.*:/,
              ''
            ) ||
          'unknown'


        // Si el celular nos habla, está vivo: actualizamos
        // su "última vez visto".
        marcarComoVisto(
          ipDelCelular
        )


        // IP de la PC por la que llegó el pedido. Es la
        // correcta aunque la PC tenga varias placas de red
        // (hotspot, VPN, VirtualBox...).
        const ipDeLaPC =
          req.socket.localAddress
            ?.replace(
              /^::ffff:/,
              ''
            ) ||
          obtenerMiIP()


        // ====================================================
        // PING ("¿estás ahí?")
        // ====================================================
        //
        // El celular pregunta si la PC existe y respondemos
        // con nuestros datos (nombre, IP, puerto).
        // Cache-Control: no-store = que no guarde la
        // respuesta; queremos la respuesta real cada vez.

        // GET /ping: el celular pregunta "¿estás ahí?".
        if (
          req.method ===
            'GET' &&
          req.url ===
            '/ping'
        ) {

          // Respondemos 200 (OK), en formato JSON y sin
          // guardar en caché (no-store).
          res.writeHead(
            200,
            {
              'Content-Type':
                'application/json',
              'Cache-Control':
                'no-store',
            }
          )

          // Mandamos nuestros datos (nombre, IP, puerto) y
          // cerramos la respuesta.
          res.end(
            JSON.stringify({

              ok:
                true,

              service:
                'LocalSend',

              alias:
                NOMBRE_DE_LA_PC,

              ip:
                ipDeLaPC,

              port:
                PUERTO_HTTP,

            })
          )

          // return = terminamos acá; no seguimos revisando
          // las otras direcciones.
          return

        }


        // ====================================================
        // REGISTER (el celular se presenta)
        // ====================================================
        //
        // El celular dice "hola, soy el Galaxy A54". El
        // cuerpo del pedido llega por partes: las juntamos
        // con el evento "data" y cuando terminó de llegar
        // (evento "end") lo convertimos de JSON y lo
        // guardamos en la lista.

        // POST /register: el celular se presenta ("hola,
        // soy el Galaxy A54").
        if (
          req.method ===
            'POST' &&
          req.url ===
            '/register'
        ) {

          // Acá vamos juntando el texto que manda el
          // celular.
          let body =
            ''

          // El cuerpo llega por partes (chunks): las vamos
          // sumando.
          req.on(
            'data',
            chunk => {

              body +=
                chunk.toString()

            }
          )

          // Cuando terminó de llegar todo:
          req.on(
            'end',
            () => {

              try {

                // Convertimos el texto JSON a objeto.
                const data =
                  JSON.parse(
                    body
                  )

                // Ficha del celular. Si no mandó nombre,
                // usamos "Android-<IP>".
                const device:
                  Celular =
                  {

                    alias:
                      data.alias ||
                      `Android-${ipDelCelular}`,

                    ip:
                      ipDelCelular,

                    port:
                      data.port ??
                      PUERTO_HTTP,

                    deviceType:
                      'mobile',

                    lastSeen:
                      Date.now(),

                  }

                // ¿Ya lo conocíamos?
                const yaExistia =
                  celulares.has(
                    ipDelCelular
                  )

                // Lo guardamos o actualizamos.
                celulares.set(
                  ipDelCelular,
                  device
                )

                // Si es nuevo, lo anotamos en la consola.
                if (
                  !yaExistia
                ) {

                  console.log(
                    '📱 Nuevo dispositivo:',
                    device.alias,
                    ipDelCelular
                  )

                }

                // Avisamos a la pantalla ("device-found").
                ventana?.webContents.send(
                  'device-found',
                  device
                )

                // Respondemos OK.
                res.writeHead(
                  200,
                  {
                    'Content-Type':
                      'application/json',
                  }
                )

                res.end(
                  JSON.stringify({
                    ok:
                      true,
                  })
                )

              } catch {
              // Si el JSON vino mal, respondemos 400
              // (pedido mal hecho).

                res.writeHead(
                  400,
                  {
                    'Content-Type':
                      'application/json',
                  }
                )

                res.end(
                  JSON.stringify({
                    ok:
                      false,
                  })
                )

              }

            }
          )

          return

        }


        // ====================================================
        // DEVICES (lista de dispositivos)
        // ====================================================
        //
        // Devuelve la PC + los celulares, sin incluir al
        // que pregunta (no tiene sentido que se vea a sí
        // mismo). borrarCelularesInactivos() primero saca a los que ya
        // se fueron.

        // GET /devices: el celular pide la lista de
        // dispositivos.
        if (
          req.method ===
            'GET' &&
          req.url ===
            '/devices'
        ) {

          // Primero sacamos a los que ya se fueron.
          borrarCelularesInactivos()

          // La PC misma, como un dispositivo más de la
          // lista.
          const laPC =
            {

              alias:
                NOMBRE_DE_LA_PC,

              ip:
                ipDeLaPC,

              port:
                PUERTO_HTTP,

              deviceType:
                'desktop' as const,

            }


          // Lista = la PC + todos los celulares, sin el que
          // pregunta (filter = quedarse solo con los que
          // cumplen la condición).
          const list =
            [
              laPC,
              ...celulares.values(),
            ].filter(
              device =>
                device.ip !==
                ipDelCelular
            )
            // Quitamos repetidos por nombre: si no, el
            // mismo celular se vería dos veces (con la IP
            // del aviso UDP y con la de /register).
            .filter(
              (device, index, all) =>
                all.findIndex(
                  other =>
                    other.alias === device.alias &&
                    other.deviceType === device.deviceType
                ) === index
            )


          // Respondemos 200 con la lista en JSON.
          res.writeHead(
            200,
            {
              'Content-Type':
                'application/json',
              'Cache-Control':
                'no-store',
            }
          )

          res.end(
            JSON.stringify(
              list
            )
          )

          return

        }


        // ====================================================
        // INCOMING ("¿hay archivos para mí?")
        // ====================================================
        //
        // El celular pregunta esto cada segundo. Le
        // devolvemos SU cola de archivos pendientes (solo
        // id, nombre y tamaño; la ruta del disco de la PC
        // no se la mostramos).

        // GET /incoming: el celular pregunta cada segundo
        // "¿hay archivos para mí?".
        if (
          req.method ===
            'GET' &&
          req.url ===
            '/incoming'
        ) {

          // Tomamos SU cola (por su IP) y de cada archivo
          // mandamos solo id, nombre y tamaño (map =
          // transformar cada elemento). La ruta del disco
          // no se la mostramos.
          const list =
            (
              colaPorCelular.get(
                ipDelCelular
              ) ?? []
            ).map(
              file => ({

                id:
                  file.id,

                fileName:
                  file.fileName,

                fileSize:
                  file.fileSize,

              })
            )

          // Respondemos 200 con la lista en JSON.
          res.writeHead(
            200,
            {
              'Content-Type':
                'application/json',
            }
          )

          res.end(
            JSON.stringify(
              list
            )
          )

          return

        }


        // ====================================================
        // DESCARGA (PC → celular)
        // ====================================================
        //
        // El celular pide /download/<id> de un archivo que
        // vio en /incoming. Lo buscamos en SU cola; si no
        // está, o si se borró del disco, respondemos 404
        // (no existe).

        // GET /download/<id>: el celular descarga un
        // archivo de su cola (PC → celular).
        if (
          req.method ===
            'GET' &&
          req.url?.startsWith(
            '/download/'
          )
        ) {

          // Sacamos el id de la dirección (lo que viene
          // después de "/download/").
          const id =
            decodeURIComponent(
              req.url.substring(
                '/download/'.length
              )
            )


          // Su cola de archivos.
          const list =
            colaPorCelular.get(
              ipDelCelular
            ) ?? []


          // Buscamos la posición del archivo con ese id (-1
          // = no está).
          const index =
            list.findIndex(
              file =>
                file.id === id
            )


          // Si no está en la cola → 404 (no encontrado).
          if (
            index === -1
          ) {

            res.writeHead(
              404,
              {
                'Content-Type':
                  'application/json',
              }
            )

            res.end(
              JSON.stringify({
                error:
                  'Archivo no encontrado',
              })
            )

            return

          }


          // El archivo encontrado.
          const file =
            list[index]


          // Si el archivo se borró de la PC, lo sacamos de
          // la cola (splice) y respondemos 404.
          if (
            !fs.existsSync(
              file.filePath
            )
          ) {

            list.splice(
              index,
              1
            )

            res.writeHead(
              404
            )

            res.end()

            return

          }


          // ==================================================
          // REANUDACIÓN (HTTP Range)
          // ==================================================
          //
          // Si una descarga se cortó al 60 %, el celular no
          // empieza de cero: pide "Range: bytes=300000000-"
          // ("mandame desde el byte 300.000.000"). Le
          // mandamos SOLO lo que falta con el código 206
          // (contenido parcial). Si no pide Range, mandamos
          // todo con 200 (OK).

          // Si una descarga se cortó, el celular no empieza
          // de cero: pide "Range: bytes=300000000-"
          // ("mandame desde el byte 300.000.000"). Sacamos
          // ese número con una expresión regular.
          const pedidoDeRango =
            /^bytes=(\d+)-$/.exec(
              String(
                req.headers.range ?? ''
              )
            )

          // Desde qué byte mandamos: el número de Range, o
          // 0 si no lo pidió.
          const start =
            pedidoDeRango
              ? Number(pedidoDeRango[1])
              : 0


          // Pidió desde un byte que no existe (más allá del
          // final) → 416 = "rango inválido".
          if (
            start >= file.fileSize &&
            file.fileSize > 0
          ) {

            res.writeHead(
              416,
              {
                'Content-Range':
                  `bytes */${file.fileSize}`,
              }
            )

            res.end()

            return

          }


          // Si es una reanudación, lo anotamos en la
          // consola.
          if (
            start > 0
          ) {

            console.log(
              '⏯️ Reanudando',
              file.fileName,
              'desde el byte',
              start
            )

          }


          // Encabezados de la respuesta. Código 206 (una
          // parte) si reanuda, 200 (completo) si no.
          res.writeHead(
            start > 0
              ? 206
              : 200,
            {

              // Tipo: "bytes cualquiera" (octet-stream)
              'Content-Type':
                'application/octet-stream',

              // Cuántos bytes mandamos: solo lo que falta
              'Content-Length':
                file.fileSize - start,

              // Si reanuda, decimos qué parte mandamos:
              // "bytes desde-hasta/total"
              ...(start > 0
                ? {
                    'Content-Range':
                      `bytes ${start}-${file.fileSize - 1}/${file.fileSize}`,
                  }
                : {}),

              // Le avisamos al celular que esta PC sabe
              // reanudar descargas
              'Accept-Ranges':
                'bytes',

              // Nombre del archivo (codificado para que
              // viaje bien con acentos y espacios)
              'Content-Disposition':
                `attachment; filename="${encodeURIComponent(file.fileName)}"`,

              // No guardar en caché
              'Cache-Control':
                'no-store',

            }
          )


          // STREAM = leer el archivo de a pedacitos de 1 MB
          // (highWaterMark), como tomar agua con una pajita
          // en vez de tragarse la botella. Nunca está
          // entero en la RAM: por eso funciona igual con
          // 500 MB que con 10 GB. "start" = empieza a leer
          // desde donde se había cortado.
          const lectorDelArchivo =
            fs.createReadStream(
              file.filePath,
              {
                start,
                highWaterMark:
                  1024 * 1024,
              }
            )


          // Reportero de progreso para este envío ("send"),
          // arrancando desde "start".
          const reportero =
            crearReportero(
              'send',
              file.fileName,
              file.fileSize,
              ipDelCelular,
              start
            )


          // Bytes mandados. Empieza en "start" para que el
          // % siga desde donde había quedado.
          let bytesEnviados =
            start

          // ¿Terminó bien?
          let completed =
            false

          // ¿Falló?
          let failed =
            false


          // fail: se cortó el envío. Se ejecuta una sola
          // vez (por eso revisamos completed y failed).
          const fail =
            (
              message: string
            ) => {

              if (
                completed ||
                failed
              ) {
                return
              }

              failed =
                true

              console.log(
                '⚠️ Envío interrumpido:',
                file.fileName,
                message
              )

              // Avisamos a la pantalla. El archivo NO se
              // saca de la cola: el celular puede volver a
              // pedirlo (Reintentar) y seguir desde donde
              // quedó.
              reportero.fail(
                message,
                true
              )

              // Dejamos de leer el archivo.
              lectorDelArchivo.destroy()

            }


          // Si se apaga el Wi-Fi, la conexión no siempre
          // avisa: queda "colgada" para siempre. Si pasan
          // 20 s sin actividad, damos el envío por cortado.
          res.setTimeout(
            TIEMPO_SIN_ACTIVIDAD,
            () => {

              fail(
                `Se perdió la conexión con el celular (sin actividad durante ${TIEMPO_SIN_ACTIVIDAD / 1000} s). El celular puede reanudar desde donde quedó.`
              )

              res.destroy()

            }
          )


          // Cada pedacito que sale: sumamos los bytes y
          // actualizamos la barra.
          lectorDelArchivo.on(
            'data',
            chunk => {

              bytesEnviados +=
                chunk.length

              reportero.update(
                bytesEnviados
              )

            }
          )


          // No se pudo leer el archivo del disco de la PC.
          lectorDelArchivo.on(
            'error',
            error => {

              console.error(
                'Error leyendo archivo:',
                error
              )

              fail(
                `No se pudo leer el archivo en la PC: ${error.message}`
              )

              res.destroy()

            }
          )


          // "close" antes de terminar = el celular se
          // desconectó a mitad de camino.
          res.on(
            'close',
            () => {

              if (
                !completed &&
                !res.writableFinished
              ) {

                fail(
                  `El celular se desconectó al ${file.fileSize > 0 ? Math.floor((bytesEnviados / file.fileSize) * 100) : 0}%. Puede reanudar desde ese punto.`
                )

              }

            }
          )


          // "finish" = se mandó todo bien.
          res.on(
            'finish',
            () => {

              completed =
                true

              reportero.complete(
                bytesEnviados
              )

            }
          )


          // Cuando se cierra el archivo:
          lectorDelArchivo.on(
            'close',
            () => {

              if (
                completed
              ) {

                // Si terminó bien, buscamos su cola
                // actual...
                const current =
                  colaPorCelular.get(
                    ipDelCelular
                  )

                if (
                  current
                ) {

                  // ...la posición del archivo en la
                  // cola...
                  const currentIndex =
                    current.findIndex(
                      item =>
                        item.id ===
                        file.id
                    )

                  if (
                    currentIndex !==
                    -1
                  ) {

                    // ...y lo sacamos (splice = borrar de
                    // una lista): ya no está pendiente.
                    current.splice(
                      currentIndex,
                      1
                    )

                  }

                }


                // Notificación de Windows: "Archivo
                // enviado".
                try {

                  new Notification({

                    title:
                      '📤 Archivo enviado',

                    body:
                      `${file.fileName} fue descargado por el celular.`,

                  }).show()

                } catch {}

              }

            }
          )


          // pipe = "conectar la manguera": lo que se lee
          // del disco va directo al celular. Si el Wi-Fi va
          // lento, Node deja de leer el disco hasta que se
          // libere (backpressure).
          lectorDelArchivo.pipe(
            res
          )

          return

        }


        // ====================================================
        // PREPARAR SUBIDA (pedir permiso antes de mandar)
        // ====================================================
        //
        // Paso a paso:
        // 1) El celular manda SOLO los datos del archivo
        //    (nombre, tamaño, tipo), no el archivo.
        // 2) Mostramos el cartel Aceptar / Rechazar y
        //    ESPERAMOS (await) la respuesta.
        // 3) Si acepta → respondemos 200 + un token
        //    (permiso de un solo uso). Si rechaza →
        //    respondemos 403 ("prohibido") + el motivo, que
        //    el celular le muestra al usuario.
        // Recién con el token el celular manda los bytes a
        // /upload. Así no se suben 500 MB para que después
        // los rechacen.

        // POST /prepare-upload: el celular pide permiso
        // para mandar un archivo.
        if (
          req.method ===
            'POST' &&
          req.url ===
            '/prepare-upload'
        ) {

          // Juntamos el texto que manda.
          let body =
            ''

          // Llega por partes: las sumamos.
          req.on(
            'data',
            chunk => {

              body +=
                chunk.toString()

            }
          )

          // Cuando llegó todo (async porque adentro vamos a
          // esperar el cartel):
          req.on(
            'end',
            async () => {

              // Datos del archivo (nombre, tamaño, tipo).
              let data: any

              try {

                // Convertimos el JSON a objeto.
                data =
                  JSON.parse(
                    body
                  )

              } catch {
              // Si vino mal → 400 "Pedido inválido".

                res.writeHead(
                  400,
                  {
                    'Content-Type':
                      'application/json',
                  }
                )

                res.end(
                  JSON.stringify({
                    accepted:
                      false,
                    error:
                      'Pedido inválido.',
                  })
                )

                return

              }

              // Limpiamos el nombre y le agregamos la
              // extensión según el tipo, si le falta.
              const fileName =
                asegurarExtension(
                  limpiarNombre(
                    String(
                      data.fileName ||
                      `archivo-${Date.now()}`
                    )
                  ),
                  typeof data.mimeType === 'string'
                    ? data.mimeType
                    : undefined
                )

              // Tamaño (si no vino, 0).
              const fileSize =
                Number(
                  data.size
                ) || 0

              // Nombre de quien lo manda: el que vino en el
              // pedido, el de la lista o, si no hay, su IP.
              const nombreDelQueEnvia =
                String(
                  data.alias ||
                  celulares.get(ipDelCelular)?.alias ||
                  ipDelCelular
                )

              // "Alarma" para cerrar el cartel si el
              // celular se desconecta mientras esperamos.
              const alarmaDeDesconexion =
                new AbortController()

              // Si la conexión se cierra antes de que
              // respondamos, hacemos sonar la alarma
              // (abort).
              res.on(
                'close',
                () => {

                  if (
                    !res.writableFinished
                  ) {
                    alarmaDeDesconexion.abort()
                  }

                }
              )

              console.log(
                '❓ Pidiendo aceptación:',
                fileName,
                'de',
                nombreDelQueEnvia
              )

              // Acá va a quedar la respuesta del usuario.
              let respuesta: RespuestaDelCartel

              try {

                // Mostramos el cartel. ACÁ se frena todo
                // hasta que el usuario toca un botón.
                respuesta =
                  await preguntarSiAcepta(
                    fileName,
                    fileSize,
                    nombreDelQueEnvia,
                    alarmaDeDesconexion.signal
                  )

              } catch (
                // Si el cartel falla, lo contamos como
                // rechazo.
                error
              ) {

                console.error(
                  'Diálogo de aceptación:',
                  error
                )

                respuesta =
                  'rejected'

              }

              console.log(
                '➡️ Respuesta:',
                respuesta
              )

              // Si el celular ya se fue, no hay a quién
              // responderle.
              if (
                respuesta === 'cancelled'
              ) {

                // El celular ya se fue: no hay a quién
                // responderle.
                return

              }

              // Si NO aceptó (rechazó o se acabó el
              // tiempo):
              if (
                respuesta !== 'accepted'
              ) {

                // Mensaje para el celular según el motivo.
                const reason =
                  respuesta === 'timeout'
                    ? `Nadie respondió en la PC durante ${TIEMPO_PARA_ACEPTAR / 1000} s, así que el envío se canceló.`
                    : 'El usuario de la PC rechazó el archivo.'

                // También lo mostramos en la pantalla de la
                // PC (rejected: true muestra el 🚫).
                ventana?.webContents.send(
                  'transfer-error',
                  {
                    direction:
                      'receive',
                    fileName,
                    peer:
                      ipDelCelular,
                    total:
                      fileSize,
                    bytes:
                      0,
                    progress:
                      0,
                    speed:
                      0,
                    eta:
                      null,
                    message:
                      respuesta === 'timeout'
                        ? `No respondiste a tiempo: se canceló "${fileName}".`
                        : `Rechazaste "${fileName}". Se le avisó al celular.`,
                    canRetry:
                      false,
                    rejected:
                      true,
                  }
                )

                // Le respondemos al celular 403 (prohibido)
                // con el motivo.
                res.writeHead(
                  403,
                  {
                    'Content-Type':
                      'application/json',
                  }
                )

                res.end(
                  JSON.stringify({
                    accepted:
                      false,
                    error:
                      reason,
                  })
                )

                return

              }

              // Aceptó: creamos el token (un código al azar
              // imposible de adivinar).
              const token =
                randomUUID()

              // Guardamos el permiso: para qué IP, qué
              // archivo y cuándo vence (ahora + 2 min).
              permisosEntregados.set(
                token,
                {
                  ip:
                    ipDelCelular,
                  fileName,
                  expiresAt:
                    Date.now() + DURACION_DEL_PERMISO,
                }
              )

              // Respondemos 200 con accepted: true y el
              // token.
              res.writeHead(
                200,
                {
                  'Content-Type':
                    'application/json',
                }
              )

              res.end(
                JSON.stringify({
                  accepted:
                    true,
                  token,
                })
              )

            }
          )

          return

        }


        // ====================================================
        // SUBIDA (celular → PC)
        // ====================================================
        //
        // Acá llegan los bytes del archivo, después de que
        // el usuario aceptó.

        // POST /upload?token=...: llegan los bytes del
        // archivo (celular → PC).
        if (
          req.method ===
            'POST' &&
          req.url?.startsWith(
            '/upload'
          )
        ) {

          // Separamos la dirección en partes para poder
          // leer los parámetros (?token=...).
          const direccion =
            new URL(
              req.url,
              `http://${req.headers.host}`
            )


          // Leemos el token (si no vino, texto vacío).
          const token =
            direccion.searchParams.get(
              'token'
            ) ?? ''

          // Buscamos el permiso con ese token.
          const accepted =
            permisosEntregados.get(
              token
            )

          // Lo borramos enseguida: un token sirve una sola
          // vez.
          permisosEntregados.delete(
            token
          )

          // Si no hay permiso, es de otra IP o ya venció →
          // no guardamos NADA en el disco.
          if (
            !accepted ||
            accepted.ip !== ipDelCelular ||
            accepted.expiresAt < Date.now()
          ) {

            console.log(
              '⛔ Subida sin autorización de',
              ipDelCelular
            )

            // 403 (prohibido) y le explicamos al celular
            // qué hacer.
            res.writeHead(
              403,
              {
                'Content-Type':
                  'application/json',
                Connection:
                  'close',
              }
            )

            res.end(
              JSON.stringify({
                ok:
                  false,
                error:
                  'La PC no autorizó este envío. Volvé a enviarlo para que aparezca el pedido de aceptación.',
              })
            )

            // resume() = tirar a la basura los bytes que el
            // celular ya había empezado a mandar.
            req.resume()

            return

          }


          // Nombre que se aceptó en el cartel.
          const rawName =
            accepted.fileName


          // Lo limpiamos y le agregamos la extensión según
          // el tipo (Content-Type) si le falta.
          const fileName =
            asegurarExtension(
              limpiarNombre(
                rawName
              ),
              req.headers[
                'content-type'
              ]
            )


          // Ruta final en Descargas/LocalSend, con (1),
          // (2)... si ya existe uno igual.
          const rutaFinal =
            rutaSinRepetir(
              path.join(
                CARPETA_DESCARGAS,
                fileName
              )
            )


          // Tamaño que DEBERÍA tener el archivo
          // (Content-Length). Al final lo comparamos con lo
          // que llegó.
          const tamanoEsperado =
            Number(
              req.headers[
                'content-length'
              ] ??
              direccion.searchParams.get(
                'size'
              ) ??
              0
            )


          console.log(
            '📥 Recibiendo:',
            fileName
          )

          console.log(
            '📦 Tamaño esperado:',
            tamanoEsperado
          )


          // Abrimos el archivo para irlo escribiendo de a
          // pedacitos de 1 MB (stream), sin tenerlo entero
          // en memoria.
          const escritorDelArchivo =
            fs.createWriteStream(
              rutaFinal,
              {
                // "w" = crear el archivo para escribir
                flags:
                  'w',
                highWaterMark:
                  1024 * 1024,
              }
            )


          // Reportero de progreso para esta recepción
          // ("receive").
          const reportero =
            crearReportero(
              'receive',
              fileName,
              tamanoEsperado,
              ipDelCelular
            )


          // Bytes recibidos hasta ahora.
          let bytesRecibidos =
            0

          // ¿Terminó bien?
          let finished =
            false

          // ¿Falló?
          let failed =
            false


          // fail: algo salió mal. Se ejecuta una sola vez.
          const fail =
            (
              message: string
            ) => {

              if (
                finished ||
                failed
              ) {
                return
              }

              failed =
                true

              console.log(
                '❌ Recepción interrumpida:',
                fileName,
                message
              )

              // Avisamos a la pantalla en qué % quedó y por
              // qué (canRetry false: hay que reenviar desde
              // el celular).
              reportero.fail(
                message,
                false
              )

              // Desconectamos la manguera.
              req.unpipe(
                escritorDelArchivo
              )

              // Cerramos el archivo.
              escritorDelArchivo.destroy()

              // Borramos el archivo a medias, para que no
              // quede uno roto en Descargas.
              fs.unlink(
                rutaFinal,
                () => {}
              )

            }


          // Si pasan 20 s sin que llegue nada, damos la
          // subida por cortada (Wi-Fi apagado).
          req.setTimeout(
            TIEMPO_SIN_ACTIVIDAD,
            () => {

              fail(
                `No llegaron datos durante ${TIEMPO_SIN_ACTIVIDAD / 1000} s: se perdió la conexión con el celular. Hay que reiniciar el envío desde el celular.`
              )

              req.destroy()

            }
          )


          // Cada pedacito que llega: sumamos los bytes y
          // actualizamos la barra.
          req.on(
            'data',
            chunk => {

              bytesRecibidos +=
                chunk.length

              reportero.update(
                bytesRecibidos
              )

            }
          )


          // Si la conexión se cierra y NO llegó todo
          // (req.complete = false), el celular canceló o se
          // cortó la red.
          req.on(
            'close',
            () => {

              if (
                !req.complete
              ) {

                const percent =
                  tamanoEsperado > 0
                    ? Math.floor((bytesRecibidos / tamanoEsperado) * 100)
                    : 0

                fail(
                  `La conexión con el celular se cortó al ${percent}%. Hay que reiniciar el envío desde el celular.`
                )

              }

            }
          )


          // Errores de la conexión: solo los mostramos en
          // la consola ("close" ya se encarga del resto).
          req.on(
            'error',
            error => {

              console.error(
                '❌ Error request:',
                error
              )

            }
          )


          // Error al escribir en el disco de la PC.
          escritorDelArchivo.on(
            'error',
            error => {

              // Si es porque nosotros ya cortamos, no
              // hacemos nada más.
              if (
                failed
              ) {
                return
              }

              console.error(
                '❌ Error escribiendo:',
                error
              )

              // ENOSPC = el disco está lleno. Damos un
              // mensaje claro para ese caso.
              const reason =
                (error as NodeJS.ErrnoException).code === 'ENOSPC'
                  ? 'No hay espacio suficiente en el disco de la PC.'
                  : `No se pudo guardar el archivo en la PC (${error.message}).`

              fail(
                reason
              )

              // Desconectamos la manguera y tiramos lo que
              // siga llegando...
              req.unpipe(
                escritorDelArchivo
              )

              req.resume()

              try {

                // ...y le respondemos al celular el motivo
                // (500 = error en la PC), si todavía no le
                // respondimos.
                if (
                  !res.headersSent
                ) {

                  res.writeHead(
                    500,
                    {
                      'Content-Type':
                        'application/json',
                    }
                  )

                  res.end(
                    JSON.stringify({
                      ok:
                        false,
                      error:
                        reason,
                    })
                  )

                }

              } catch {}

            }
          )


          // "finish" = se terminó de escribir todo en el
          // disco.
          escritorDelArchivo.on(
            'finish',
            () => {

              if (
                finished ||
                failed
              ) {

                return

              }

              finished =
                true


              // VERIFICACIÓN: medimos el archivo guardado.
              const tamanoReal =
                fs.statSync(
                  rutaFinal
                ).size


              // Si no pesa exactamente lo esperado, llegó
              // incompleto:
              if (
                tamanoEsperado > 0 &&
                tamanoReal !==
                  tamanoEsperado
              ) {

                console.error(
                  '❌ Tamaño incorrecto:',
                  tamanoReal,
                  tamanoEsperado
                )


                try {
                  // lo borramos,
                  fs.unlinkSync(
                    rutaFinal
                  )
                } catch {}


                // avisamos en la pantalla
                reportero.fail(
                  `El archivo llegó incompleto (${tamanoReal} de ${tamanoEsperado} bytes). Se descartó; hay que reiniciar el envío.`,
                  false
                )


                // y le respondemos 400 al celular con los
                // dos tamaños.
                res.writeHead(
                  400,
                  {
                    'Content-Type':
                      'application/json',
                  }
                )

                res.end(
                  JSON.stringify({

                    ok:
                      false,

                    error:
                      'El tamaño del archivo recibido no coincide.',

                    received:
                      tamanoReal,

                    expected:
                      tamanoEsperado,

                  })
                )

                return

              }


              // Última red de seguridad: si llegó sin
              // extensión, se la ponemos mirando su
              // contenido.
              const rutaGuardada =
                arreglarExtension(
                  rutaFinal
                )

              const nombreGuardado =
                path.basename(
                  rutaGuardada
                )

              console.log(
                '✅ Archivo recibido:',
                rutaGuardada
              )

              console.log(
                '📦 Bytes:',
                tamanoReal
              )


              // Avisamos a la pantalla: 100 %.
              reportero.complete(
                tamanoReal
              )


              // Notificación de Windows: "Archivo
              // recibido".
              try {

                new Notification({

                  title:
                    '📦 Archivo recibido',

                  body:
                    `${nombreGuardado} guardado en ${CARPETA_DESCARGAS}`,

                }).show()

              } catch {}


              // Respondemos 200 al celular con el nombre
              // final y el tamaño.
              res.writeHead(
                200,
                {
                  'Content-Type':
                    'application/json',
                }
              )

              res.end(
                JSON.stringify({

                  ok:
                    true,

                  fileName:
                    nombreGuardado,

                  size:
                    tamanoReal,

                  path:
                    rutaGuardada,

                })
              )

            }
          )


          // pipe = "conectar la manguera": lo que llega del
          // celular va directo al archivo en el disco. Si
          // el disco va lento, Node frena la lectura solo
          // (backpressure).
          req.pipe(
            escritorDelArchivo
          )

          return

        }


        // ====================================================
        // DESCARTAR (el celular no quiere el archivo)
        // ====================================================
        //
        // El celular avisa que no va a descargar un archivo
        // de la cola: porque el usuario tocó Rechazar o
        // porque no quiso reintentar después de un error.
        // Lo sacamos de la cola y lo mostramos en la
        // pantalla de la PC.

        // POST /discard/<id>: el celular no quiere el
        // archivo.
        if (
          req.method ===
            'POST' &&
          req.url?.startsWith(
            '/discard/'
          )
        ) {

          // Separamos la dirección en partes.
          const direccionDescarte =
            new URL(
              req.url,
              `http://${req.headers.host}`
            )

          // El id del archivo.
          const id =
            decodeURIComponent(
              direccionDescarte.pathname.substring(
                '/discard/'.length
              )
            )

          // Si la dirección trae "?reason=rejected", el
          // usuario del celular tocó "Rechazar".
          const rejected =
            direccionDescarte.searchParams.get(
              'reason'
            ) === 'rejected'

          // Su cola.
          const list =
            colaPorCelular.get(
              ipDelCelular
            ) ?? []

          // Posición del archivo en la cola.
          const index =
            list.findIndex(
              file =>
                file.id === id
            )

          // Si está en la cola:
          if (
            index !== -1
          ) {

            // Lo sacamos de la cola.
            const [file] =
              list.splice(
                index,
                1
              )

            // Avisamos a la pantalla de la PC.
            ventana?.webContents.send(
              'transfer-error',
              {
                direction:
                  'send',
                fileName:
                  file.fileName,
                peer:
                  ipDelCelular,
                total:
                  file.fileSize,
                bytes:
                  0,
                progress:
                  0,
                speed:
                  0,
                eta:
                  null,
                message:
                  rejected
                    ? 'El celular rechazó el archivo.'
                    : 'El celular descartó el archivo después del error. Si querés, volvé a enviarlo.',
                canRetry:
                  false,
                rejected,
              }
            )

            // Si fue un rechazo, notificación de Windows.
            if (
              rejected
            ) {

              try {

                new Notification({
                  title:
                    '🚫 Archivo rechazado',
                  body:
                    `El celular rechazó "${file.fileName}".`,
                }).show()

              } catch {}

            }

          }

          // Respondemos OK.
          res.writeHead(
            200,
            {
              'Content-Type':
                'application/json',
            }
          )

          res.end(
            JSON.stringify({
              ok:
                true,
            })
          )

          return

        }


        // ====================================================
        // CUALQUIER OTRA DIRECCIÓN
        // ====================================================
        //
        // Si piden una dirección que no existe, respondemos
        // un texto simple.

        // Cualquier otra dirección: respondemos un texto
        // simple.
        res.writeHead(
          200,
          {
            'Content-Type':
              'text/plain',
          }
        )

        res.end(
          'LocalSend TCP Node Active'
        )

      }
    )


  // Si el servidor falla (ej: otra app ya usa el puerto),
  // lo mostramos en la consola.
  servidorHTTP.on(
    'error',
    error => {

      console.error(
        'HTTP server error:',
        error
      )

    }
  )


  // IMPORTANTE para archivos grandes: Node corta solo
  // cualquier pedido de más de 5 minutos, y un video de 500
  // MB por Wi-Fi tarda más. 0 = sin límite. En su lugar,
  // cada transferencia usa el temporizador de inactividad
  // (20 s sin datos).
  servidorHTTP.requestTimeout =
    0

  // Tampoco hay límite por conexión.
  servidorHTTP.timeout =
    0

  // 60 s para recibir los encabezados del pedido.
  servidorHTTP.headersTimeout =
    60000

  // 5 s que se mantiene abierta una conexión sin usar.
  servidorHTTP.keepAliveTimeout =
    5000


  // listen = empezar a escuchar en el puerto 53318.
  // "0.0.0.0" = aceptar pedidos por CUALQUIER placa de red
  // (Wi-Fi, cable...).
  servidorHTTP.listen(
    PUERTO_HTTP,
    '0.0.0.0',
    () => {

      console.log(
        `🌐 HTTP activo en 0.0.0.0:${PUERTO_HTTP}`
      )

      console.log(
        `📁 Descargas: ${CARPETA_DESCARGAS}`
      )

      // Anotamos que el servidor de archivos arrancó...
      estadoServidores.tcp =
        true

      // ...y se lo avisamos a la pantalla (LED).
      ventana?.webContents.send(
        'server-status',
        estadoServidores
      )

    }
  )

}


// ============================================================
// IPC (comunicación entre main y la pantalla)
// ============================================================
//
// IPC = mensajes entre este archivo (main, que puede usar
// la red y el disco) y la pantalla de React (que no puede
// usar nada de eso, por seguridad).
// ipcMain.handle(nombre, función) = "cuando la pantalla
// pida X, ejecutá esto y devolvele el resultado".
// El if con listenerCount evita registrar lo mismo dos
// veces (Electron tira error si pasa).

// Registra lo que la pantalla le puede pedir a main.
function configurarIPC() {

  // Si "get-device-info" todavía no está registrado (evita
  // registrarlo dos veces, que da error)...
  if (
    ipcMain.listenerCount(
      'get-device-info'
    ) === 0
  ) {

    // ...lo registramos: la pantalla pide los datos de la
    // PC (nombre, IP, carpeta de descargas).
    ipcMain.handle(
      'get-device-info',
      () => ({

        alias:
          NOMBRE_DE_LA_PC,

        ip:
          obtenerMiIP(),

        downloadDir:
          CARPETA_DESCARGAS,

      })
    )

  }


  // Lo mismo para "send-file".
  if (
    ipcMain.listenerCount(
      'send-file'
    ) === 0
  ) {

    // La pantalla pide mandar un archivo a un celular.
    // Recibe la ruta del archivo y la IP del celular.
    ipcMain.handle(
      'send-file',
      async (
        _event,
        {
          filePath,
          targetIP,
        }
      ) => {

        try {

          // Si falta la ruta o la IP → error.
          if (
            !filePath ||
            !targetIP
          ) {

            return {
              ok:
                false,
              error:
                'Faltan datos',
            }

          }


          // Si el archivo no existe → error.
          if (
            !fs.existsSync(
              filePath
            )
          ) {

            return {
              ok:
                false,
              error:
                'El archivo no existe',
            }

          }


          // Datos del archivo (tamaño, si es carpeta...).
          const stats =
            fs.statSync(
              filePath
            )


          // Si es una carpeta y no un archivo → error.
          if (
            !stats.isFile()
          ) {

            return {
              ok:
                false,
              error:
                'La ruta no es un archivo',
            }

          }


          // Solo el nombre, sin la carpeta.
          const fileName =
            path.basename(
              filePath
            )


          // Id único: la hora actual + letras al azar.
          const id =
            `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`


          // La cola de ese celular (o una vacía si no
          // tenía).
          const list =
            colaPorCelular.get(
              targetIP
            ) ?? []


          // Agregamos el archivo a la cola.
          list.push({

            id,

            filePath,

            fileName,

            fileSize:
              stats.size,

          })


          // Guardamos la cola. El celular lo va a ver en su
          // próxima pregunta a /incoming (menos de 1 s).
          colaPorCelular.set(
            targetIP,
            list
          )


          console.log(
            '📤 Archivo puesto en cola:',
            fileName,
            '→',
            targetIP
          )


          // Avisamos a la pantalla: "en cola" (barra en 0
          // %).
          ventana?.webContents.send(
            'transfer-queued',
            {

              fileName,

              targetIP,

              fileSize:
                stats.size,

            }
          )


          return {
            ok:
              true,
          }


        } catch (
          // Si algo falla, devolvemos "Error interno".
          error
        ) {

          console.error(
            'send-file:',
            error
          )

          return {
            ok:
              false,
            error:
              'Error interno',
          }

        }

      }
    )

  }

}


// ============================================================
// CREAR VENTANA
// ============================================================

// Crea la ventana de la app.
function crearVentana() {

  // Nueva ventana:
  ventana =
    new BrowserWindow({

      // Ancho inicial (en píxeles)
      width:
        960,

      // Alto inicial
      height:
        820,

      // Ancho mínimo
      minWidth:
        520,

      // Alto mínimo
      minHeight:
        600,

      // Título
      title:
        'LocalSend',

      // Oculta el menú "File / Edit / View" (en inglés)
      autoHideMenuBar:
        true,

      // SEGURIDAD: si alguien lograra meter código
      // malicioso en la pantalla, no podría tocar tus
      // archivos.
      webPreferences: {

        // Archivo "puente" que le da a React solo las
        // funciones que necesita
        preload:
          path.join(
            __dirname,
            'preload.mjs'
          ),

        // React y Electron viven separados
        contextIsolation:
          true,

        // React NO puede usar Node (ni el disco ni la red)
        nodeIntegration:
          false,

      },

    })


  // En desarrollo (npm run dev) cargamos la pantalla desde
  // Vite, que se recarga sola al guardar...
  if (
    VITE_DEV_SERVER_URL
  ) {

    ventana.loadURL(
      VITE_DEV_SERVER_URL
    )

  } else {
  // ...y en el .exe la cargamos de los archivos ya
  // compilados (dist/index.html).

    ventana.loadFile(
      path.join(
        RENDERER_DIST,
        'index.html'
      )
    )

  }


  // Cuando la pantalla terminó de cargar, le mandamos el
  // estado de los servidores (para el LED verde), la IP, el
  // puerto y el nombre.
  ventana.webContents.on(
    'did-finish-load',
    () => {

      ventana?.webContents.send(
        'server-status',
        {

          ...estadoServidores,

          ip:
            obtenerMiIP(),

          port:
            PUERTO_HTTP,

          alias:
            NOMBRE_DE_LA_PC,

        }
      )

    }
  )

}


// ============================================================
// ARRANQUE DE LA APP
// ============================================================
//
// app.whenReady() espera a que Electron esté listo y
// después prende todo en orden: los mensajes con la
// pantalla (IPC), arreglar descargas viejas, la ventana, el
// servidor UDP, el servidor HTTP y la limpieza de
// dispositivos cada 1 s.

// Cuando Electron está listo, prendemos todo en orden:
app.whenReady()
  .then(
    () => {

      // 1) Lo que la pantalla puede pedir
      configurarIPC()

      // 2) Arreglar descargas viejas sin extensión
      arreglarDescargasViejas()

      // 3) La ventana
      crearVentana()

      // 4) Buscar dispositivos (UDP)
      iniciarServidorUDP()

      // 5) Servidor de archivos (HTTP)
      iniciarServidorHTTP()


      // 6) Cada 1 s, borrar los celulares que se fueron
      relojDeLimpieza =
        setInterval(
          borrarCelularesInactivos,
          1000
        )


      // Mac: si tocás el ícono y no hay ventanas abiertas,
      // se crea una nueva.
      app.on(
        'activate',
        () => {

          if (
            BrowserWindow.getAllWindows()
              .length === 0
          ) {

            crearVentana()

          }

        }
      )

    }
  )


// Al cerrar todas las ventanas se cierra la app. En Mac
// ("darwin") las apps siguen abiertas sin ventanas; por eso
// la excepción.
app.on(
  'window-all-closed',
  () => {

    if (
      process.platform !==
      'darwin'
    ) {

      app.quit()

    }

  }
)


// Antes de salir, apagamos todo para liberar los puertos
// 53317 y 53318:
app.on(
  'before-quit',
  () => {

    // Apagamos el reloj del aviso "acá estoy"
    if (
      relojDeAviso
    ) {

      clearInterval(
        relojDeAviso
      )

    }


    // Apagamos el reloj de limpieza
    if (
      relojDeLimpieza
    ) {

      clearInterval(
        relojDeLimpieza
      )

    }


    // Cerramos el servidor UDP
    try {
      servidorUDP?.close()
    } catch {}


    // Cerramos el servidor HTTP
    try {
      servidorHTTP?.close()
    } catch {}

  }
)
