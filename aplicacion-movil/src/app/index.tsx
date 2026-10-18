
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

import NetInfo from '@react-native-community/netinfo';
import * as ExpoDevice from 'expo-device';
import {
  Directory,
  DownloadTask,
  File,
  Paths,
} from 'expo-file-system';
import { Image } from 'expo-image';
// Para guardar fotos y videos directo en la Galería.
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Sharing from 'expo-sharing';
import dgram from 'react-native-udp';

import React, {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  ActivityIndicator,
  Alert,
  Animated,
  Modal,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';


// ============================================================
// TIPOS
// ============================================================

interface Device {
  alias: string;
  ip: string;
  port: number;
  deviceType: 'desktop' | 'mobile';
}

interface SelectedFile {
  name: string;
  uri: string;
  size: number;
  mimeType: string;
}

interface IncomingFile {
  id: string;
  fileName: string;
  fileSize: number;
}

// Archivo que ya llegó al celular.
interface ReceivedFile {
  id: string;
  name: string;
  uri: string;
  size: number;
  mimeType?: string;
  receivedAt: number;
  // Nombre de la carpeta donde se guardó (si se guardó)
  savedTo?: string;
}

// Error con un mensaje ya pensado para el usuario
// (no hace falta diagnosticar la red).
class FileAccessError extends Error {}

// Estado de la transferencia actual.
// Cuando hay un error NO se borra: queda el porcentaje
// en el que se cortó, el motivo y el botón "Reintentar".
interface TransferState {
  direction: 'send' | 'receive';
  status: 'active' | 'done' | 'error';
  fileName: string;
  bytes: number;
  total: number;
  // Bytes por segundo
  speed: number;
  // Segundos restantes
  eta?: number | null;
  message?: string;
  thumbnailUri?: string;
  // Para reintentar un envío
  device?: Device;
  // Para reintentar una recepción
  incoming?: IncomingFile;
  pcIP?: string;
  // Si quedó un archivo parcial, se puede reanudar
  // desde ese punto en vez de empezar de cero.
  canResume?: boolean;
}


// ============================================================
// CONFIGURACIÓN
// ============================================================

const WS_PORT = 53318;

const UDP_PORT = 53317;

// Nombre amigable: "Galaxy A54", "Pixel 7"...
const DEVICE_ALIAS =
  ExpoDevice.deviceName ||
  ExpoDevice.modelName ||
  'Android';

// Cada cuánto anunciamos el celular por UDP.
const BEACON_INTERVAL = 1000;

// Cada cuánto le avisamos a la PC que seguimos vivos.
// La PC nos borra si pasan 5 s sin noticias.
const HEARTBEAT_INTERVAL = 1000;

// Escaneo HTTP de respaldo (por si la red bloquea UDP).
const DISCOVERY_INTERVAL = 2500;

const SCAN_BATCH_SIZE = 64;

const REQUEST_TIMEOUT = 500;

// Fallas seguidas antes de dar a la PC por perdida.
const MAX_POLL_FAILURES = 4;

// Si la transferencia no avanza en este tiempo,
// la cortamos y avisamos (evita cargas infinitas).
const STALL_TIMEOUT = 20000;

// Cada cuánto actualizamos la barra (no en cada chunk,
// para no saturar el bridge de React Native).
const PROGRESS_INTERVAL = 250;


// ============================================================
// CONFIGURACIÓN GUARDADA
// ============================================================
//
// Se guarda en un JSON dentro de la carpeta de la app:
// la carpeta elegida para "Guardar" y la lista de recibidos.

interface AppConfig {
  saveDirUri?: string;
  received?: ReceivedFile[];
}

const CONFIG_FILE =
  new File(
    Paths.document,
    'localsend-config.json'
  );

const readConfig =
  (): AppConfig => {

    try {

      return CONFIG_FILE.exists
        ? JSON.parse(CONFIG_FILE.textSync())
        : {};

    } catch {

      return {};

    }

  };

const writeConfig =
  (config: AppConfig) => {

    try {

      if (!CONFIG_FILE.exists) {
        CONFIG_FILE.create();
      }

      CONFIG_FILE.write(
        JSON.stringify(config)
      );

    } catch (error) {

      console.log(
        'No se pudo guardar la configuración:',
        error
      );

    }

  };

const formatEta =
  (seconds?: number | null) => {

    if (seconds == null) {
      return 'calculando...';
    }

    if (seconds < 60) {
      return `${seconds} s`;
    }

    return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`;

  };


// ============================================================
// TIPO DE ARCHIVO ⇄ EXTENSIÓN
// ============================================================
//
// Algunos celulares devuelven el nombre de la galería SIN
// extensión (ej: "image_1000211109"). Sin ".jpg" ni Windows
// ni Android saben con qué abrirlo, así que la completamos
// según el tipo (MIME). Y al revés: para "Abrir" y "Guardar"
// necesitamos el tipo a partir de la extensión.

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'video/mp4': '.mp4',
  'video/3gpp': '.3gp',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/x-matroska': '.mkv',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  'text/plain': '.txt',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.android.package-archive': '.apk',
};

const getExtension =
  (name: string) => {

    const dot =
      name.lastIndexOf('.');

    return dot > 0
      ? name.slice(dot).toLowerCase()
      : '';

  };

const ensureExtension =
  (
    name: string,
    mimeType?: string | null
  ) => {

    if (getExtension(name)) {
      return name;
    }

    const ext =
      MIME_TO_EXT[
        (mimeType ?? '').toLowerCase()
      ];

    return ext
      ? name + ext
      : name;

  };

const mimeFromName =
  (name: string) => {

    const ext =
      getExtension(name);

    // ".jpeg" también es JPG
    if (ext === '.jpeg') {
      return 'image/jpeg';
    }

    const found =
      Object.entries(MIME_TO_EXT).find(
        ([, value]) =>
          value === ext
      );

    return found?.[0] ??
      'application/octet-stream';

  };


// ============================================================
// FORMATEAR BYTES
// ============================================================

const formatBytes =
  (bytes: number) => {

    if (!bytes || bytes < 0) {
      return '0 B';
    }

    const units =
      [
        'B',
        'KB',
        'MB',
        'GB',
      ];

    const index =
      Math.min(
        units.length - 1,
        Math.floor(
          Math.log(bytes) /
          Math.log(1024)
        )
      );

    return (
      bytes /
      Math.pow(
        1024,
        index
      )
    ).toFixed(2) +
      ' ' +
      units[index];

  };


// ============================================================
// TRADUCIR ERRORES
// ============================================================
//
// Convierte los errores técnicos de Android/OkHttp en un
// mensaje que el usuario entienda.

const describeError =
  (error: any): string => {

    const raw =
      String(
        error?.message ??
        error ??
        ''
      );

    if (/ENOSPC|no space|not enough space/i.test(raw)) {
      return 'No hay espacio suficiente en el celular.';
    }

    if (/ECONNREFUSED|failed to connect|unable to resolve host|no route to host|network is unreachable|network request failed/i.test(raw)) {
      return 'No se pudo conectar con la PC. Verificá que la app de escritorio esté abierta y que los dos estén en la misma red Wi-Fi.';
    }

    if (/timeout|timed out/i.test(raw)) {
      return 'La PC dejó de responder (se agotó el tiempo de espera).';
    }

    if (/reset|closed|unexpected end|broken pipe|EPIPE|software caused connection abort|stream was reset|interrump/i.test(raw)) {
      return 'Se cortó la conexión con la PC en medio de la transferencia (el Wi-Fi se cayó o la señal es muy débil). Acercate al router y tocá "Reintentar".';
    }

    if (/cancel/i.test(raw)) {
      return 'La transferencia se canceló.';
    }

    return `La transferencia se interrumpió por un problema de red. Tocá "Reintentar".${raw ? ` (detalle: ${raw})` : ''}`;

  };


// ============================================================
// COMPONENTE
// ============================================================

export default function HomeScreen() {

  // Márgenes seguros (barra de estado, pestañas, notch).
  const insets = useSafeAreaInsets();

  // Colores según el modo claro/oscuro del sistema.
  const scheme = useColorScheme();
  const palette =
    PALETTES[scheme === 'dark' ? 'dark' : 'light'];

  // ============================================================
  // ESTADOS
  // ============================================================

  const [loading, setLoading] =
    useState(true);

  const [devices, setDevices] =
    useState<Device[]>([]);

  const [selectedFile, setSelectedFile] =
    useState<SelectedFile | null>(null);

  const [isConnected, setIsConnected] =
    useState(false);

  const [scanning, setScanning] =
    useState(true);

  const [modalVisible, setModalVisible] =
    useState(false);

  const [ipInput, setIpInput] =
    useState('');

  const [transfer, setTransfer] =
    useState<TransferState | null>(null);

  // Archivos que llegaron al celular.
  const [received, setReceived] =
    useState<ReceivedFile[]>([]);

  // Carpeta elegida para "Guardar".
  const [saveDirName, setSaveDirName] =
    useState<string | null>(null);


  // ============================================================
  // REFS
  // ============================================================

  const pulseAnim =
    useRef(new Animated.Value(1)).current;

  const isConnectedRef =
    useRef(false);

  const discoveryRef =
    useRef<any>(null);

  const heartbeatRef =
    useRef<any>(null);

  const pollRef =
    useRef<any>(null);

  const incomingRef =
    useRef<any>(null);

  // IP de la PC con la que estamos conectados.
  const discoveredPCRef =
    useRef<string | null>(null);

  // Última PC conocida: al reconectar se prueba primero.
  const lastPCRef =
    useRef<string | null>(null);

  const connectingRef =
    useRef<string | null>(null);

  const scanningLockRef =
    useRef(false);

  const pollFailuresRef =
    useRef(0);

  const downloadingIds =
    useRef<Set<string>>(new Set());

  // Archivos que fallaron: no se reintentan solos,
  // espera a que el usuario toque "Reintentar".
  const failedIds =
    useRef<Set<string>>(new Set());

  // Tarea nativa activa (para poder cancelarla).
  const activeTaskRef =
    useRef<{ cancel: () => void } | null>(null);

  const saveDirRef =
    useRef<Directory | null>(null);

  // Descargas cortadas: id del archivo → archivo parcial.
  // Con esto se reanuda desde el byte donde quedó.
  const partialDownloadsRef =
    useRef<Map<string, string>>(new Map());

  // Si cancelamos nosotros, guardamos el motivo real.
  const cancelReasonRef =
    useRef<string | null>(null);

  const lastProgressAtRef =
    useRef(0);


  // ============================================================
  // CARGAR CONFIGURACIÓN
  // ============================================================

  useEffect(() => {

    const config =
      readConfig();

    if (config.saveDirUri) {

      try {

        const directory =
          new Directory(
            config.saveDirUri
          );

        saveDirRef.current =
          directory;

        setSaveDirName(
          directory.name
        );

      } catch {}

    }

    // Solo los que todavía existen en el celular.
    setReceived(
      (config.received ?? []).filter(
        file => {
          try {
            return new File(file.uri).exists;
          } catch {
            return false;
          }
        }
      )
    );

  }, []);


  // ============================================================
  // ANIMACIÓN RADAR
  // ============================================================

  useEffect(() => {

    if (!scanning) {
      pulseAnim.setValue(1);
      return;
    }

    const animation =
      Animated.loop(

        Animated.sequence([

          Animated.timing(
            pulseAnim,
            {
              toValue: 1.15,
              duration: 700,
              useNativeDriver: true,
            }
          ),

          Animated.timing(
            pulseAnim,
            {
              toValue: 1,
              duration: 700,
              useNativeDriver: true,
            }
          ),

        ])

      );

    animation.start();

    return () => {
      animation.stop();
    };

  }, [scanning, pulseAnim]);


  // ============================================================
  // WIFI
  // ============================================================

  useEffect(() => {

    const unsubscribe =
      NetInfo.addEventListener(
        state => {

          const connected =
            !!state.isConnected &&
            state.type === 'wifi';

          // Se perdió el Wi-Fi.
          if (
            isConnectedRef.current &&
            !connected
          ) {

            // Si había una transferencia, la cortamos
            // con un motivo claro (sino quedaría colgada).
            if (activeTaskRef.current) {

              cancelReasonRef.current =
                'Se perdió la conexión Wi-Fi del celular. Cuando vuelva el Wi-Fi, tocá el botón de abajo para continuar.';

              activeTaskRef.current.cancel();

            }

            disconnectFromDesktop();

          }

          isConnectedRef.current =
            connected;

          setIsConnected(
            connected
          );

          setLoading(false);

        }
      );

    return () => {
      unsubscribe();
    };

  }, []);


  // ============================================================
  // OBTENER IP LOCAL
  // ============================================================

  const getLocalNetworkInfo =
    async () => {

      const state =
        await NetInfo.fetch();

      const details =
        state.details as any;

      return {
        ip:
          details?.ipAddress ??
          null,

        subnet:
          details?.subnet ??
          null,

        gateway:
          details?.gateway ??
          null,
      };

    };


  // ============================================================
  // CREAR IPs DEL /24
  // ============================================================

  const generateIPs =
    (ip: string) => {

      const parts =
        ip.split('.');

      if (parts.length !== 4) {
        return [];
      }

      const prefix =
        `${parts[0]}.${parts[1]}.${parts[2]}.`;

      const current =
        Number(parts[3]);

      const ips: string[] = [];

      // Primero buscamos cerca de nuestra IP.
      for (
        let offset = 1;
        offset <= 254;
        offset++
      ) {

        const candidates = [
          current + offset,
          current - offset,
        ];

        for (
          const value of candidates
        ) {

          if (
            value >= 1 &&
            value <= 254
          ) {

            ips.push(
              prefix + value
            );

          }

        }

      }

      return [
        ...new Set(ips),
      ];

    };


  // ============================================================
  // FETCH CON TIMEOUT
  // ============================================================

  const fetchWithTimeout =
    async (
      url: string,
      options: RequestInit = {},
      timeout = REQUEST_TIMEOUT
    ) => {

      const controller =
        new AbortController();

      const timer =
        setTimeout(
          () => controller.abort(),
          timeout
        );

      try {

        return await fetch(
          url,
          {
            ...options,
            signal:
              controller.signal,
          }
        );

      } finally {

        clearTimeout(timer);

      }

    };


  // ============================================================
  // PROBAR UNA PC
  // ============================================================

  const testDesktop =
    async (
      ip: string
    ): Promise<boolean> => {

      try {

        const response =
          await fetchWithTimeout(
            `http://${ip}:${WS_PORT}/ping`
          );

        if (!response.ok) {
          return false;
        }

        const data =
          await response.json();

        return (
          data?.service === 'LocalSend'
        );

      } catch {

        return false;

      }

    };


  // ============================================================
  // REGISTRAR CELULAR
  // ============================================================

  const registerWithDesktop =
    async (
      ip: string
    ) => {

      const response =
        await fetchWithTimeout(

          `http://${ip}:${WS_PORT}/register`,

          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json',
            },

            body:
              JSON.stringify({

                alias:
                  DEVICE_ALIAS,

                port:
                  WS_PORT,

                deviceType:
                  'mobile',

              }),

          },

          1500

        );

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}`
        );
      }

      return response.json();

    };


  // ============================================================
  // DESCUBRIMIENTO UDP (principal)
  // ============================================================
  //
  // La PC manda cada 1 s un beacon por broadcast al puerto
  // 53317. Al escucharlo sabemos su IP al instante, sin
  // escanear la red. A la vez mandamos nuestro propio beacon
  // para que la PC nos vea aunque todavía no nos registramos.

  useEffect(() => {

    if (!isConnected) {
      return;
    }

    // Los tipos de react-native-udp no declaran .on(),
    // pero el socket hereda de EventEmitter y lo tiene.
    let socket: any =
      null;

    let bound =
      false;

    try {

      socket =
        dgram.createSocket({
          type: 'udp4',
          reusePort: true,
        });

      socket.on(
        'message',
        (msg: any, rinfo: any) => {

          try {

            const data =
              JSON.parse(
                msg.toString()
              );

            if (
              data?.deviceType === 'desktop' &&
              discoveredPCRef.current !== rinfo.address
            ) {

              console.log(
                '📡 Beacon de PC:',
                rinfo.address
              );

              connectToDesktop(
                rinfo.address
              );

            }

          } catch {
            // Paquete que no es nuestro. Lo ignoramos.
          }

        }
      );

      socket.on(
        'error',
        (error: any) => {
          console.log(
            'UDP error:',
            error
          );
        }
      );

      socket.bind(
        UDP_PORT,
        () => {

          bound = true;

          try {
            socket?.setBroadcast(true);
          } catch {}

        }
      );

    } catch (error) {

      // Si UDP no está disponible (ej: Expo Go),
      // queda el escaneo HTTP como respaldo.
      console.log(
        'UDP no disponible:',
        error
      );

    }

    const beaconTimer =
      setInterval(
        () => {

          if (
            !socket ||
            !bound
          ) {
            return;
          }

          const beacon =
            JSON.stringify({
              alias:
                DEVICE_ALIAS,
              port:
                WS_PORT,
              deviceType:
                'mobile',
            });

          try {

            socket.send(
              beacon,
              undefined,
              undefined,
              UDP_PORT,
              '255.255.255.255',
              () => {}
            );

          } catch {}

        },
        BEACON_INTERVAL
      );

    return () => {

      clearInterval(
        beaconTimer
      );

      try {
        socket?.close();
      } catch {}

    };

  }, [isConnected]);


  // ============================================================
  // DESCUBRIMIENTO HTTP (respaldo)
  // ============================================================
  //
  // Si la red bloquea el broadcast UDP (pasa en algunas redes
  // de facultad o routers), probamos /ping en toda la subred.
  // 64 pedidos en paralelo con 500 ms de timeout → la subred
  // completa se recorre en ~2 segundos.

  const discoverDesktop =
    async () => {

      if (
        !isConnectedRef.current ||
        discoveredPCRef.current ||
        scanningLockRef.current
      ) {
        return;
      }

      scanningLockRef.current =
        true;

      try {

        // Reconexión rápida: probamos primero la última
        // PC conocida antes de recorrer toda la red.
        if (
          lastPCRef.current &&
          await testDesktop(lastPCRef.current)
        ) {

          await connectToDesktop(
            lastPCRef.current
          );

          return;

        }

        const network =
          await getLocalNetworkInfo();

        if (!network.ip) {
          return;
        }

        console.log(
          '🔎 Buscando PC en:',
          network.ip
        );

        const ips =
          generateIPs(
            network.ip
          );

        for (
          let i = 0;
          i < ips.length;
          i += SCAN_BATCH_SIZE
        ) {

          // Si mientras tanto UDP ya la encontró, cortamos.
          if (discoveredPCRef.current) {
            return;
          }

          const batch =
            ips.slice(
              i,
              i + SCAN_BATCH_SIZE
            );

          const results =
            await Promise.all(

              batch.map(
                async ip =>
                  (await testDesktop(ip))
                    ? ip
                    : null
              )

            );

          const foundIP =
            results.find(
              value =>
                value !== null
            );

          if (foundIP) {

            console.log(
              '🖥️ PC encontrada:',
              foundIP
            );

            await connectToDesktop(
              foundIP
            );

            return;

          }

        }

      } catch (error) {

        console.log(
          'Error discovery:',
          error
        );

      } finally {

        scanningLockRef.current =
          false;

      }

    };


  // ============================================================
  // CONECTAR CON PC
  // ============================================================

  const connectToDesktop =
    async (
      ip: string
    ): Promise<boolean> => {

      // Evita conectar dos veces a la vez
      // (UDP y el escaneo pueden encontrarla juntos).
      if (
        connectingRef.current === ip
      ) {
        return false;
      }

      connectingRef.current =
        ip;

      try {

        await registerWithDesktop(
          ip
        );

        discoveredPCRef.current =
          ip;

        lastPCRef.current =
          ip;

        pollFailuresRef.current =
          0;

        await pollDevices(
          ip
        );

        setScanning(false);

        startHeartbeat(
          ip
        );

        startDevicePolling(
          ip
        );

        startIncomingPolling(
          ip
        );

        return true;

      } catch (error) {

        console.log(
          'No se pudo conectar:',
          error
        );

        if (
          discoveredPCRef.current === ip
        ) {
          discoveredPCRef.current =
            null;
        }

        return false;

      } finally {

        connectingRef.current =
          null;

      }

    };


  // ============================================================
  // DESCONECTAR (PC perdida o sin Wi-Fi)
  // ============================================================

  const stopIntervals =
    () => {

      for (
        const ref of [
          heartbeatRef,
          pollRef,
          incomingRef,
        ]
      ) {

        if (ref.current) {

          clearInterval(
            ref.current
          );

          ref.current =
            null;

        }

      }

    };

  const disconnectFromDesktop =
    () => {

      stopIntervals();

      discoveredPCRef.current =
        null;

      pollFailuresRef.current =
        0;

      setDevices([]);

      setScanning(true);

    };


  // ============================================================
  // HEARTBEAT
  // ============================================================

  const startHeartbeat =
    (
      ip: string
    ) => {

      if (
        heartbeatRef.current
      ) {

        clearInterval(
          heartbeatRef.current
        );

      }

      heartbeatRef.current =
        setInterval(
          () => {

            registerWithDesktop(
              ip
            ).catch(
              () => {}
            );

          },
          HEARTBEAT_INTERVAL
        );

    };


  // ============================================================
  // POLLING DISPOSITIVOS
  // ============================================================

  const startDevicePolling =
    (
      ip: string
    ) => {

      if (
        pollRef.current
      ) {

        clearInterval(
          pollRef.current
        );

      }

      pollRef.current =
        setInterval(
          () => {

            pollDevices(
              ip
            );

          },
          2000
        );

    };


  // ============================================================
  // POLLING ARCHIVOS
  // ============================================================

  const startIncomingPolling =
    (
      ip: string
    ) => {

      if (
        incomingRef.current
      ) {

        clearInterval(
          incomingRef.current
        );

      }

      incomingRef.current =
        setInterval(
          () => {

            checkIncoming(
              ip
            );

          },
          2000
        );

    };


  // ============================================================
  // INICIAR DISCOVERY AUTOMÁTICO
  // ============================================================

  useEffect(() => {

    if (!isConnected) {
      return;
    }

    discoverDesktop();

    discoveryRef.current =
      setInterval(
        discoverDesktop,
        DISCOVERY_INTERVAL
      );

    return () => {

      if (
        discoveryRef.current
      ) {

        clearInterval(
          discoveryRef.current
        );

      }

    };

  }, [isConnected]);


  // ============================================================
  // LIMPIEZA
  // ============================================================

  useEffect(() => {

    return () => {

      if (
        discoveryRef.current
      ) {
        clearInterval(
          discoveryRef.current
        );
      }

      stopIntervals();

      activeTaskRef.current?.cancel();

    };

  }, []);


  // ============================================================
  // OBTENER DISPOSITIVOS
  // ============================================================

  const pollDevices =
    async (
      ip: string
    ) => {

      try {

        const response =
          await fetchWithTimeout(
            `http://${ip}:${WS_PORT}/devices`,
            {},
            3000
          );

        if (!response.ok) {
          return;
        }

        const list: Device[] =
          await response.json();

        pollFailuresRef.current =
          0;

        // Solo mostramos PCs: a otro celular no se le
        // puede enviar (no tiene servidor).
        // Y usamos la IP con la que YA estamos conectados:
        // es la que seguro funciona, aunque la PC tenga
        // varios adaptadores de red.
        setDevices(
          list
            .filter(
              device =>
                device.deviceType === 'desktop'
            )
            .map(
              device => ({
                ...device,
                ip,
              })
            )
        );

      } catch {

        // Durante una transferencia el Wi-Fi está saturado
        // y es normal que esto tarde: no desconectamos.
        if (activeTaskRef.current) {
          return;
        }

        // Toleramos alguna falla suelta.
        pollFailuresRef.current += 1;

        if (
          pollFailuresRef.current >=
          MAX_POLL_FAILURES
        ) {

          console.log(
            '📴 PC perdida:',
            ip
          );

          // Volvemos a discovery.
          disconnectFromDesktop();

        }

      }

    };


  // ============================================================
  // ARCHIVOS ENTRANTES
  // ============================================================

  const checkIncoming =
    async (
      ip: string
    ) => {

      // Uno a la vez.
      if (activeTaskRef.current) {
        return;
      }

      try {

        const response =
          await fetchWithTimeout(
            `http://${ip}:${WS_PORT}/incoming`,
            {},
            1500
          );

        if (!response.ok) {
          return;
        }

        const list: IncomingFile[] =
          await response.json();

        const item =
          list.find(
            file =>
              !downloadingIds.current.has(file.id) &&
              !failedIds.current.has(file.id)
          );

        if (item) {

          downloadIncoming(
            ip,
            item
          );

        }

      } catch {

        // No hacemos nada.
        // El siguiente polling volverá a intentar.

      }

    };


  // ============================================================
  // PROGRESO + WATCHDOG
  // ============================================================
  //
  // - Actualiza la barra como máximo cada PROGRESS_INTERVAL.
  // - Calcula velocidad (MB/s) y tiempo restante.
  // - Si no hay avance en STALL_TIMEOUT, cancela la tarea con
  //   un motivo claro (la conexión quedó colgada).

  const trackTransfer =
    (
      // Bytes que ya había (al reanudar), para que la
      // velocidad no salga inflada.
      startBytes = 0
    ) => {

      const startedAt =
        Date.now();

      let lastEmit =
        0;

      let lastBytes =
        -1;

      lastProgressAtRef.current =
        startedAt;

      cancelReasonRef.current =
        null;

      const watchdog =
        setInterval(
          () => {

            if (
              activeTaskRef.current &&
              Date.now() - lastProgressAtRef.current >
              STALL_TIMEOUT
            ) {

              cancelReasonRef.current =
                `La transferencia se quedó trabada ${STALL_TIMEOUT / 1000} segundos sin avanzar: se perdió la conexión con la PC (puede que el Wi-Fi esté muy débil o que la PC se haya suspendido).`;

              activeTaskRef.current.cancel();

            }

          },
          2000
        );

      const onProgress =
        (
          bytes: number,
          total: number
        ) => {

          const now =
            Date.now();

          if (bytes !== lastBytes) {

            lastBytes =
              bytes;

            lastProgressAtRef.current =
              now;

          }

          if (
            now - lastEmit <
            PROGRESS_INTERVAL
          ) {
            return;
          }

          lastEmit =
            now;

          const speed =
            Math.max(0, bytes - startBytes) /
            Math.max(
              0.001,
              (now - startedAt) / 1000
            );

          setTransfer(
            prev => {

              if (
                !prev ||
                prev.status !== 'active'
              ) {
                return prev;
              }

              const realTotal =
                total > 0
                  ? total
                  : prev.total;

              return {
                ...prev,
                bytes,
                total:
                  realTotal,
                speed,
                eta:
                  speed > 0 && realTotal > 0
                    ? Math.max(0, Math.round((realTotal - bytes) / speed))
                    : null,
              };

            }
          );

        };

      const stop =
        () => {

          clearInterval(
            watchdog
          );

          activeTaskRef.current =
            null;

        };

      return {
        onProgress,
        stop,
      };

    };


  // ============================================================
  // DIAGNÓSTICO DE ERRORES
  // ============================================================
  //
  // En vez de mostrar el error técnico, revisamos qué pasó
  // realmente: ¿hay Wi-Fi? ¿están en la misma red? ¿la PC
  // responde? Así el mensaje dice la causa concreta.

  const diagnoseProblem =
    async (
      pcIP: string | undefined,
      error?: any
    ): Promise<string> => {

      // 1) ¿El celular tiene Wi-Fi?
      const state =
        await NetInfo.fetch();

      if (
        !state.isConnected ||
        state.type !== 'wifi'
      ) {

        return state.type === 'cellular'
          ? 'El celular está usando datos móviles, no Wi-Fi. Conectalo a la misma red Wi-Fi que la PC.'
          : 'El celular no tiene conexión Wi-Fi. Conectalo a la misma red que la PC.';

      }

      const phoneIP =
        (state.details as any)?.ipAddress as string | undefined;

      // 2) ¿Están en la misma red?
      if (
        phoneIP &&
        pcIP &&
        phoneIP.split('.').slice(0, 3).join('.') !==
          pcIP.split('.').slice(0, 3).join('.')
      ) {

        return `El celular y la PC no están en la misma red Wi-Fi (celular: ${phoneIP}, PC: ${pcIP}). Conectá los dos a la misma red.`;

      }

      // 3) ¿La PC responde?
      if (
        pcIP &&
        !(await testDesktop(pcIP))
      ) {

        return 'La PC no responde. Puede que se haya cerrado la app de escritorio, que la PC se haya suspendido o que el Firewall de Windows esté bloqueando la conexión.';

      }

      // 4) La red está bien: el problema fue durante la transferencia.
      return describeError(
        error
      );

    };


  // Marca la transferencia como fallida SIN borrar
  // el progreso: queda en el % en que se cortó.
  const failTransfer =
    async (
      error: any,
      pcIP?: string,
      canResume = false
    ) => {

      // Si el motivo ya se sabe (sin Wi-Fi, trabada, archivo
      // ilegible...) lo usamos; si no, diagnosticamos la red.
      const message =
        cancelReasonRef.current ??
        (error instanceof FileAccessError
          ? error.message
          : await diagnoseProblem(pcIP, error));

      cancelReasonRef.current =
        null;

      setTransfer(
        prev =>
          prev
            ? {
                ...prev,
                status: 'error',
                speed: 0,
                eta: null,
                message,
                canResume,
              }
            : prev
      );

    };


  // ============================================================
  // NOMBRE ÚNICO (Mantener ambos)
  // ============================================================

  const getUniqueDestination =
    (
      fileName: string
    ) => {

      const safeName =
        fileName.replace(
          /[\\/:*?"<>|]/g,
          '_'
        );

      let destination =
        new File(
          Paths.document,
          safeName
        );

      const dot =
        safeName.lastIndexOf('.');

      const base =
        dot > 0
          ? safeName.slice(0, dot)
          : safeName;

      const ext =
        dot > 0
          ? safeName.slice(dot)
          : '';

      let i = 1;

      while (destination.exists) {

        destination =
          new File(
            Paths.document,
            `${base} (${i})${ext}`
          );

        i++;

      }

      return destination;

    };


  // ============================================================
  // GUARDAR EN EL CELULAR (carpeta elegida por el usuario)
  // ============================================================
  //
  // Los archivos recibidos llegan a la carpeta privada de la
  // app. "Guardar" los copia a una carpeta pública del
  // celular (ej: Descargas) que el usuario elige UNA vez.
  // La copia es por streams: no carga el archivo en RAM.

  const pickSaveDirectory =
    async (): Promise<Directory | null> => {

      try {

        const directory =
          await Directory.pickDirectoryAsync();

        saveDirRef.current =
          directory;

        setSaveDirName(
          directory.name
        );

        writeConfig({
          ...readConfig(),
          saveDirUri:
            directory.uri,
        });

        return directory;

      } catch {

        // El usuario cerró el selector sin elegir.
        return null;

      }

    };

  const saveToDevice =
    async (
      item: ReceivedFile
    ) => {

      const source =
        new File(
          item.uri
        );

      if (!source.exists) {

        Alert.alert(
          '❌ No se pudo guardar',
          'El archivo ya no está en la app (puede que se haya borrado). Pedile a la PC que lo vuelva a enviar.'
        );

        return;

      }

      const mimeType =
        item.mimeType ??
        mimeFromName(item.name);

      // ==================================================
      // FOTOS Y VIDEOS → GALERÍA
      // ==================================================
      //
      // Es lo que espera cualquier usuario: que aparezca en
      // la Galería. Solo pide permiso de ESCRITURA (no puede
      // ver tus otras fotos).
      if (
        /^(image|video)\//.test(mimeType)
      ) {

        try {

          const permission =
            await MediaLibrary.requestPermissionsAsync(
              true
            );

          if (!permission.granted) {

            Alert.alert(
              '🔒 Falta permiso',
              'Para guardar en la Galería, permití el acceso a fotos y videos cuando el celular lo pregunte. Si lo rechazaste, activalo en Ajustes → Apps → Expo Go → Permisos.'
            );

            return;

          }

          await MediaLibrary.saveToLibraryAsync(
            item.uri
          );

          setReceived(
            prev =>
              prev.map(
                file =>
                  file.id === item.id
                    ? {
                        ...file,
                        savedTo:
                          'la Galería',
                      }
                    : file
              )
          );

          Alert.alert(
            '✅ Guardado en la Galería',
            `"${item.name}" ya está en la Galería del celular.`
          );

          return;

        } catch (error) {

          // Si la Galería falla, seguimos con la carpeta.
          console.log(
            'No se pudo guardar en la Galería:',
            error
          );

        }

      }

      // ==================================================
      // OTROS ARCHIVOS → CARPETA ELEGIDA
      // ==================================================

      let directory =
        saveDirRef.current;

      if (!directory) {

        Alert.alert(
          '📁 Elegí dónde guardar',
          'Se va a abrir el selector de carpetas.\n\nOjo: Android NO deja elegir "Descargas" directamente. Entrá a Descargas, tocá "Crear carpeta" (por ejemplo "LocalSend") y elegí esa. Se usa siempre; podés cambiarla después.',
          [
            {
              text: 'Cancelar',
              style: 'cancel',
            },
            {
              text: 'Elegir carpeta',
              onPress:
                async () => {

                  const picked =
                    await pickSaveDirectory();

                  if (picked) {
                    saveToDevice(item);
                  }

                },
            },
          ]
        );

        return;

      }

      try {

        // createFile respeta el nombre; si ya existe,
        // Android lo renombra a "nombre (1).ext".
        try {

          // createFile respeta el nombre; si ya existe,
          // Android lo renombra a "nombre (1).ext".
          const target =
            directory.createFile(
              item.name,
              mimeType
            );

          await source.copy(
            target,
            {
              overwrite: true,
            }
          );

        } catch (firstError) {

          console.log(
            'createFile + copy falló, copio a la carpeta:',
            firstError
          );

          // Alternativa: copiar directo dentro de la carpeta.
          await source.copy(
            directory
          );

        }

        setReceived(
          prev =>
            prev.map(
              file =>
                file.id === item.id
                  ? {
                      ...file,
                      savedTo:
                        directory?.name ?? 'la carpeta elegida',
                    }
                  : file
            )
        );

        Alert.alert(
          '✅ Guardado',
          `"${item.name}" se guardó en la carpeta "${directory.name}" del celular.`
        );

      } catch (error: any) {

        console.log(
          'Error guardando:',
          error
        );

        // La carpeta ya no existe o se perdió el permiso:
        // pedimos elegirla de nuevo.
        saveDirRef.current =
          null;

        setSaveDirName(
          null
        );

        const raw =
          String(error?.message ?? '');

        Alert.alert(
          '❌ No se pudo guardar',
          /space|ENOSPC/i.test(raw)
            ? 'No hay espacio suficiente en el celular.'
            : /exist/i.test(raw)
              ? 'Ya hay un archivo con ese nombre en la carpeta y no se pudo reemplazar. Tocá "Guardar" de nuevo y elegí otra carpeta.'
              : /permission|denied|security/i.test(raw)
                ? 'La app perdió el permiso para escribir en esa carpeta. Tocá "Guardar" de nuevo y elegí la carpeta otra vez.'
                : `No se pudo escribir en la carpeta elegida (puede que se haya borrado). Tocá "Guardar" de nuevo y elegí otra carpeta.\n\nDetalle: ${raw}`
        );

      }

    };

  const shareFile =
    async (
      item: ReceivedFile
    ) => {

      try {

        await Sharing.shareAsync(
          item.uri,
          {
            mimeType:
              item.mimeType ??
              mimeFromName(item.name),
            dialogTitle:
              'Abrir con...',
          }
        );

      } catch {

        Alert.alert(
          '❌ Error',
          'No hay ninguna app instalada que pueda abrir este archivo.'
        );

      }

    };


  // ============================================================
  // DESCARGAR ARCHIVO (PC → celular)
  // ============================================================

  const downloadIncoming =
    async (
      ip: string,
      item: IncomingFile
    ) => {

      downloadingIds.current.add(
        item.id
      );

      failedIds.current.delete(
        item.id
      );

      // ¿Quedó una parte de un intento anterior?
      const partialUri =
        partialDownloadsRef.current.get(
          item.id
        );

      const partial =
        partialUri
          ? new File(partialUri)
          : null;

      const resumeFrom =
        partial?.exists &&
        (partial.size ?? 0) > 0 &&
        (partial.size ?? 0) < item.fileSize
          ? partial.size ?? 0
          : 0;

      const destination =
        resumeFrom > 0 && partial
          ? partial
          : getUniqueDestination(
              item.fileName
            );

      setTransfer({
        direction: 'receive',
        status: 'active',
        fileName: item.fileName,
        bytes: resumeFrom,
        total: item.fileSize,
        speed: 0,
        eta: null,
        incoming: item,
        pcIP: ip,
      });

      const tracker =
        trackTransfer(
          resumeFrom
        );

      const url =
        `http://${ip}:${WS_PORT}/download/${item.id}`;

      const onProgress =
        ({
          bytesWritten,
          totalBytes,
        }: {
          bytesWritten: number;
          totalBytes: number;
        }) => {

          tracker.onProgress(
            bytesWritten,
            totalBytes
          );

        };

      try {

        let file: File | null;

        if (resumeFrom > 0) {

          // ==================================================
          // REANUDAR
          // ==================================================
          //
          // Le pedimos a la PC solo lo que falta
          // ("Range: bytes=<lo que ya tenemos>-") y se agrega
          // al final del archivo parcial.
          console.log(
            '⏯️ Reanudando desde',
            formatBytes(resumeFrom)
          );

          const task =
            DownloadTask.fromSavable(
              {
                url,
                fileUri:
                  destination.uri,
                isDirectory:
                  false,
                resumeData:
                  String(resumeFrom),
              },
              {
                onProgress,
              }
            );

          activeTaskRef.current =
            task;

          file =
            await task.resumeAsync();

        } else {

          // El archivo se escribe directo al disco a medida
          // que llega: nunca se carga completo en memoria.
          const task =
            File.createDownloadTask(
              url,
              destination,
              {
                onProgress,
              }
            );

          activeTaskRef.current =
            task;

          file =
            await task.downloadAsync();

        }

        if (!file) {

          throw new Error(
            'La descarga se interrumpió antes de terminar.'
          );

        }

        // PRUEBA DE INTEGRIDAD:
        // el peso tiene que ser exactamente el mismo.
        if (
          item.fileSize > 0 &&
          file.size !== item.fileSize
        ) {

          try {
            file.delete();
          } catch {}

          throw new FileAccessError(
            `El archivo llegó incompleto (${formatBytes(file.size ?? 0)} de ${formatBytes(item.fileSize)}): seguramente se cortó la conexión justo al final. Tocá "Reintentar".`
          );

        }

        console.log(
          '📥 Archivo recibido:',
          file.uri
        );

        partialDownloadsRef.current.delete(
          item.id
        );

        setTransfer(
          prev =>
            prev
              ? {
                  ...prev,
                  status: 'done',
                  bytes: item.fileSize,
                  eta: 0,
                }
              : prev
        );

        const receivedFile: ReceivedFile = {
          id: item.id,
          name: file.name,
          uri: file.uri,
          size: item.fileSize,
          // El tipo según la extensión: lo necesitan "Abrir"
          // (para elegir la app) y "Guardar".
          mimeType:
            file.type ||
            mimeFromName(file.name),
          receivedAt: Date.now(),
        };

        setReceived(
          prev => {

            const next =
              [
                receivedFile,
                ...prev,
              ].slice(0, 30);

            writeConfig({
              ...readConfig(),
              received: next,
            });

            return next;

          }
        );

        Alert.alert(

          '📥 Archivo recibido',

          `"${item.fileName}" (${formatBytes(item.fileSize)}) llegó completo.\n\n¿Querés guardarlo en el celular? (las fotos y videos van a la Galería)`,

          [

            {
              text: 'Más tarde',
              style: 'cancel',
            },

            {
              text: 'Guardar',
              onPress: () =>
                saveToDevice(
                  receivedFile
                ),
            },

          ]

        );

      } catch (
        error: any
      ) {

        console.log(
          '❌ Error descargando:',
          error
        );

        const raw =
          String(error?.message ?? '');

        // La PC ya no tiene el archivo (se cerró la app de
        // escritorio): no hay nada que reanudar.
        const goneFromPC =
          /HTTP 404|HTTP 416/.test(raw);

        // Si quedó una parte, la GUARDAMOS para reanudar.
        let partialSize = 0;

        try {
          partialSize =
            destination.exists
              ? destination.size ?? 0
              : 0;
        } catch {}

        const canResume =
          !goneFromPC &&
          !(error instanceof FileAccessError) &&
          partialSize > 0 &&
          partialSize < item.fileSize;

        if (canResume) {

          partialDownloadsRef.current.set(
            item.id,
            destination.uri
          );

        } else {

          partialDownloadsRef.current.delete(
            item.id
          );

          try {
            if (destination.exists) {
              destination.delete();
            }
          } catch {}

        }

        // No se reintenta solo: espera al usuario.
        failedIds.current.add(
          item.id
        );

        tracker.stop();

        await failTransfer(
          goneFromPC
            ? new FileAccessError(
                'La PC ya no tiene este archivo (seguramente se cerró o se reinició la app de escritorio). Volvé a enviarlo desde la PC.'
              )
            : error,
          ip,
          canResume
        );

      } finally {

        tracker.stop();

        downloadingIds.current.delete(
          item.id
        );

      }

    };


  // ============================================================
  // SELECCIONAR ARCHIVO
  // ============================================================

  const pickFile =
    async () => {

      try {

        // Usamos el selector de expo-file-system: devuelve el
        // archivo como content:// (Storage Access Framework).
        //
        // ¿Por qué no expo-document-picker? Porque copia el
        // archivo a cache/DocumentPicker/ y Expo Go no deja
        // leer esa carpeta ("Location ... isn't readable").
        // Además, sin copia no se duplica un video de 500 MB.
        const result =
          await File.pickFileAsync();

        if (
          result.canceled ||
          !result.result
        ) {

          return;

        }

        const file =
          result.result;

        if (!file.exists) {

          throw new FileAccessError(
            'No se pudo leer el archivo elegido. Si está en Google Drive u otra nube, descargalo primero al celular y volvé a elegirlo.'
          );

        }

        const size =
          file.size ??
          0;

        if (size === 0) {

          throw new FileAccessError(
            'El archivo elegido está vacío (0 bytes) o es de una nube que no lo descargó. Elegí otro.'
          );

        }

        const name =
          ensureExtension(
            file.name,
            file.type
          );

        setSelectedFile({

          name,

          uri:
            file.uri,

          size,

          mimeType:
            file.type ||
            mimeFromName(name),

        });

      } catch (
        error: any
      ) {

        console.log(
          'Error seleccionando:',
          error
        );

        const raw =
          String(error?.message ?? '');

        Alert.alert(

          '❌ No se pudo usar ese archivo',

          error instanceof FileAccessError
            ? error.message
            : /space|ENOSPC/i.test(raw)
              ? 'No hay espacio suficiente en el celular para preparar el archivo.'
              : 'No se pudo abrir el archivo elegido. Probá elegirlo desde otra carpeta (por ejemplo "Descargas" o la Galería).'

        );

      }

    };


  // ============================================================
  // ENVIAR ARCHIVO (celular → PC)
  // ============================================================

  const startUpload =
    async (
      device: Device,
      fileToSend: SelectedFile
    ) => {

      const pcIP =
        discoveredPCRef.current ??
        device.ip;

      setTransfer({
        direction: 'send',
        status: 'active',
        fileName: fileToSend.name,
        bytes: 0,
        total: fileToSend.size,
        speed: 0,
        eta: null,
        device,
        pcIP,
        thumbnailUri:
          fileToSend.mimeType.startsWith('image/')
            ? fileToSend.uri
            : undefined,
      });

      const tracker =
        trackTransfer();

      try {

        const file =
          new File(
            fileToSend.uri
          );

        if (!file.exists) {

          throw new FileAccessError(
            'El archivo ya no está en el celular (se borró o se movió). Seleccionalo de nuevo.'
          );

        }

        // Antes de empezar, confirmamos que la PC responde
        // para dar un error claro y no quedarnos esperando.
        if (!(await testDesktop(pcIP))) {

          throw new Error(
            'PC sin respuesta'
          );

        }

        const uploadUrl =
          `http://${pcIP}:${device.port || WS_PORT}/upload?fileName=` +
          encodeURIComponent(
            fileToSend.name
          ) +
          `&size=${file.size ?? fileToSend.size}`;

        console.log(
          '📤 Enviando',
          fileToSend.name,
          '→',
          uploadUrl
        );

        // Subida BINARIA y por partes desde el lado nativo:
        // no usa base64 ni carga 500 MB en RAM.
        const task =
          file.createUploadTask(

            uploadUrl,

            {
              httpMethod:
                'POST',

              // 0 = BINARY_CONTENT (el archivo tal cual)
              uploadType:
                0,

              mimeType:
                fileToSend.mimeType,

              headers: {
                'Content-Type':
                  fileToSend.mimeType,
              },

              onProgress:
                ({
                  bytesSent,
                  totalBytes,
                }) => {

                  tracker.onProgress(
                    bytesSent,
                    totalBytes
                  );

                },
            }

          );

        activeTaskRef.current =
          task;

        const result =
          await task.uploadAsync();

        if (
          result.status < 200 ||
          result.status >= 300
        ) {

          // La PC explica el motivo en el JSON.
          let reason =
            `La PC rechazó el archivo (código ${result.status}).`;

          try {

            const body =
              JSON.parse(
                result.body
              );

            if (body?.error) {
              reason =
                `La PC rechazó el archivo: ${body.error}`;
            }

          } catch {}

          throw new FileAccessError(
            reason
          );

        }

        setTransfer(
          prev =>
            prev
              ? {
                  ...prev,
                  status: 'done',
                  bytes: fileToSend.size,
                  eta: 0,
                }
              : prev
        );

        setSelectedFile(
          null
        );

      } catch (
        error: any
      ) {

        console.log(
          '❌ ERROR AL ENVIAR',
          error
        );

        tracker.stop();

        // El archivo seleccionado se mantiene
        // para poder reintentar.
        await failTransfer(
          error,
          pcIP
        );

      } finally {

        tracker.stop();

      }

    };


  // ============================================================
  // BOTÓN ENVIAR
  // ============================================================

  const sendFile =
    (device: Device) => {

      if (!selectedFile) {

        Alert.alert(

          '📂 Seleccionar archivo',

          'Primero seleccioná el archivo que querés enviar.'

        );

        return;

      }

      if (activeTaskRef.current) {

        Alert.alert(
          '⏳ Transferencia en curso',
          'Esperá a que termine la transferencia actual.'
        );

        return;

      }

      const fileToSend =
        selectedFile;

      Alert.alert(

        '📤 Confirmar envío',

        `¿Enviar "${fileToSend.name}" (${formatBytes(fileToSend.size)}) a ${device.alias}?`,

        [

          {
            text:
              'Cancelar',

            style:
              'cancel',

          },

          {

            text:
              'Enviar',

            onPress:
              () => {

                startUpload(
                  device,
                  fileToSend
                );

              },

          },

        ]

      );

    };


  // ============================================================
  // REINTENTAR / CERRAR
  // ============================================================

  const retryTransfer =
    () => {

      if (!transfer) {
        return;
      }

      if (
        transfer.direction === 'send'
      ) {

        if (
          !selectedFile ||
          !transfer.device
        ) {

          Alert.alert(
            'No se puede reintentar',
            'Volvé a seleccionar el archivo.'
          );

          return;

        }

        // Usamos la IP actual de la PC por si cambió.
        const device =
          devices.find(
            d =>
              d.alias === transfer.device?.alias
          ) ??
          transfer.device;

        startUpload(
          device,
          selectedFile
        );

        return;

      }

      if (
        transfer.incoming
      ) {

        const ip =
          discoveredPCRef.current ??
          transfer.pcIP;

        if (!ip) {

          Alert.alert(
            'Sin conexión',
            'Todavía no se encontró la PC. Esperá a que aparezca en la lista.'
          );

          return;

        }

        downloadIncoming(
          ip,
          transfer.incoming
        );

      }

    };

  const closeTransfer =
    () => {

      // Si se descarta una recepción fallida,
      // le avisamos a la PC para que la saque de la cola.
      if (
        transfer?.status === 'error' &&
        transfer.direction === 'receive' &&
        transfer.incoming
      ) {

        const partialUri =
          partialDownloadsRef.current.get(
            transfer.incoming.id
          );

        if (partialUri) {

          try {
            new File(partialUri).delete();
          } catch {}

          partialDownloadsRef.current.delete(
            transfer.incoming.id
          );

        }

        const ip =
          discoveredPCRef.current ??
          transfer.pcIP;

        if (ip) {

          fetchWithTimeout(
            `http://${ip}:${WS_PORT}/discard/${transfer.incoming.id}`,
            {
              method: 'POST',
            },
            1500
          ).catch(
            () => {}
          );

        }

      }

      setTransfer(
        null
      );

    };


  // ============================================================
  // CONEXIÓN MANUAL
  // ============================================================

  const connectManually =
    () => {

      setIpInput('');
      setModalVisible(true);

    };


  const handleConnect =
    async () => {

      const targetIP =
        ipInput.trim();

      if (
        !/^\d{1,3}(\.\d{1,3}){3}$/.test(
          targetIP
        )
      ) {

        Alert.alert(
          'Error',
          'Ingresá una IP válida (ej: 192.168.0.10).'
        );

        return;

      }

      setModalVisible(false);

      const ok =
        await connectToDesktop(
          targetIP
        );

      if (ok) {

        Alert.alert(
          '✅ Conectado',
          `PC encontrada en ${targetIP}`
        );

      } else {

        Alert.alert(
          '❌ Error',
          `No se pudo conectar con ${targetIP}.\n\nVerificá que la app de escritorio esté abierta, que estén en la misma red Wi-Fi y que el Firewall de Windows permita la conexión.`
        );

      }

    };


  // ============================================================
  // LOADING
  // ============================================================

  if (loading) {

    return (

      <ThemedView
        style={
          styles.loadingContainer
        }
      >

        <ActivityIndicator
          size="large"
          color={palette.accent}
        />

      </ThemedView>

    );

  }


  // ============================================================
  // UI
  // ============================================================

  const transferPercent =
    transfer && transfer.total > 0
      ? Math.min(
          100,
          Math.floor(
            (transfer.bytes / transfer.total) * 100
          )
        )
      : 0;

  const transferColor =
    transfer?.status === 'error'
      ? palette.err
      : transfer?.status === 'done'
        ? palette.ok
        : palette.accent;

  const connectedPC =
    devices.find(
      d =>
        d.ip === discoveredPCRef.current
    );

  const statusText =
    !isConnected
      ? 'Sin Wi-Fi'
      : scanning
        ? 'Buscando PC...'
        : `Conectado a ${connectedPC?.alias ?? 'la PC'}`;

  const statusColor =
    !isConnected
      ? palette.err
      : scanning
        ? palette.warn
        : palette.ok;

  return (

    <View
      style={[
        styles.container,
        {
          backgroundColor:
            palette.bg,
        },
      ]}
    >

      {/* La pantalla entera es scrolleable. Los márgenes
          vienen de los insets (barra de estado y pestañas). */}
      <ScrollView
        style={
          styles.container
        }
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop:
              insets.top +
              Spacing.three,
            paddingBottom:
              insets.bottom +
              BottomTabInset +
              Spacing.four,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >

          {/* HEADER */}

          <View
            style={
              styles.header
            }
          >

            <View
              style={[
                styles.logo,
                {
                  backgroundColor:
                    palette.accent,
                },
              ]}
            >
              <ThemedText
                style={
                  styles.logoText
                }
              >
                📡
              </ThemedText>
            </View>

            <View
              style={
                styles.headerText
              }
            >

              <ThemedText
                style={
                  styles.appTitle
                }
              >
                LocalSend
              </ThemedText>

              <ThemedText
                type="small"
                themeColor="textSecondary"
                numberOfLines={1}
              >
                {DEVICE_ALIAS}
              </ThemedText>

            </View>

            <TouchableOpacity
              onPress={
                connectManually
              }
              style={[
                styles.iconButton,
                {
                  backgroundColor:
                    palette.surface,
                  borderColor:
                    palette.border,
                },
              ]}
            >
              <ThemedText>
                🔗
              </ThemedText>
            </TouchableOpacity>

          </View>


          {/* ESTADO */}

          <View
            style={[
              styles.statusPill,
              {
                backgroundColor:
                  palette.surface,
                borderColor:
                  palette.border,
              },
            ]}
          >

            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor:
                    statusColor,
                },
              ]}
            />

            <ThemedText
              type="small"
              style={{
                fontWeight: '600',
              }}
            >
              {statusText}
            </ThemedText>

          </View>


          {/* PASO 1: ARCHIVO */}

          <View
            style={[
              styles.card,
              {
                backgroundColor:
                  palette.surface,
                borderColor:
                  palette.border,
              },
            ]}
          >

            <View
              style={
                styles.cardTitleRow
              }
            >

              <View
                style={[
                  styles.step,
                  {
                    backgroundColor:
                      palette.accentSoft,
                  },
                ]}
              >
                <ThemedText
                  style={[
                    styles.stepText,
                    {
                      color:
                        palette.accent,
                    },
                  ]}
                >
                  1
                </ThemedText>
              </View>

              <ThemedText
                style={
                  styles.cardTitle
                }
              >
                Elegí un archivo
              </ThemedText>

            </View>

            <TouchableOpacity
              onPress={
                pickFile
              }
              activeOpacity={0.7}
              style={[
                styles.filePicker,
                {
                  borderColor:
                    selectedFile
                      ? palette.ok
                      : palette.border,
                  borderStyle:
                    selectedFile
                      ? 'solid'
                      : 'dashed',
                  backgroundColor:
                    selectedFile
                      ? palette.okSoft
                      : 'transparent',
                },
              ]}
            >

              {selectedFile?.mimeType.startsWith('image/') ? (

                <Image
                  source={{
                    uri:
                      selectedFile.uri,
                  }}
                  style={
                    styles.preview
                  }
                  contentFit="cover"
                />

              ) : (

                <ThemedText
                  style={
                    styles.fileIcon
                  }
                >
                  {selectedFile
                    ? '📄'
                    : '📂'}
                </ThemedText>

              )}

              {selectedFile ? (

                <>

                  <ThemedText
                    numberOfLines={2}
                    style={{
                      fontWeight: '600',
                      textAlign: 'center',
                    }}
                  >

                    {selectedFile.name}

                  </ThemedText>

                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                  >

                    {formatBytes(
                      selectedFile.size
                    )} · tocá para cambiarlo

                  </ThemedText>

                </>

              ) : (

                <>

                  <ThemedText
                    style={{
                      fontWeight: '600',
                    }}
                  >
                    Tocá para seleccionar
                  </ThemedText>

                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                  >
                    Fotos, videos o documentos
                  </ThemedText>

                </>

              )}

            </TouchableOpacity>

          </View>


          {/* TRANSFERENCIA (envío o recepción) */}

          {transfer && (

            <View
              style={[
                styles.card,
                {
                  backgroundColor:
                    palette.surface,
                  borderColor:
                    transferColor,
                },
              ]}
            >

              <View
                style={
                  styles.transferRow
                }
              >

                {transfer.thumbnailUri ? (

                  <Image
                    source={{
                      uri:
                        transfer.thumbnailUri,
                    }}
                    style={
                      styles.thumbnail
                    }
                    contentFit="cover"
                  />

                ) : (

                  <View
                    style={[
                      styles.thumbnail,
                      styles.thumbnailIcon,
                      {
                        backgroundColor:
                          palette.accentSoft,
                      },
                    ]}
                  >
                    <ThemedText>
                      {transfer.status === 'done'
                        ? '✅'
                        : transfer.status === 'error'
                          ? '⚠️'
                          : transfer.direction === 'send'
                            ? '📤'
                            : '📥'}
                    </ThemedText>
                  </View>

                )}

                <View
                  style={
                    styles.transferInfo
                  }
                >

                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                  >

                    {transfer.direction === 'send'
                      ? 'Enviando a la PC'
                      : 'Recibiendo de la PC'}

                  </ThemedText>

                  <ThemedText
                    numberOfLines={1}
                    style={{
                      fontWeight: '600',
                    }}
                  >

                    {transfer.fileName}

                  </ThemedText>

                </View>

                <ThemedText
                  style={
                    styles.percent
                  }
                >

                  {transfer.status === 'done'
                    ? 100
                    : transferPercent}%

                </ThemedText>

              </View>

              <View
                style={[
                  styles.progressBackground,
                  {
                    backgroundColor:
                      palette.track,
                  },
                ]}
              >

                <View
                  style={[
                    styles.progressFill,
                    {
                      width:
                        `${transfer.status === 'done' ? 100 : transferPercent}%`,
                      backgroundColor:
                        transferColor,
                    },
                  ]}
                />

              </View>

              {transfer.status === 'active' && (

                <View
                  style={
                    styles.statsRow
                  }
                >

                  {[
                    ['Transferido', `${formatBytes(transfer.bytes)}\nde ${formatBytes(transfer.total)}`],
                    ['Velocidad', `${(transfer.speed / (1024 * 1024)).toFixed(1)} MB/s`],
                    ['Falta', formatEta(transfer.eta)],
                  ].map(([label, value]) => (

                    <View
                      key={label}
                      style={[
                        styles.stat,
                        {
                          backgroundColor:
                            palette.surface2,
                        },
                      ]}
                    >

                      <ThemedText
                        style={[
                          styles.statLabel,
                          {
                            color:
                              palette.textSecondary,
                          },
                        ]}
                      >
                        {label}
                      </ThemedText>

                      <ThemedText
                        style={
                          styles.statValue
                        }
                      >
                        {value}
                      </ThemedText>

                    </View>

                  ))}

                </View>

              )}

              {transfer.status === 'done' && (

                <ThemedText
                  type="small"
                  style={{
                    color: palette.ok,
                    fontWeight: '600',
                  }}
                >

                  Completado ({formatBytes(transfer.total)})

                </ThemedText>

              )}

              {transfer.status === 'error' && (

                <View
                  style={[
                    styles.errorBox,
                    {
                      backgroundColor:
                        palette.errSoft,
                    },
                  ]}
                >

                  <ThemedText
                    type="small"
                    style={{
                      color: palette.err,
                      fontWeight: '600',
                    }}
                  >

                    {transfer.message}

                  </ThemedText>

                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                  >

                    {transfer.canResume
                      ? `Se cortó en ${transferPercent}% (${formatBytes(transfer.bytes)} de ${formatBytes(transfer.total)}). Lo recibido quedó guardado: tocá "Reanudar" y sigue desde ahí, sin empezar de cero.`
                      : `Se cortó en ${transferPercent}% (${formatBytes(transfer.bytes)} de ${formatBytes(transfer.total)}). Al reintentar empieza desde el principio.`}

                  </ThemedText>

                </View>

              )}

              {transfer.status !== 'active' && (

                <View
                  style={
                    styles.transferButtons
                  }
                >

                  <TouchableOpacity
                    onPress={
                      closeTransfer
                    }
                    style={[
                      styles.secondaryButton,
                      {
                        borderColor:
                          palette.border,
                      },
                    ]}
                  >

                    <ThemedText
                      style={{
                        fontWeight: '600',
                      }}
                    >
                      {transfer.status === 'error' &&
                      transfer.direction === 'receive'
                        ? 'Descartar'
                        : 'Cerrar'}
                    </ThemedText>

                  </TouchableOpacity>

                  {transfer.status === 'error' && (

                    <TouchableOpacity
                      onPress={
                        retryTransfer
                      }
                      style={[
                        styles.primaryButton,
                        {
                          backgroundColor:
                            palette.accent,
                        },
                      ]}
                    >

                      <ThemedText
                        style={{
                          color: '#fff',
                          fontWeight: '600',
                        }}
                      >
                        {transfer.canResume
                          ? `Reanudar (${transferPercent}%)`
                          : 'Reintentar'}
                      </ThemedText>

                    </TouchableOpacity>

                  )}

                </View>

              )}

            </View>

          )}


          {/* PASO 2: DISPOSITIVO */}

          <View
            style={[
              styles.card,
              {
                backgroundColor:
                  palette.surface,
                borderColor:
                  palette.border,
              },
            ]}
          >

            <View
              style={
                styles.cardTitleRow
              }
            >

              <View
                style={[
                  styles.step,
                  {
                    backgroundColor:
                      palette.accentSoft,
                  },
                ]}
              >
                <ThemedText
                  style={[
                    styles.stepText,
                    {
                      color:
                        palette.accent,
                    },
                  ]}
                >
                  2
                </ThemedText>
              </View>

              <ThemedText
                style={
                  styles.cardTitle
                }
              >
                Tocá la PC para enviar
              </ThemedText>

            </View>

            {devices.length === 0 ? (

              <View
                style={
                  styles.emptyContainer
                }
              >

                {isConnected && (

                  <Animated.View
                    style={[
                      styles.radar,
                      {
                        borderColor:
                          palette.accent,
                        backgroundColor:
                          palette.accentSoft,
                        transform: [
                          {
                            scale:
                              pulseAnim,
                          },
                        ],
                      },
                    ]}
                  >
                    <ThemedText
                      style={
                        styles.radarIcon
                      }
                    >
                      🖥️
                    </ThemedText>
                  </Animated.View>

                )}

                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  style={{
                    textAlign: 'center',
                  }}
                >

                  {isConnected
                    ? 'Buscando la PC en la red...\nAbrí LocalSend en la compu (mismo Wi-Fi).'
                    : 'Conectá el celular a una red Wi-Fi.'}

                </ThemedText>

              </View>

            ) : (

              devices.map(item => (

                <TouchableOpacity

                  key={
                    `${item.deviceType}-${item.alias}`
                  }

                  activeOpacity={0.7}

                  style={[
                    styles.deviceCard,
                    {
                      backgroundColor:
                        palette.surface2,
                      borderColor:
                        selectedFile
                          ? palette.accent
                          : palette.border,
                    },
                  ]}

                  onPress={() =>
                    sendFile(item)
                  }

                >

                  <View
                    style={[
                      styles.deviceIconCircle,
                      {
                        backgroundColor:
                          palette.accentSoft,
                      },
                    ]}
                  >
                    <ThemedText
                      style={
                        styles.deviceIcon
                      }
                    >
                      🖥️
                    </ThemedText>
                  </View>

                  <View
                    style={
                      styles.deviceInfo
                    }
                  >

                    <ThemedText
                      style={{
                        fontWeight:
                          '600',
                      }}
                    >

                      {item.alias}

                    </ThemedText>

                    <ThemedText
                      type="small"
                      themeColor="textSecondary"
                    >

                      {item.ip}

                    </ThemedText>

                  </View>

                  {selectedFile && (

                    <View
                      style={[
                        styles.sendChip,
                        {
                          backgroundColor:
                            palette.accent,
                        },
                      ]}
                    >
                      <ThemedText
                        type="small"
                        style={{
                          color: '#fff',
                          fontWeight: '700',
                        }}
                      >
                        Enviar
                      </ThemedText>
                    </View>

                  )}

                </TouchableOpacity>

              ))

            )}

          </View>



          {/* PASO 3: RECIBIDOS */}

          <View
            style={[
              styles.card,
              {
                backgroundColor:
                  palette.surface,
                borderColor:
                  palette.border,
              },
            ]}
          >

            <View
              style={
                styles.cardTitleRow
              }
            >

              <View
                style={[
                  styles.step,
                  {
                    backgroundColor:
                      palette.accentSoft,
                  },
                ]}
              >
                <ThemedText
                  style={[
                    styles.stepText,
                    {
                      color:
                        palette.accent,
                    },
                  ]}
                >
                  3
                </ThemedText>
              </View>

              <ThemedText
                style={
                  styles.cardTitle
                }
              >
                Archivos recibidos
              </ThemedText>

            </View>

            <TouchableOpacity
              onPress={
                pickSaveDirectory
              }
            >
              <ThemedText
                type="small"
                themeColor="textSecondary"
              >
                🖼️ Fotos y videos → Galería · 📁 Otros →{' '}
                <ThemedText
                  type="small"
                  style={{
                    color: palette.accent,
                    fontWeight: '600',
                  }}
                >
                  {saveDirName ?? 'elegir carpeta'} (cambiar)
                </ThemedText>
              </ThemedText>
            </TouchableOpacity>

            {received.length === 0 ? (

              <ThemedText
                type="small"
                themeColor="textSecondary"
                style={{
                  textAlign: 'center',
                  paddingVertical: 12,
                }}
              >
                Todavía no recibiste nada. Lo que mandes desde la PC aparece acá.
              </ThemedText>

            ) : (

              received.map(item => (

                <View
                  key={item.id + item.uri}
                  style={[
                    styles.receivedRow,
                    {
                      backgroundColor:
                        palette.surface2,
                      borderColor:
                        palette.border,
                    },
                  ]}
                >

                  {item.mimeType?.startsWith('image/') ? (

                    <Image
                      source={{
                        uri:
                          item.uri,
                      }}
                      style={
                        styles.thumbnail
                      }
                      contentFit="cover"
                    />

                  ) : (

                    <View
                      style={[
                        styles.thumbnail,
                        styles.thumbnailIcon,
                        {
                          backgroundColor:
                            palette.accentSoft,
                        },
                      ]}
                    >
                      <ThemedText>
                        {item.mimeType?.startsWith('video/')
                          ? '🎬'
                          : item.mimeType?.startsWith('audio/')
                            ? '🎵'
                            : '📄'}
                      </ThemedText>
                    </View>

                  )}

                  <View
                    style={
                      styles.transferInfo
                    }
                  >

                    <ThemedText
                      numberOfLines={1}
                      style={{
                        fontWeight: '600',
                      }}
                    >
                      {item.name}
                    </ThemedText>

                    <ThemedText
                      type="small"
                      style={{
                        color:
                          item.savedTo
                            ? palette.ok
                            : palette.textSecondary,
                      }}
                    >
                      {formatBytes(item.size)}
                      {item.savedTo
                        ? ` · ✓ guardado en ${item.savedTo}`
                        : ' · sin guardar'}
                    </ThemedText>

                  </View>

                  <TouchableOpacity
                    onPress={() =>
                      shareFile(item)
                    }
                    style={[
                      styles.smallButton,
                      {
                        borderColor:
                          palette.border,
                      },
                    ]}
                  >
                    <ThemedText
                      type="small"
                      style={{
                        fontWeight: '600',
                      }}
                    >
                      Abrir
                    </ThemedText>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() =>
                      saveToDevice(item)
                    }
                    style={[
                      styles.smallButton,
                      {
                        backgroundColor:
                          palette.accent,
                        borderColor:
                          palette.accent,
                      },
                    ]}
                  >
                    <ThemedText
                      type="small"
                      style={{
                        color: '#fff',
                        fontWeight: '700',
                      }}
                    >
                      Guardar
                    </ThemedText>
                  </TouchableOpacity>

                </View>

              ))

            )}

          </View>

      </ScrollView>


      {/* MODAL */}

      <Modal
        visible={
          modalVisible
        }
        transparent
        animationType="fade"
        onRequestClose={() =>
          setModalVisible(false)
        }
      >

        <View
          style={
            styles.modalOverlay
          }
        >

          <View
            style={[
              styles.modalBox,
              {
                backgroundColor:
                  palette.surface,
              },
            ]}
          >

            <ThemedText
              style={
                styles.cardTitle
              }
            >

              Conectar a la PC manualmente

            </ThemedText>

            <ThemedText
              type="small"
              themeColor="textSecondary"
            >

              Usalo si la PC no aparece sola. La IP se ve arriba en la app de escritorio.

            </ThemedText>

            <TextInput

              value={
                ipInput
              }

              onChangeText={
                setIpInput
              }

              placeholder=
                "192.168.0.106"

              placeholderTextColor={
                palette.textSecondary
              }

              keyboardType=
                "numeric"

              style={[
                styles.modalInput,
                {
                  borderColor:
                    palette.border,
                  color:
                    palette.text,
                },
              ]}

            />

            <View
              style={
                styles.modalButtons
              }
            >

              <TouchableOpacity
                onPress={() =>
                  setModalVisible(false)
                }
                style={[
                  styles.secondaryButton,
                  {
                    borderColor:
                      palette.border,
                  },
                ]}
              >

                <ThemedText>
                  Cancelar
                </ThemedText>

              </TouchableOpacity>

              <TouchableOpacity
                onPress={
                  handleConnect
                }
                style={[
                  styles.primaryButton,
                  {
                    backgroundColor:
                      palette.accent,
                  },
                ]}
              >

                <ThemedText
                  style={{
                    color: '#fff',
                    fontWeight:
                      '600',
                  }}
                >

                  Conectar

                </ThemedText>

              </TouchableOpacity>

            </View>

          </View>

        </View>

      </Modal>

    </View>

  );

}


