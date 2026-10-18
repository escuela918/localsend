"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld(
  "electronAPI",
  {
    // ========================================================
    // INFORMACIÓN DE LA PC
    // ========================================================
    getDeviceInfo: () => electron.ipcRenderer.invoke(
      "get-device-info"
    ),
    // ========================================================
    // RUTA REAL DE UN ARCHIVO ARRASTRADO
    // ========================================================
    //
    // React no tiene acceso a "fs" ni a rutas del disco
    // (contextIsolation). webUtils solo existe acá, en el
    // preload, así que exponemos únicamente esta función.
    getFilePath: (file) => electron.webUtils.getPathForFile(
      file
    ),
    // ========================================================
    // PC → MOBILE
    // ========================================================
    sendFile: (filePath, targetIP, targetPort) => electron.ipcRenderer.invoke(
      "send-file",
      {
        filePath,
        targetIP,
        targetPort
      }
    ),
    // ========================================================
    // DISPOSITIVO ENCONTRADO
    // ========================================================
    onDeviceFound: (callback) => {
      electron.ipcRenderer.on(
        "device-found",
        (_event, device) => {
          callback(
            device
          );
        }
      );
    },
    // ========================================================
    // DISPOSITIVO ELIMINADO
    // ========================================================
    onDeviceRemoved: (callback) => {
      electron.ipcRenderer.on(
        "device-removed",
        (_event, device) => {
          callback(
            device
          );
        }
      );
    },
    // ========================================================
    // ESTADO SERVIDOR
    // ========================================================
    onServerStatus: (callback) => {
      electron.ipcRenderer.on(
        "server-status",
        (_event, status) => {
          callback(
            status
          );
        }
      );
    },
    // ========================================================
    // PROGRESO PC → MOBILE
    // ========================================================
    onSendProgress: (callback) => {
      electron.ipcRenderer.on(
        "send-progress",
        (_event, data) => {
          callback(
            data
          );
        }
      );
    },
    // ========================================================
    // PROGRESO MOBILE → PC
    // ========================================================
    onTransferProgress: (callback) => {
      electron.ipcRenderer.on(
        "transfer-progress",
        (_event, data) => {
          callback(
            data
          );
        }
      );
    },
    // ========================================================
    // TRANSFERENCIA TERMINADA
    // ========================================================
    onTransferComplete: (callback) => {
      electron.ipcRenderer.on(
        "transfer-complete",
        (_event, data) => {
          callback(
            data
          );
        }
      );
    },
    // ========================================================
    // TRANSFERENCIA INTERRUMPIDA
    // ========================================================
    onTransferError: (callback) => {
      electron.ipcRenderer.on(
        "transfer-error",
        (_event, data) => {
          callback(
            data
          );
        }
      );
    },
    // ========================================================
    // ARCHIVO PUESTO EN COLA
    // ========================================================
    onTransferQueued: (callback) => {
      electron.ipcRenderer.on(
        "transfer-queued",
        (_event, data) => {
          callback(
            data
          );
        }
      );
    },
    // ========================================================
    // LIMPIAR LISTENERS
    // ========================================================
    removeAllListeners: (channel) => {
      const allowedChannels = [
        "device-found",
        "device-removed",
        "server-status",
        "send-progress",
        "transfer-progress",
        "transfer-complete",
        "transfer-queued",
        "transfer-error"
      ];
      if (allowedChannels.includes(
        channel
      )) {
        electron.ipcRenderer.removeAllListeners(
          channel
        );
      }
    }
  }
);
