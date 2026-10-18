
import {
  ipcRenderer,
  contextBridge,
  webUtils,
} from 'electron'


// ============================================================
// API SEGURA PARA REACT
// ============================================================

contextBridge.exposeInMainWorld(
  'electronAPI',
  {

    // ========================================================
    // INFORMACIÓN DE LA PC
    // ========================================================

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

            // IMPORTANTE:
            // era "statuse" en tu código anterior.
            callback(
              status
            )

          }
        )

      },


    // ========================================================
    // PROGRESO PC → MOBILE
    // ========================================================

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
