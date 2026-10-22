// ============================================================
// PANTALLA DE LA PC (React)
// ============================================================
//
// Este archivo solo DIBUJA la pantalla y reacciona a lo que
// toca el usuario. No usa la red ni el disco: todo eso lo
// hace electron/main.ts. Para hablar con main usamos
// window.electronAPI, que es el "puente" que arma preload.ts.

import { useEffect, useState } from 'react'
import './App.css'

// Forma de un dispositivo de la lista (nombre, IP, puerto
// y si es celular o PC).
interface Device {
  alias: string
  ip: string
  port: number
  deviceType: 'desktop' | 'mobile'
}

// Estados posibles de una transferencia:
// queued = en la cola, esperando que el celular lo pida
// active = pasando datos
// done   = terminó bien
// error  = se cortó o lo rechazaron
type TransferStatus = 'queued' | 'active' | 'done' | 'error'

// Todo lo que mostramos de la transferencia actual: nombre,
// sentido (recibir/enviar), estado, %, velocidad, etc.
interface Transfer extends Partial<TransferInfo> {
  fileName: string
  direction: 'receive' | 'send'
  status: TransferStatus
}

// ============================================================
// FORMATOS (convertir números a texto fácil de leer)
// ============================================================

// Bytes → "1.5 MB". El logaritmo calcula cuántas veces hay
// que dividir por 1024 para elegir la unidad.
function formatBytes(bytes = 0) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

// Bytes por segundo → "12.3 MB/s".
function formatSpeed(bytesPerSecond = 0) {
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`
}

// Segundos restantes → "2 min 05 s". Si todavía no hay
// velocidad medida, muestra "calculando...".
function formatEta(seconds: number | null | undefined) {
  if (seconds == null) return 'calculando...'
  if (seconds < 60) return `${seconds} s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m} min ${s.toString().padStart(2, '0')} s`
}

function App() {
  // ESTADOS (useState): datos que, cuando cambian, hacen que
  // React vuelva a dibujar la pantalla sola.
  // deviceInfo   = nombre e IP de esta PC
  // serverStatus = si los servidores arrancaron (LED)
  // devices      = celulares encontrados
  // transfer     = la transferencia actual (barra)
  // isDragging   = si el usuario está arrastrando un archivo encima
  // selectedFile = ruta del archivo elegido
  const [deviceInfo, setDeviceInfo] = useState<any>(null)
  const [serverStatus, setServerStatus] = useState({ udp: false, tcp: false })
  const [devices, setDevices] = useState<Device[]>([])
  const [transfer, setTransfer] = useState<Transfer | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  // useEffect con [] al final = se ejecuta UNA sola vez,
  // cuando se abre la pantalla. Acá nos "suscribimos" a los
  // avisos que manda main.ts (como activar notificaciones).
  useEffect(() => {
    // Le pedimos a main el nombre y la IP de esta PC
    window.electronAPI.getDeviceInfo().then(setDeviceInfo)

    // Cuando main avisa que arrancaron los servidores,
    // lo guardamos (así el LED pasa a verde)
    window.electronAPI.onServerStatus((status: any) => {
      setServerStatus(prev => ({ ...prev, ...status }))
    })

    // Apareció un celular: lo agregamos a la lista
    window.electronAPI.onDeviceFound((device: Device) => {
      setDevices(prev => {
        // Sacamos la versión vieja de ese mismo celular (misma
        // IP o mismo nombre) para que no aparezca repetido
        const filtered = prev.filter(d => d.ip !== device.ip && d.alias !== device.alias);
        return [...filtered, device]
      })
    })

    // main avisa que un celular pasó 5 s sin dar señales
    // (ej: le apagaron el Wi-Fi): lo sacamos de la lista.
    window.electronAPI.onDeviceRemoved((device: Device) => {
      setDevices(prev => prev.filter(d => d.ip !== device.ip))
    })

    // PC → celular: el archivo quedó en la cola, esperando
    // que el celular lo pida. Mostramos la barra en 0 %.
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

    // Llegó un aviso de progreso (en los dos sentidos):
    // actualizamos %, velocidad y tiempo restante.
    // "...data" = copiar todos los datos que mandó main.
    window.electronAPI.onTransferProgress(data => {
      setTransfer({ ...data, status: 'active' })
    })

    // Terminó bien
    window.electronAPI.onTransferComplete(data => {
      setTransfer({ ...data, status: 'done' })
    })

    // Error: NO borramos la barra. Mostramos en qué % quedó
    // y el motivo.
    window.electronAPI.onTransferError(data => {
      setTransfer({ ...data, status: 'error' })
    })

    // Al cerrar la pantalla dejamos de escuchar. Si no, al
    // recargar quedarían dos "oídos" y cada aviso llegaría
    // dos veces.
    return () => {
      ;['server-status', 'device-found', 'device-removed', 'transfer-progress', 'transfer-complete',
        'transfer-error', 'transfer-queued', 'send-progress']
        .forEach(ch => window.electronAPI.removeAllListeners(ch))
    }
  }, [])

  // ARRASTRAR Y SOLTAR (drag & drop)
  // preventDefault() evita que Electron abra el archivo en
  // la ventana (lo que hace el navegador por defecto).
  // getFilePath() le pide al preload la ruta real del archivo
  // en el disco (React solo no la puede saber).
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

  // Click en un celular de la lista: le pedimos a main que
  // le mande el archivo elegido. Si ya hay una transferencia
  // en curso, no dejamos empezar otra.
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

  // Click en la zona: abre el selector de archivos de Windows.
  // Al final vaciamos el input para poder elegir el mismo
  // archivo otra vez si hace falta.
  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) setSelectedFile(window.electronAPI.getFilePath(file))
    e.target.value = ''
  }

  // Valores calculados para dibujar:
  // isOnline     = los dos servidores andando (LED verde)
  // busy         = hay una transferencia en curso
  // selectedName = solo el nombre del archivo, sin la carpeta
  const isOnline = serverStatus.udp && serverStatus.tcp
  const busy = transfer?.status === 'active' || transfer?.status === 'queued'
  const selectedName = selectedFile?.split(/[\\/]/).pop()

  // Lo que se ve en pantalla (JSX = HTML dentro de JS).
  // {condición && (...)} = mostrar eso solo si la condición
  // es verdadera.
  return (
    <div className="app">
      {/* Encabezado: nombre de la PC, IP y LED de estado */}
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

      {/* Barra de transferencia: %, velocidad, tiempo restante
          y, si falló, el motivo y en qué % quedó */}
      {transfer && (
        <section className={`card transfer transfer--${transfer.status}`}>
          <div className="transfer-header">
            <div className="transfer-icon">
              {transfer.status === 'done' ? '✅' : transfer.rejected ? '🚫' : transfer.status === 'error' ? '⚠️' : transfer.direction === 'receive' ? '📥' : '📤'}
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
            <p className="transfer-detail">⏳ Esperando que el celular acepte el archivo...</p>
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

          {transfer.status === 'error' && transfer.rejected && (
            <div className="transfer-error transfer-error--rejected">
              <strong>{transfer.message}</strong>
              <p className="transfer-detail">No se transfirió ningún dato. La app sigue lista para otros envíos.</p>
            </div>
          )}

          {transfer.status === 'error' && !transfer.rejected && (
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
