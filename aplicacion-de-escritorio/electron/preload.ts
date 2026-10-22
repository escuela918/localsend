
import {
  ipcRenderer,
  contextBridge,
  webUtils,
} from 'electron'


// ============================================================
// API SEGURA PARA REACT
// ============================================================
//
// PRELOAD = el "puente" entre la pantalla (React) y
// main.ts.
// React vive aislado (contextIsolation) y no puede usar
// Node: no puede leer el disco ni abrir conexiones. Este
// archivo corre ANTES que la pantalla y le deja en
// window.electronAPI SOLO las funciones de esta lista. Es
// como una ventanilla: React puede pedir cosas, pero no
// entrar a la cocina.
// Dos tipos de funciones:
// - ipcRenderer.invoke(...): React PIDE algo y espera la
//   respuesta (como una pregunta).
// - ipcRenderer.on(...): React se queda ESCUCHANDO avisos
//   que manda main (dispositivo encontrado, progreso,
//   etc.). "callback" es la función de React que se ejecuta
//   con cada aviso.

contextBridge.exposeInMainWorld(
  'electronAPI',
  {

    // ========================================================
    // INFORMACIÓN DE LA PC
    // ========================================================

    // Pide el nombre, la IP y la carpeta de descargas de la
    // PC.
    getDeviceInfo:
      () =>
        ipcRenderer.invoke(
          'get-device-info'
        ),


    // ========================================================
    // RUTA REAL DE UN ARCHIVO ARRASTRADO
    // ========================================================
    //
    // React no tiene acceso a "fs" ni a rutas del disco
    // (contextIsolation). webUtils solo existe acá, en el
    // preload, así que exponemos únicamente esta función.

    getFilePath:
      (
        file: File
      ) =>
        webUtils.getPathForFile(
          file
        ),


    // ========================================================
    // PC → MOBILE
    // ========================================================

    // Pide mandar el archivo (por su ruta en el disco) al
    // celular con esa IP. main lo pone en la cola de ese
    // celular.
    sendFile:
      (
        filePath: string,
        targetIP: string,
        targetPort: number
      ) =>
        ipcRenderer.invoke(
          'send-file',
          {
            filePath,
            targetIP,
            targetPort,
          }
        ),


    // ========================================================
    // DISPOSITIVO ENCONTRADO
    // ========================================================

    // Avisa cuando aparece un celular nuevo (o uno que
    // volvió).
    onDeviceFound:
      (
        callback: (
          device: any
        ) => void
      ) => {

        ipcRenderer.on(
          'device-found',
          (
            _event,
            device
          ) => {

            callback(
              device
            )

          }
        )

      },


    // ========================================================
    // DISPOSITIVO ELIMINADO
    // ========================================================

    // Avisa cuando un celular pasó 5 s sin señales y se
    // sacó de la lista.
    onDeviceRemoved:
      (
        callback: (
          device: any
        ) => void
      ) => {

        ipcRenderer.on(
          'device-removed',
          (
            _event,
            device
          ) => {

            callback(
              device
            )

          }
        )

      },


    // ========================================================
    // ESTADO SERVIDOR
    // ========================================================

    // Avisa si los servidores UDP y HTTP ya arrancaron
    // (para el LED verde).
    onServerStatus:
      (
        callback: (
          status: any
        ) => void
      ) => {

        ipcRenderer.on(
          'server-status',
          (
            _event,
            status
          ) => {

            // Le pasamos a React el estado tal cual llega.
            callback(
              status
            )

          }
        )

      },


    // ========================================================
    // PROGRESO PC → MOBILE
    // ========================================================

    // Progreso de un envío (canal viejo, lo dejamos por
    // compatibilidad).
    onSendProgress:
      (
        callback: (
          data: any
        ) => void
      ) => {

        ipcRenderer.on(
          'send-progress',
          (
            _event,
            data
          ) => {

            callback(
              data
            )

          }
        )

      },


    // ========================================================
    // PROGRESO MOBILE → PC
    // ========================================================

    // Progreso en los dos sentidos: %, bytes, velocidad
    // (MB/s) y tiempo restante.
    onTransferProgress:
      (
        callback: (
          data: any
        ) => void
      ) => {

        ipcRenderer.on(
          'transfer-progress',
          (
            _event,
            data
          ) => {

            callback(
              data
            )

          }
        )

      },


    // ========================================================
    // TRANSFERENCIA TERMINADA
    // ========================================================

    // La transferencia terminó bien.
    onTransferComplete:
      (
        callback: (
          data: any
        ) => void
      ) => {

        ipcRenderer.on(
          'transfer-complete',
          (
            _event,
            data
          ) => {

            callback(
              data
            )

          }
        )

      },


    // ========================================================
    // TRANSFERENCIA INTERRUMPIDA
    // ========================================================

    // La transferencia se cortó o fue rechazada: trae el
    // motivo y en qué % quedó.
    onTransferError:
      (
        callback: (
          data: any
        ) => void
      ) => {

        ipcRenderer.on(
          'transfer-error',
          (
            _event,
            data
          ) => {

            callback(
              data
            )

          }
        )

      },


    // ========================================================
    // ARCHIVO PUESTO EN COLA
    // ========================================================

    // El archivo quedó en la cola, esperando que el celular
    // lo pida.
    onTransferQueued:
      (
        callback: (
          data: any
        ) => void
      ) => {

        ipcRenderer.on(
          'transfer-queued',
          (
            _event,
            data
          ) => {

            callback(
              data
            )

          }
        )

      },


    // ========================================================
    // LIMPIAR LISTENERS
    // ========================================================

    // Deja de escuchar un canal (React lo usa al cerrarse
    // la pantalla para no escuchar dos veces lo mismo).
    // Solo se permiten los canales de esta lista, así React
    // no puede apagar canales internos de Electron.
    removeAllListeners:
      (
        channel: string
      ) => {

        const allowedChannels =
          [

            'device-found',

            'device-removed',

            'server-status',

            'send-progress',

            'transfer-progress',

            'transfer-complete',

            'transfer-queued',

            'transfer-error',

          ]


        if (
          allowedChannels.includes(
            channel
          )
        ) {

          ipcRenderer.removeAllListeners(
            channel
          )

        }

      },

  }
)
