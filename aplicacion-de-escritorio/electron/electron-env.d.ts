export {}
declare global {
  interface Window {
    electronAPI: {
      getDeviceInfo: () => Promise<{ alias: string; ip: string; downloadDir: string }>
      sendFile: (filePath: string, targetIP: string, targetPort: number) => Promise<{ ok: boolean }>
      onDeviceFound: (cb: (device: any) => void) => void
      onServerStatus: (cb: (status: any) => void) => void
      onTransferProgress: (cb: (data: any) => void) => void
      onTransferComplete: (cb: (data: any) => void) => void
      onSendProgress: (cb: (data: any) => void) => void
      removeAllListeners: (channel: string) => void
    }
  }
}