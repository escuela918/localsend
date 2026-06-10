import { ipcRenderer, contextBridge } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // Info del dispositivo local
  getDeviceInfo: () => ipcRenderer.invoke('get-device-info'),

  // Enviar archivo a otro dispositivo
  sendFile: (filePath: string, targetIP: string, targetPort: number) =>
    ipcRenderer.invoke('send-file', { filePath, targetIP, targetPort }),

  // Escuchar eventos del Main
  onDeviceFound: (cb: (device: any) => void) =>
    ipcRenderer.on('device-found', (_e, device) => cb(device)),

  onServerStatus: (cb: (status: any) => void) =>
    ipcRenderer.on('server-status', (_e, status) => cb(status)),

  onTransferProgress: (cb: (data: any) => void) =>
    ipcRenderer.on('transfer-progress', (_e, data) => cb(data)),

  onTransferComplete: (cb: (data: any) => void) =>
    ipcRenderer.on('transfer-complete', (_e, data) => cb(data)),

  onSendProgress: (cb: (data: any) => void) =>
    ipcRenderer.on('send-progress', (_e, data) => cb(data)),

  // Limpiar listeners al desmontar componentes
  removeAllListeners: (channel: string) =>
    ipcRenderer.removeAllListeners(channel),
})