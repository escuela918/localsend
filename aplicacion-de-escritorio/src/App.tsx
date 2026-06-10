import { useEffect, useState } from 'react'
import './App.css'

interface Device {
  alias: string
  ip: string
  port: number
  deviceType: 'desktop' | 'mobile'
}

interface Transfer {
  fileName: string
  progress: number
  total: number
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
    window.electronAPI.onServerStatus((status) => {
      setServerStatus(prev => ({ ...prev, ...status }))
    })

    // Escuchar dispositivos encontrados
    window.electronAPI.onDeviceFound((device: Device) => {
      setDevices(prev => {
        const exists = prev.find(d => d.ip === device.ip)
        if (exists) return prev
        return [...prev, device]
      })
    })

    // Progreso de recepción
    window.electronAPI.onTransferProgress((data) => {
      setTransfer({ fileName: data.fileName, progress: data.progress, total: data.total })
    })

    window.electronAPI.onTransferComplete(() => {
      setTimeout(() => setTransfer(null), 3000)
    })

    return () => {
      ;['server-status', 'device-found', 'transfer-progress', 'transfer-complete', 'send-progress']
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
    if (file) setSelectedFile((file as any).path)
  }

  const sendToDevice = async (device: Device) => {
    if (!selectedFile) return alert('Primero arrastrá un archivo')
    await window.electronAPI.sendFile(selectedFile, device.ip, device.port)
  }

  const isOnline = serverStatus.udp && serverStatus.tcp

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <h1>LocalSend</h1>
        <div className="status">
          <span className={`led ${isOnline ? 'led--green' : 'led--red'}`} />
          <span>{isOnline ? 'En línea' : 'Iniciando...'}</span>
        </div>
        {deviceInfo && (
          <div className="device-name">{deviceInfo.alias} · {deviceInfo.ip}</div>
        )}
      </header>

      {/* Zona Drag & Drop */}
      <div
        className={`dropzone ${isDragging ? 'dropzone--active' : ''} ${selectedFile ? 'dropzone--ready' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {selectedFile
          ? <p>📄 {selectedFile.split('\\').pop()}<br/><small>Tocá un dispositivo para enviar</small></p>
          : <p>📂 Arrastrá un archivo aquí para enviarlo</p>
        }
      </div>

      {/* Lista de dispositivos */}
      <section className="devices">
        <h2>Dispositivos en la red {devices.length === 0 && <span className="scanning">escaneando...</span>}</h2>
        <div className="device-list">
          {devices.map(device => (
            <button key={device.ip} className="device-card" onClick={() => sendToDevice(device)}>
              <span className="device-icon">{device.deviceType === 'mobile' ? '📱' : '🖥️'}</span>
              <span className="device-alias">{device.alias}</span>
              <span className="device-ip">{device.ip}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Monitor de transferencia */}
      {transfer && (
        <div className="progress-bar-container">
          <p>{transfer.fileName}</p>
          <div className="progress-bar">
            <div className="progress-bar__fill" style={{ width: `${transfer.progress}%` }} />
          </div>
          <span>{transfer.progress}%</span>
        </div>
      )}
    </div>
  )
}

export default App