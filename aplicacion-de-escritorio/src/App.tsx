import { useEffect, useState } from 'react'
import './App.css'

interface Device {
  alias: string
  ip: string
  port: number
  deviceType: 'desktop' | 'mobile'
}

type TransferStatus = 'queued' | 'active' | 'done' | 'error'

interface Transfer extends Partial<TransferInfo> {
  fileName: string
  direction: 'receive' | 'send'
  status: TransferStatus
}

// ============================================================
// FORMATOS
// ============================================================

function formatBytes(bytes = 0) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function formatSpeed(bytesPerSecond = 0) {
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`
}

function formatEta(seconds: number | null | undefined) {
  if (seconds == null) return 'calculando...'
  if (seconds < 60) return `${seconds} s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m} min ${s.toString().padStart(2, '0')} s`
}

function App() {
  const [deviceInfo, setDeviceInfo] = useState<any>(null)
  const [serverStatus, setServerStatus] = useState({ udp: false, tcp: false })
  const [devices, setDevices] = useState<Device[]>([])
  const [transfer, setTransfer] = useState<Transfer | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  useEffect(() => {
    // Obtener info del dispositivo local
    window.electronAPI.getDeviceInfo().then(setDeviceInfo)

    // Escuchar estado de servidores
    window.electronAPI.onServerStatus((status: any) => {
      setServerStatus(prev => ({ ...prev, ...status }))
    })

    // Escuchar dispositivos encontrados (Celular)
    window.electronAPI.onDeviceFound((device: Device) => {
      setDevices(prev => {
        // Filtramos cualquier versión vieja de este mismo alias para evitar fantasmas
        const filtered = prev.filter(d => d.ip !== device.ip && d.alias !== device.alias);
        return [...filtered, device]
      })
    })

    // El main lo saca cuando pasa el TTL sin latidos
    // (ej: le apagaron el Wi-Fi al celular).
    window.electronAPI.onDeviceRemoved((device: Device) => {
      setDevices(prev => prev.filter(d => d.ip !== device.ip))
    })

    // PC → celular: el archivo queda esperando a que el celular lo pida
    window.electronAPI.onTransferQueued(data => {
      setTransfer({
        direction: 'send',
        fileName: data.fileName,
        total: data.fileSize,
        bytes: 0,
        progress: 0,
        peer: data.targetIP,
        status: 'queued',
      })
    })

    // Progreso (en los dos sentidos)
    window.electronAPI.onTransferProgress(data => {
      setTransfer({ ...data, status: 'active' })
    })

    window.electronAPI.onTransferComplete(data => {
      setTransfer({ ...data, status: 'done' })
    })

    // Error: NO borramos la barra. Mostramos en qué % quedó y el motivo.
    window.electronAPI.onTransferError(data => {
      setTransfer({ ...data, status: 'error' })
    })

    return () => {
      ;['server-status', 'device-found', 'device-removed', 'transfer-progress', 'transfer-complete',
        'transfer-error', 'transfer-queued', 'send-progress']
        .forEach(ch => window.electronAPI.removeAllListeners(ch))
    }
  }, [])

  // Drag & Drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }
  const handleDragLeave = () => setIsDragging(false)
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) setSelectedFile(window.electronAPI.getFilePath(file))
  }

  const sendToDevice = async (device: Device) => {
    if (!selectedFile) return alert('Primero arrastrá un archivo')
    if (transfer && (transfer.status === 'active' || transfer.status === 'queued')) {
      return alert('Esperá a que termine la transferencia actual.')
    }
    const result = await window.electronAPI.sendFile(selectedFile, device.ip, device.port)
    if (!result.ok) {
      setTransfer({
        direction: 'send',
        fileName: selectedFile.split(/[\\/]/).pop() ?? selectedFile,
        status: 'error',
        message: result.error ?? 'No se pudo preparar el envío.',
      })
    }
  }

  // Click en la zona: abre el selector de archivos del sistema
  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) setSelectedFile(window.electronAPI.getFilePath(file))
    e.target.value = ''
  }

  const isOnline = serverStatus.udp && serverStatus.tcp
  const busy = transfer?.status === 'active' || transfer?.status === 'queued'
  const selectedName = selectedFile?.split(/[\\/]/).pop()

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="logo">📡</div>
        <div>
          <h1>LocalSend</h1>
          {deviceInfo && (
            <div className="device-name">{deviceInfo.alias} · {deviceInfo.ip}</div>
          )}
        </div>
        <div className="status">
          <span className={`led ${isOnline ? 'led--green' : 'led--red'}`} />
          <span>{isOnline ? 'Listo para recibir' : 'Iniciando...'}</span>
        </div>
      </header>

      {/* Paso 1: archivo */}
      <section className="card">
        <h2 className="card-title"><span className="step">1</span> Elegí un archivo</h2>
        <label
          className={`dropzone ${isDragging ? 'dropzone--active' : ''} ${selectedFile ? 'dropzone--ready' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input type="file" hidden onChange={handlePick} />
          {selectedFile ? (
            <>
              <span className="dropzone-icon">📄</span>
              <strong>{selectedName}</strong>
              <small>Listo. Ahora tocá un dispositivo para enviarlo.</small>
              <span className="link-button">Cambiar archivo</span>
            </>
          ) : (
            <>
              <span className="dropzone-icon">{isDragging ? '📥' : '📂'}</span>
              <strong>{isDragging ? 'Soltalo acá' : 'Arrastrá un archivo o hacé clic para elegirlo'}</strong>
              <small>Funciona con archivos de cualquier tamaño</small>
            </>
          )}
        </label>
      </section>

      {/* Paso 2: dispositivo */}
      <section className="card">
        <h2 className="card-title">
          <span className="step">2</span> Elegí el dispositivo
          <span className="card-hint">{devices.length} en la red</span>
        </h2>
        {devices.length === 0 ? (
          <div className="radar">
            <div className="radar-circle">📱</div>
            Buscando celulares en la red... Abrí la app en el celular (mismo Wi-Fi).
          </div>
        ) : (
          <div className="device-list">
            {devices.map(device => (
              <button key={device.ip} className="device-card" disabled={busy} onClick={() => sendToDevice(device)}>
                <span className="device-icon">{device.deviceType === 'mobile' ? '📱' : '🖥️'}</span>
                <span className="device-alias">{device.alias}</span>
                <span className="device-ip">{device.ip}</span>
                {selectedFile && !busy && <span className="device-action">Enviar →</span>}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Monitor de transferencia */}
      {transfer && (
        <section className={`card transfer transfer--${transfer.status}`}>
          <div className="transfer-header">
            <div className="transfer-icon">
              {transfer.status === 'done' ? '✅' : transfer.status === 'error' ? '⚠️' : transfer.direction === 'receive' ? '📥' : '📤'}
            </div>
            <div className="transfer-title">
              <small>{transfer.direction === 'receive' ? 'Recibiendo del celular' : 'Enviando al celular'}</small>
              <strong>{transfer.fileName}</strong>
            </div>
            <span className="transfer-percent">{transfer.progress ?? 0}%</span>
          </div>

          <div className="progress-bar">
            <div className="progress-bar__fill" style={{ width: `${transfer.progress ?? 0}%` }} />
          </div>

          {transfer.status === 'queued' && (
            <p className="transfer-detail">⏳ Esperando que el celular empiece la descarga...</p>
          )}

          {transfer.status === 'active' && (
            <div className="transfer-stats">
              <div className="stat"><small>Transferido</small><span>{formatBytes(transfer.bytes)} / {formatBytes(transfer.total)}</span></div>
              <div className="stat"><small>Velocidad</small><span>{formatSpeed(transfer.speed)}</span></div>
              <div className="stat"><small>Tiempo restante</small><span>{formatEta(transfer.eta)}</span></div>
            </div>
          )}

          {transfer.status === 'done' && (
            <p className="transfer-detail">
              Completado: {formatBytes(transfer.total)}
              {transfer.direction === 'receive' && deviceInfo && <> · guardado en {deviceInfo.downloadDir}</>}
            </p>
          )}

          {transfer.status === 'error' && (
            <div className="transfer-error">
              <strong>{transfer.message}</strong>
              <p className="transfer-detail">
                Quedó en {transfer.progress ?? 0}% ({formatBytes(transfer.bytes)} de {formatBytes(transfer.total)}).
                {' '}{transfer.canRetry
                  ? 'El celular puede tocar "Reanudar" y sigue desde este punto, sin empezar de cero.'
                  : 'La transferencia no se puede reanudar, hay que iniciarla de nuevo.'}
              </p>
            </div>
          )}

          {(transfer.status === 'done' || transfer.status === 'error') && (
            <button className="transfer-close" onClick={() => setTransfer(null)}>Cerrar</button>
          )}
        </section>
      )}

      {deviceInfo && (
        <footer className="footer">📁 Los archivos recibidos se guardan en {deviceInfo.downloadDir}</footer>
      )}
    </div>
  )
}

export default App