// ============================================================
// COLORES (modo claro / oscuro)
// ============================================================

const PALETTES = {

  light: {
    bg: '#f4f5fb',
    text: '#171a2c',
    textSecondary: '#5d6380',
    surface: '#ffffff',
    surface2: '#f7f8fc',
    border: '#e1e4f0',
    track: '#e6e8f2',
    accent: '#5b5bf0',
    accentSoft: '#e8e8ff',
    ok: '#16a34a',
    okSoft: '#e3f7ea',
    warn: '#d97706',
    err: '#dc2626',
    errSoft: '#fde8e8',
  },

  dark: {
    bg: '#0b0c12',
    text: '#eceef8',
    textSecondary: '#9499b5',
    surface: '#171925',
    surface2: '#1f2232',
    border: '#2a2d40',
    track: '#2a2d40',
    accent: '#7c7cff',
    accentSoft: '#23244a',
    ok: '#22c55e',
    okSoft: '#0f2a1a',
    warn: '#f59e0b',
    err: '#f87171',
    errSoft: '#2d1416',
  },

};


// ============================================================
// ESTILOS
// ============================================================

const styles =
  StyleSheet.create({

    container: {
      flex: 1,
    },

    loadingContainer: {
      flex: 1,
      justifyContent:
        'center',
      alignItems:
        'center',
    },

    scrollContent: {
      flexGrow:
        1,
      width:
        '100%',
      maxWidth:
        MaxContentWidth,
      alignSelf:
        'center',
      paddingHorizontal:
        Spacing.three,
      gap:
        Spacing.three,
    },

    header: {
      flexDirection:
        'row',
      alignItems:
        'center',
      gap:
        12,
    },

    logo: {
      width:
        46,
      height:
        46,
      borderRadius:
        14,
      alignItems:
        'center',
      justifyContent:
        'center',
    },

    logoText: {
      fontSize:
        22,
      lineHeight:
        28,
    },

    headerText: {
      flex:
        1,
    },

    appTitle: {
      fontSize:
        22,
      lineHeight:
        28,
      fontWeight:
        '700',
    },

    iconButton: {
      width:
        42,
      height:
        42,
      borderRadius:
        21,
      borderWidth:
        1,
      alignItems:
        'center',
      justifyContent:
        'center',
    },

    statusPill: {
      flexDirection:
        'row',
      alignItems:
        'center',
      alignSelf:
        'flex-start',
      gap:
        8,
      paddingVertical:
        6,
      paddingHorizontal:
        12,
      borderRadius:
        999,
      borderWidth:
        1,
    },

    statusDot: {
      width:
        8,
      height:
        8,
      borderRadius:
        4,
    },

    card: {
      borderRadius:
        18,
      borderWidth:
        1,
      padding:
        Spacing.three,
      gap:
        10,
    },

    cardTitleRow: {
      flexDirection:
        'row',
      alignItems:
        'center',
      gap:
        10,
    },

    cardTitle: {
      fontSize:
        16,
      fontWeight:
        '700',
    },

    step: {
      width:
        24,
      height:
        24,
      borderRadius:
        12,
      alignItems:
        'center',
      justifyContent:
        'center',
    },

    stepText: {
      fontSize:
        12,
      lineHeight:
        16,
      fontWeight:
        '700',
    },

    radar: {
      width:
        76,
      height:
        76,
      borderRadius:
        38,
      borderWidth:
        2,
      alignItems:
        'center',
      justifyContent:
        'center',
    },

    radarIcon: {
      fontSize:
        30,
      lineHeight:
        36,
    },

    filePicker: {
      borderWidth:
        2,
      borderRadius:
        14,
      padding:
        Spacing.four,
      alignItems:
        'center',
      gap:
        4,
    },

    fileIcon: {
      fontSize:
        34,
      lineHeight:
        42,
    },

    preview: {
      width:
        84,
      height:
        84,
      borderRadius:
        12,
      marginBottom:
        6,
    },

    transferRow: {
      flexDirection:
        'row',
      alignItems:
        'center',
      gap:
        12,
    },

    transferInfo: {
      flex:
        1,
    },

    thumbnail: {
      width:
        44,
      height:
        44,
      borderRadius:
        10,
    },

    thumbnailIcon: {
      alignItems:
        'center',
      justifyContent:
        'center',
    },

    percent: {
      fontSize:
        20,
      lineHeight:
        26,
      fontWeight:
        '700',
    },

    errorBox: {
      borderRadius:
        10,
      padding:
        10,
      gap:
        4,
    },

    transferButtons: {
      flexDirection:
        'row',
      justifyContent:
        'flex-end',
      gap:
        10,
    },

    primaryButton: {
      paddingVertical:
        10,
      paddingHorizontal:
        18,
      borderRadius:
        10,
    },

    secondaryButton: {
      paddingVertical:
        10,
      paddingHorizontal:
        18,
      borderRadius:
        10,
      borderWidth:
        1,
    },

    progressBackground: {
      height:
        10,
      width:
        '100%',
      borderRadius:
        10,
      overflow:
        'hidden',
    },

    progressFill: {
      height:
        '100%',
      borderRadius:
        10,
    },

    deviceCard: {
      borderRadius:
        14,
      padding:
        12,
      flexDirection:
        'row',
      alignItems:
        'center',
      gap:
        12,
      borderWidth:
        1,
    },

    deviceIconCircle: {
      width:
        46,
      height:
        46,
      borderRadius:
        23,
      alignItems:
        'center',
      justifyContent:
        'center',
    },

    deviceIcon: {
      fontSize:
        22,
      lineHeight:
        28,
    },

    statsRow: {
      flexDirection:
        'row',
      gap:
        8,
    },

    stat: {
      flex:
        1,
      borderRadius:
        10,
      paddingVertical:
        8,
      paddingHorizontal:
        10,
    },

    statLabel: {
      fontSize:
        11,
      lineHeight:
        14,
      textTransform:
        'uppercase',
      fontWeight:
        '600',
    },

    statValue: {
      fontSize:
        14,
      lineHeight:
        19,
      fontWeight:
        '700',
    },

    receivedRow: {
      flexDirection:
        'row',
      alignItems:
        'center',
      gap:
        10,
      padding:
        10,
      borderRadius:
        12,
      borderWidth:
        1,
    },

    smallButton: {
      paddingVertical:
        6,
      paddingHorizontal:
        10,
      borderRadius:
        8,
      borderWidth:
        1,
    },

    deviceInfo: {
      flex: 1,
      gap:
        2,
    },

    sendChip: {
      paddingVertical:
        6,
      paddingHorizontal:
        12,
      borderRadius:
        999,
    },

    emptyContainer: {
      paddingVertical:
        Spacing.three,
      alignItems:
        'center',
      gap:
        14,
    },

    modalOverlay: {
      flex: 1,
      backgroundColor:
        'rgba(0,0,0,0.5)',
      justifyContent:
        'center',
      alignItems:
        'center',
    },

    modalBox: {
      width:
        '88%',
      borderRadius:
        18,
      padding:
        20,
      gap:
        8,
    },

    modalInput: {
      borderWidth:
        1,
      borderRadius:
        10,
      padding:
        12,
      marginTop:
        8,
      marginBottom:
        8,
      fontSize:
        16,
    },

    modalButtons: {
      flexDirection:
        'row',
      justifyContent:
        'flex-end',
      gap:
        10,
    },

  });
