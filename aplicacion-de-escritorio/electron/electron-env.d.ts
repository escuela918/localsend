export {}
declare global {
  interface TransferInfo {
    direction: 'receive' | 'send'
    fileName: string
    peer: string
    total: number
    bytes: number
    progress: number
    speed: number
    eta: number | null
    message?: string
    canRetry?: boolean
  }

  interface Window {
    electronAPI: {
      getDeviceInfo: () => Promise<{ alias: string; ip: string; downloadDir: string }>
      getFilePath: (file: File) => string
      sendFile: (filePath: string, targetIP: string, targetPort: number) => Promise<{ ok: boolean; error?: string }>
      onDeviceFound: (cb: (device: any) => void) => void
      onDeviceRemoved: (cb: (device: any) => void) => void
      onServerStatus: (cb: (status: any) => void) => void
      onTransferProgress: (cb: (data: TransferInfo) => void) => void
      onTransferComplete: (cb: (data: TransferInfo) => void) => void
      onTransferError: (cb: (data: TransferInfo) => void) => void
      onTransferQueued: (cb: (data: { fileName: string; targetIP: string; fileSize: number }) => void) => void
      onSendProgress: (cb: (data: any) => void) => void
      removeAllListeners: (channel: string) => void
    }
  }
}
