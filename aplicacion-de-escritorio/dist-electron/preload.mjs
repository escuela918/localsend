"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  // Info del dispositivo local
  getDeviceInfo: () => electron.ipcRenderer.invoke("get-device-info"),
  // Enviar archivo a otro dispositivo
  sendFile: (filePath, targetIP, targetPort) => electron.ipcRenderer.invoke("send-file", { filePath, targetIP, targetPort }),
  // Escuchar eventos del Main
  onDeviceFound: (cb) => electron.ipcRenderer.on("device-found", (_e, device) => cb(device)),
  onServerStatus: (cb) => electron.ipcRenderer.on("server-status", (_e, status) => cb(status)),
  onTransferProgress: (cb) => electron.ipcRenderer.on("transfer-progress", (_e, data) => cb(data)),
  onTransferComplete: (cb) => electron.ipcRenderer.on("transfer-complete", (_e, data) => cb(data)),
  onSendProgress: (cb) => electron.ipcRenderer.on("send-progress", (_e, data) => cb(data)),
  // Limpiar listeners al desmontar componentes
  removeAllListeners: (channel) => electron.ipcRenderer.removeAllListeners(channel)
});
