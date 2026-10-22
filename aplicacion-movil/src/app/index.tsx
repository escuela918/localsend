// ============================================================
// PANTALLA PRINCIPAL DEL CELULAR (LocalSend)
// ============================================================
//
// Este archivo es TODA la app del celular:
// 1) Busca la PC en la red Wi-Fi (por UDP y, si falla, por HTTP).
// 2) Se registra en la PC y le avisa cada segundo que sigue viva.
// 3) Envía archivos a la PC (con permiso: la PC tiene que aceptar).
// 4) Recibe archivos de la PC (con permiso: el celular acepta).
// 5) Muestra la barra de progreso, la velocidad y los errores.
// 6) Guarda lo recibido en la Galería o en una carpeta elegida.
//
// La PC tiene un servidor HTTP (puerto 53318). El celular NO
// tiene servidor: siempre es el celular el que le pregunta a la PC.

// Texto que cambia de color solo según el modo claro/oscuro.
import { ThemedText } from '@/components/themed-text';
// Caja (View) que pone el fondo según el modo claro/oscuro.
import { ThemedView } from '@/components/themed-view';
// Medidas compartidas: espacio de las pestañas, ancho máximo y márgenes.
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
// Hook que dice si el celular está en modo claro u oscuro.
import { useColorScheme } from '@/hooks/use-color-scheme';

// Librería para saber si hay Wi-Fi y cuál es nuestra IP.
import NetInfo from '@react-native-community/netinfo';
// Librería para leer el nombre del celular ("Galaxy A54").
import * as ExpoDevice from 'expo-device';
// Herramientas para manejar archivos y carpetas del celular.
import {
  // Directory = una carpeta.
  Directory,
  // DownloadTask = una descarga que se puede pausar y reanudar.
  DownloadTask,
  // File = un archivo.
  File,
  // Paths = carpetas conocidas (ej: la carpeta privada de la app).
  Paths,
} from 'expo-file-system';
// Componente para mostrar imágenes (miniaturas de las fotos).
import { Image } from 'expo-image';
// Para guardar fotos y videos directo en la Galería.
import * as MediaLibrary from 'expo-media-library/legacy';
// Para abrir un archivo con otra app ("Abrir con...").
import * as Sharing from 'expo-sharing';
// Sockets UDP: sirven para anunciarnos y escuchar a la PC en la red.
import dgram from 'react-native-udp';

// React y sus hooks.
import React, {
  // useEffect = ejecutar código cuando la pantalla aparece o cambia algo.
  useEffect,
  // useRef = guardar un valor que NO redibuja la pantalla al cambiar.
  useRef,
  // useState = guardar un valor que SÍ redibuja la pantalla al cambiar.
  useState,
} from 'react';

// Componentes básicos de React Native.
import {
  // Ruedita de "cargando".
  ActivityIndicator,
  // Carteles emergentes con botones.
  Alert,
  // Animaciones (el radar que late).
  Animated,
  // Abrir los Ajustes del celular.
  Linking,
  // Ventana flotante (la de conexión manual).
  Modal,
  // Lista que se puede desplazar con el dedo.
  ScrollView,
  // Para crear los estilos (como CSS).
  StyleSheet,
  // Campo para escribir texto (la IP).
  TextInput,
  // Botón que se oscurece al tocarlo.
  TouchableOpacity,
  // Caja básica para agrupar cosas.
  View,
} from 'react-native';

// Hook que da los márgenes seguros (barra de estado, notch, pestañas).
import { useSafeAreaInsets } from 'react-native-safe-area-context';


// ============================================================
// TIPOS (la "forma" que tienen los datos)
// ============================================================

// Una PC que aparece en la lista.
// OJO: estos nombres en inglés vienen de la PC por la red,
// por eso NO se pueden traducir (la PC los manda así).
interface Dispositivo {
  // Nombre de la PC (ej: "PC-de-Brigit").
  alias: string;
  // Dirección IP de la PC en la red (ej: "192.168.0.10").
  ip: string;
  // Puerto donde escucha el servidor de la PC.
  port: number;
  // Si es una PC ("desktop") o un celular ("mobile").
  deviceType: 'desktop' | 'mobile';
}

// El archivo que el usuario eligió para enviar a la PC.
interface ArchivoSeleccionado {
  // Nombre del archivo (ej: "foto.jpg").
  nombre: string;
  // Dirección interna del archivo en el celular (content://...).
  uri: string;
  // Tamaño en bytes.
  tamano: number;
  // Tipo de archivo (ej: "image/jpeg").
  tipoMime: string;
}

// Un archivo que la PC quiere mandarnos (está en su cola).
// Estos nombres también vienen de la PC por la red.
interface ArchivoEntrante {
  // Código único del archivo en la cola de la PC.
  id: string;
  // Nombre del archivo.
  fileName: string;
  // Tamaño en bytes.
  fileSize: number;
}

// Archivo que ya llegó al celular.
interface ArchivoRecibido {
  // Código único (el mismo que tenía en la PC).
  id: string;
  // Nombre con el que quedó guardado.
  nombre: string;
  // Dónde está guardado dentro de la app.
  uri: string;
  // Tamaño en bytes.
  tamano: number;
  // Tipo de archivo (opcional: el "?" significa que puede faltar).
  tipoMime?: string;
  // Fecha y hora en que llegó (en milisegundos).
  recibidoEn: number;
  // Nombre de la carpeta donde se guardó (si se guardó).
  guardadoEn?: string;
}

// Error con un mensaje ya pensado para el usuario
// (no hace falta diagnosticar la red). Hereda de Error.
class ErrorDeArchivo extends Error {}

// Estado de la transferencia actual (la barra de progreso).
// Cuando hay un error NO se borra: queda el porcentaje
// en el que se cortó, el motivo y el botón "Reintentar".
interface EstadoTransferencia {
  // 'send' = enviando a la PC, 'receive' = recibiendo de la PC.
  sentido: 'send' | 'receive';
  // 'active' = en curso, 'done' = terminó, 'error' = falló.
  estado: 'active' | 'done' | 'error';
  // Nombre del archivo que se está pasando.
  nombreArchivo: string;
  // Cuántos bytes ya pasaron.
  bytesTransferidos: number;
  // Cuántos bytes tiene el archivo en total.
  bytesTotales: number;
  // Velocidad en bytes por segundo.
  velocidad: number;
  // Segundos que faltan (null = todavía no se sabe).
  segundosRestantes?: number | null;
  // Texto del error, si lo hubo.
  mensaje?: string;
  // Imagen chiquita para mostrar si es una foto.
  uriMiniatura?: string;
  // Para reintentar un envío: a qué PC se mandaba.
  dispositivo?: Dispositivo;
  // Para reintentar una recepción: qué archivo era.
  archivoEntrante?: ArchivoEntrante;
  // IP de la PC con la que se hacía la transferencia.
  ipPC?: string;
  // Si quedó un archivo parcial, se puede reanudar
  // desde ese punto en vez de empezar de cero.
  sePuedeReanudar?: boolean;
  // Esperando que la PC toque "Aceptar".
  esperandoAceptacion?: boolean;
  // El receptor rechazó el archivo (no es un error de red).
  fueRechazado?: boolean;
}


// ============================================================
// CONFIGURACIÓN (números fijos que usa la app)
// ============================================================

// Puerto del servidor HTTP de la PC (por donde pasan los archivos).
const PUERTO_HTTP = 53318;

// Puerto UDP donde la PC y el celular se anuncian en la red.
const PUERTO_UDP = 53317;

// Nombre amigable del celular: "Galaxy A54", "Pixel 7"...
const NOMBRE_DEL_CELULAR =
  // Primero probamos el nombre que le puso el usuario,
  ExpoDevice.deviceName ||
  // si no hay, el modelo del celular,
  ExpoDevice.modelName ||
  // y si tampoco, simplemente "Android".
  'Android';

// Cada cuánto (milisegundos) anunciamos el celular por UDP.
const INTERVALO_ANUNCIO_UDP = 1000;

// Cada cuánto le avisamos a la PC que seguimos vivos ("latido").
// La PC nos borra si pasan 5 s sin noticias.
const INTERVALO_LATIDO = 1000;

// Cada cuánto se repite el escaneo HTTP de respaldo
// (por si la red bloquea UDP).
const INTERVALO_BUSQUEDA = 2500;

// Cuántas IPs probamos al mismo tiempo al escanear la red.
const IPS_POR_TANDA = 64;

// Tiempo máximo (ms) que esperamos la respuesta de una IP.
const TIEMPO_MAXIMO_PEDIDO = 500;

// Fallas seguidas antes de dar a la PC por perdida.
const MAXIMO_FALLAS_SEGUIDAS = 4;

// Si la transferencia no avanza en este tiempo (20 s),
// la cortamos y avisamos (evita cargas infinitas).
const TIEMPO_MAXIMO_SIN_AVANCE = 20000;

// La PC le da 60 s al usuario para aceptar; esperamos un
// poco más (65 s) para recibir su respuesta ("timeout").
const TIEMPO_ESPERA_ACEPTACION = 65000;

// Cada cuánto actualizamos la barra (no en cada pedacito,
// para no saturar el puente entre JavaScript y Android).
const INTERVALO_BARRA_PROGRESO = 250;


// ============================================================
// CONFIGURACIÓN GUARDADA (se recuerda al cerrar la app)
// ============================================================
//
// Se guarda en un JSON dentro de la carpeta de la app:
// la carpeta elegida para "Guardar" y la lista de recibidos.

// Forma del JSON guardado.
interface ConfiguracionGuardada {
  // Dirección de la carpeta elegida para guardar.
  uriCarpetaGuardado?: string;
  // Lista de archivos recibidos (para mostrarlos al volver a abrir).
  archivosRecibidos?: ArchivoRecibido[];
}

// El archivo JSON donde se guarda la configuración.
const ARCHIVO_CONFIGURACION =
  // new File(carpeta, nombre) arma la ruta del archivo.
  new File(
    // Carpeta privada de la app (nadie más la ve).
    Paths.document,
    // Nombre del archivo.
    'localsend-config.json'
  );

// Lee la configuración guardada. Si no existe o está rota, devuelve {}.
const leerConfiguracion = (): ConfiguracionGuardada => {
  // try = "intentá esto"; si algo falla, salta al catch.
  try {
    // Si el archivo existe, leemos el texto y lo convertimos a objeto;
    return ARCHIVO_CONFIGURACION.exists
      ? JSON.parse(ARCHIVO_CONFIGURACION.textSync())
      // si no existe, devolvemos una configuración vacía.
      : {};
  } catch {
    // Si el JSON estaba roto, también devolvemos vacío.
    return {};
  }
};

// Guarda la configuración en el archivo JSON.
const guardarConfiguracion = (configuracion: ConfiguracionGuardada) => {
  try {
    // Si el archivo todavía no existe, lo creamos.
    if (!ARCHIVO_CONFIGURACION.exists) {
      // Crea el archivo vacío.
      ARCHIVO_CONFIGURACION.create();
    }
    // Convierte el objeto a texto JSON y lo escribe en el archivo.
    ARCHIVO_CONFIGURACION.write(JSON.stringify(configuracion));
  } catch (error) {
    // Si no se pudo guardar, solo lo anotamos en la consola.
    console.log('No se pudo guardar la configuración:', error);
  }
};

// Convierte segundos en texto: 75 → "1 min 15 s".
const formatearTiempoRestante = (segundos?: number | null) => {
  // Si todavía no se sabe la velocidad, no hay tiempo calculado.
  if (segundos == null) {
    // Mostramos "calculando...".
    return 'calculando...';
  }
  // Si falta menos de un minuto, solo mostramos los segundos.
  if (segundos < 60) {
    // Ejemplo: "42 s".
    return `${segundos} s`;
  }
  // Minutos = segundos / 60 (sin decimales); el resto son los segundos (con 2 cifras).
  return `${Math.floor(segundos / 60)} min ${String(segundos % 60).padStart(2, '0')} s`;
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

// Tabla: tipo de archivo → extensión.
const EXTENSION_SEGUN_TIPO: Record<string, string> = {
  // Foto JPG.
  'image/jpeg': '.jpg',
  // Imagen PNG.
  'image/png': '.png',
  // Imagen animada GIF.
  'image/gif': '.gif',
  // Imagen WEBP.
  'image/webp': '.webp',
  // Foto de iPhone (HEIC).
  'image/heic': '.heic',
  // Foto HEIF.
  'image/heif': '.heif',
  // Video MP4.
  'video/mp4': '.mp4',
  // Video 3GP (celulares viejos).
  'video/3gpp': '.3gp',
  // Video MOV (iPhone).
  'video/quicktime': '.mov',
  // Video WEBM.
  'video/webm': '.webm',
  // Video MKV.
  'video/x-matroska': '.mkv',
  // Audio MP3.
  'audio/mpeg': '.mp3',
  // Audio M4A.
  'audio/mp4': '.m4a',
  // Audio OGG (notas de voz).
  'audio/ogg': '.ogg',
  // Audio WAV.
  'audio/wav': '.wav',
  // Documento PDF.
  'application/pdf': '.pdf',
  // Archivo comprimido ZIP.
  'application/zip': '.zip',
  // Texto plano.
  'text/plain': '.txt',
  // Word viejo.
  'application/msword': '.doc',
  // Word nuevo.
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  // Excel viejo.
  'application/vnd.ms-excel': '.xls',
  // Excel nuevo.
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  // PowerPoint viejo.
  'application/vnd.ms-powerpoint': '.ppt',
  // PowerPoint nuevo.
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  // Instalador de apps de Android.
  'application/vnd.android.package-archive': '.apk',
};

// Devuelve la extensión de un nombre: "Foto.JPG" → ".jpg".
const obtenerExtension = (nombre: string) => {
  // Busca la posición del ÚLTIMO punto del nombre (-1 si no hay).
  const posicionPunto = nombre.lastIndexOf('.');
  // Si hay punto (y no es el primer carácter), cortamos desde ahí y pasamos a minúsculas;
  return posicionPunto > 0
    ? nombre.slice(posicionPunto).toLowerCase()
    // si no, no tiene extensión.
    : '';
};

// Si el nombre no tiene extensión, se la agrega según el tipo.
const asegurarExtension = (nombre: string, tipoMime?: string | null) => {
  // Si ya tiene extensión, lo dejamos como está.
  if (obtenerExtension(nombre)) {
    // Devolvemos el nombre sin cambios.
    return nombre;
  }
  // Buscamos la extensión en la tabla (?? '' evita error si el tipo es null).
  const extension = EXTENSION_SEGUN_TIPO[(tipoMime ?? '').toLowerCase()];
  // Si la encontramos la pegamos al final; si no, dejamos el nombre igual.
  return extension ? nombre + extension : nombre;
};

// Al revés: a partir del nombre adivina el tipo ("a.pdf" → "application/pdf").
const tipoSegunNombre = (nombre: string) => {
  // Sacamos la extensión del nombre.
  const extension = obtenerExtension(nombre);
  // ".jpeg" también es JPG (no está en la tabla).
  if (extension === '.jpeg') {
    // Tipo de las fotos JPG.
    return 'image/jpeg';
  }
  // Recorremos la tabla buscando la fila cuya extensión coincida.
  const encontrado = Object.entries(EXTENSION_SEGUN_TIPO).find(([, valor]) => valor === extension);
  // Si la encontramos devolvemos el tipo; si no, "archivo binario genérico".
  return encontrado?.[0] ?? 'application/octet-stream';
};


// ============================================================
// FORMATEAR BYTES (1536 → "1.50 KB")
// ============================================================

// Convierte un número de bytes en texto fácil de leer.
const formatearTamano = (cantidadBytes: number) => {
  // Si es 0, vacío o negativo, mostramos "0 B".
  if (!cantidadBytes || cantidadBytes < 0) {
    // Texto para "nada".
    return '0 B';
  }
  // Las unidades posibles, de menor a mayor.
  const unidades = ['B', 'KB', 'MB', 'GB'];
  // El logaritmo dice cuántas veces se puede dividir por 1024
  // (0 = B, 1 = KB, 2 = MB, 3 = GB). Math.min evita pasarse de GB.
  const indiceUnidad = Math.min(unidades.length - 1, Math.floor(Math.log(cantidadBytes) / Math.log(1024)));
  // Dividimos por 1024 las veces necesarias, dejamos 2 decimales y agregamos la unidad.
  return (cantidadBytes / Math.pow(1024, indiceUnidad)).toFixed(2) + ' ' + unidades[indiceUnidad];
};


// ============================================================
// TRADUCIR ERRORES
// ============================================================
//
// Convierte los errores técnicos de Android/OkHttp en un
// mensaje que el usuario entienda.

// Recibe un error técnico y devuelve un texto en castellano.
const explicarError = (error: any): string => {
  // Pasamos el error a texto (sea un objeto Error, un texto o nada).
  const textoError = String(error?.message ?? error ?? '');
  // .test() revisa si el texto contiene alguna de esas palabras (/i = sin importar mayúsculas).
  // Sin espacio en el celular.
  if (/ENOSPC|no space|not enough space/i.test(textoError)) {
    // Mensaje para el usuario.
    return 'No hay espacio suficiente en el celular.';
  }
  // No se pudo llegar a la PC.
  if (/ECONNREFUSED|failed to connect|unable to resolve host|no route to host|network is unreachable|network request failed/i.test(textoError)) {
    // Mensaje para el usuario.
    return 'No se pudo conectar con la PC. Verificá que la app de escritorio esté abierta y que los dos estén en la misma red Wi-Fi.';
  }
  // La PC tardó demasiado en contestar.
  if (/timeout|timed out/i.test(textoError)) {
    // Mensaje para el usuario.
    return 'La PC dejó de responder (se agotó el tiempo de espera).';
  }
  // La conexión se cortó a la mitad.
  if (/reset|closed|unexpected end|broken pipe|EPIPE|software caused connection abort|stream was reset|interrump/i.test(textoError)) {
    // Mensaje para el usuario.
    return 'Se cortó la conexión con la PC en medio de la transferencia (el Wi-Fi se cayó o la señal es muy débil). Acercate al router y tocá "Reintentar".';
  }
  // Alguien canceló la transferencia.
  if (/cancel/i.test(textoError)) {
    // Mensaje para el usuario.
    return 'La transferencia se canceló.';
  }
  // Cualquier otro caso: mensaje general + el detalle técnico (si hay).
  return `La transferencia se interrumpió por un problema de red. Tocá "Reintentar".${textoError ? ` (detalle: ${textoError})` : ''}`;
};


// ============================================================
// COMPONENTE (la pantalla)
// ============================================================

// "export default" = esta es la pantalla que muestra la pestaña "Inicio".
export default function PantallaPrincipal() {

  // Márgenes seguros (barra de estado, pestañas, notch).
  const margenesSeguros = useSafeAreaInsets();

  // ¿El celular está en modo claro u oscuro?
  const esquemaColor = useColorScheme();
  // Elegimos la paleta de colores que corresponde a ese modo.
  const paleta = PALETAS_DE_COLORES[esquemaColor === 'dark' ? 'dark' : 'light'];

  // ============================================================
  // ESTADOS (si cambian, la pantalla se vuelve a dibujar)
  // ============================================================
  // useState devuelve [valor, función para cambiarlo].

  // true mientras todavía no sabemos si hay Wi-Fi (muestra la ruedita).
  const [cargando, setCargando] = useState(true);

  // Lista de PCs encontradas en la red.
  const [dispositivos, setDispositivos] = useState<Dispositivo[]>([]);

  // Archivo elegido para enviar (null = ninguno).
  const [archivoSeleccionado, setArchivoSeleccionado] = useState<ArchivoSeleccionado | null>(null);

  // true si el celular está conectado a una red Wi-Fi.
  const [hayWifi, setHayWifi] = useState(false);

  // true mientras estamos buscando la PC (anima el radar).
  const [buscandoPC, setBuscandoPC] = useState(true);

  // true si está abierta la ventana de "conectar por IP".
  const [ventanaManualVisible, setVentanaManualVisible] = useState(false);

  // Lo que el usuario escribe en el campo de la IP.
  const [ipEscrita, setIpEscrita] = useState('');

  // La transferencia actual (barra de progreso). null = no hay.
  const [transferencia, setTransferencia] = useState<EstadoTransferencia | null>(null);

  // Archivos que llegaron al celular.
  const [recibidos, setRecibidos] = useState<ArchivoRecibido[]>([]);

  // Nombre de la carpeta elegida para "Guardar".
  const [nombreCarpetaGuardado, setNombreCarpetaGuardado] = useState<string | null>(null);


  // ============================================================
  // REFS (valores que se recuerdan pero NO redibujan la pantalla)
  // ============================================================
  // Se leen y escriben con .current. Los usamos dentro de
  // temporizadores, que si no verían valores viejos.

  // Valor animado del radar (1 = tamaño normal). .current saca el valor guardado.
  const animacionPulso = useRef(new Animated.Value(1)).current;

  // Copia de "hayWifi" para leerla dentro de los temporizadores.
  const hayWifiRef = useRef(false);

  // Temporizador del escaneo de respaldo (para poder frenarlo).
  const intervaloBusquedaRef = useRef<any>(null);

  // Temporizador del latido (avisarle a la PC que seguimos vivos).
  const intervaloLatidoRef = useRef<any>(null);

  // Temporizador que pide la lista de dispositivos.
  const intervaloDispositivosRef = useRef<any>(null);

  // Temporizador que pregunta si la PC quiere mandarnos algo.
  const intervaloEntrantesRef = useRef<any>(null);

  // IP de la PC con la que estamos conectados.
  const ipPCConectadaRef = useRef<string | null>(null);

  // Última PC conocida: al reconectar se prueba primero.
  const ultimaIpPCRef = useRef<string | null>(null);

  // IP a la que nos estamos conectando ahora (evita conectar dos veces).
  const conectandoARef = useRef<string | null>(null);

  // true mientras corre un escaneo (evita dos escaneos a la vez).
  const escaneoEnCursoRef = useRef(false);

  // Cuántas veces seguidas la PC no contestó.
  const fallasSeguidasRef = useRef(0);

  // Códigos de los archivos que se están descargando ahora.
  // Un Set es una lista sin repetidos.
  const idsDescargando = useRef<Set<string>>(new Set());

  // Archivos que fallaron: no se reintentan solos,
  // espera a que el usuario toque "Reintentar".
  const idsFallidos = useRef<Set<string>>(new Set());

  // Tarea nativa activa (subida o descarga), para poder cancelarla.
  const tareaActivaRef = useRef<{ cancel: () => void } | null>(null);

  // true mientras se espera una respuesta de aceptación
  // (nuestra o de la PC): no arrancamos otra transferencia
  // ni mostramos otro cartel al mismo tiempo.
  const esperandoRespuestaRef = useRef(false);

  // Carpeta elegida para guardar los archivos.
  const carpetaGuardadoRef = useRef<Directory | null>(null);

  // Descargas cortadas: id del archivo → archivo parcial.
  // Con esto se reanuda desde el byte donde quedó. Un Map es una tabla clave → valor.
  const descargasParcialesRef = useRef<Map<string, string>>(new Map());

  // Si cancelamos nosotros, guardamos el motivo real.
  const motivoCancelacionRef = useRef<string | null>(null);

  // Momento (en ms) en que la transferencia avanzó por última vez.
  const ultimoAvanceRef = useRef(0);


  // ============================================================
  // CARGAR CONFIGURACIÓN (al abrir la app)
  // ============================================================

  // useEffect con [] al final = se ejecuta UNA sola vez, al abrir la pantalla.
  useEffect(() => {

    // Leemos el JSON guardado.
    const configuracion = leerConfiguracion();

    // Si había una carpeta elegida para guardar...
    if (configuracion.uriCarpetaGuardado) {

      // ...intentamos abrirla (puede que ya no exista).
      try {

        // Creamos el objeto carpeta a partir de su dirección.
        const carpeta = new Directory(configuracion.uriCarpetaGuardado);

        // La recordamos para cuando el usuario toque "Guardar".
        carpetaGuardadoRef.current = carpeta;

        // Mostramos su nombre en pantalla.
        setNombreCarpetaGuardado(carpeta.name);

      // Si falla, simplemente no hay carpeta elegida.
      } catch {}

    }

    // Cargamos la lista de recibidos, pero solo los que todavía existen en el celular.
    setRecibidos(
      // ?? [] = si no hay lista, usamos una vacía. filter() deja solo los que cumplen.
      (configuracion.archivosRecibidos ?? []).filter(
        // Para cada archivo guardado...
        archivoGuardado => {
          try {
            // ...nos fijamos si el archivo sigue estando.
            return new File(archivoGuardado.uri).exists;
          } catch {
            // Si no se puede revisar, lo sacamos de la lista.
            return false;
          }
        }
      )
    );

  }, []);


  // ============================================================
  // ANIMACIÓN RADAR (el círculo que late mientras busca)
  // ============================================================

  // Se vuelve a ejecutar cada vez que cambia "buscandoPC".
  useEffect(() => {

    // Si ya no estamos buscando...
    if (!buscandoPC) {
      // ...dejamos el radar en su tamaño normal
      animacionPulso.setValue(1);
      // y no animamos nada.
      return;
    }

    // Armamos una animación que se repite para siempre (loop).
    const animacion = Animated.loop(

      // Una secuencia: primero un paso y después el otro.
      Animated.sequence([

        // Paso 1: agrandar el radar a 115% en 0,7 segundos.
        Animated.timing(animacionPulso, {
          // Tamaño final.
          toValue: 1.15,
          // Duración en milisegundos.
          duration: 700,
          // La animación la hace Android directamente (más fluida).
          useNativeDriver: true,
        }),

        // Paso 2: volver al 100% en 0,7 segundos.
        Animated.timing(animacionPulso, {
          // Tamaño final.
          toValue: 1,
          // Duración en milisegundos.
          duration: 700,
          // La animación la hace Android directamente.
          useNativeDriver: true,
        }),

      ])

    );

    // Arrancamos la animación.
    animacion.start();

    // Esta función se ejecuta al limpiar el efecto: frena la animación.
    return () => {
      // Detenemos el loop.
      animacion.stop();
    };

  }, [buscandoPC, animacionPulso]);


  // ============================================================
  // WIFI (escuchar si se conecta o desconecta)
  // ============================================================

  // Se ejecuta una vez al abrir la pantalla.
  useEffect(() => {

    // addEventListener avisa cada vez que cambia la red. Devuelve una función para dejar de escuchar.
    const dejarDeEscuchar = NetInfo.addEventListener(
      // estadoRed trae: si hay conexión y de qué tipo (wifi, datos...).
      estadoRed => {

        // Solo cuenta como conectado si hay conexión Y es Wi-Fi (!! convierte a true/false).
        const conectado = !!estadoRed.isConnected && estadoRed.type === 'wifi';

        // Se perdió el Wi-Fi: antes había y ahora no.
        if (hayWifiRef.current && !conectado) {

          // Si había una transferencia, la cortamos
          // con un motivo claro (si no, quedaría colgada).
          if (tareaActivaRef.current) {

            // Guardamos el motivo para mostrarlo en la barra.
            motivoCancelacionRef.current = 'Se perdió la conexión Wi-Fi del celular. Cuando vuelva el Wi-Fi, tocá el botón de abajo para continuar.';

            // Cancelamos la subida/descarga en curso.
            tareaActivaRef.current.cancel();

          }

          // Nos desconectamos de la PC y volvemos a buscar.
          desconectarDePC();

        }

        // Guardamos el nuevo estado en la ref (para los temporizadores)...
        hayWifiRef.current = conectado;

        // ...y en el estado (para la pantalla).
        setHayWifi(conectado);

        // Ya sabemos cómo está la red: sacamos la ruedita de "cargando".
        setCargando(false);

      }
    );

    // Al cerrar la pantalla dejamos de escuchar los cambios de red.
    return () => {
      // Cancela la suscripción.
      dejarDeEscuchar();
    };

  }, []);


  // ============================================================
  // OBTENER IP LOCAL (la del celular)
  // ============================================================

  // async = función que puede esperar (await) cosas lentas.
  const obtenerDatosRed = async () => {

    // Pedimos el estado actual de la red.
    const estadoRed = await NetInfo.fetch();

    // "details" trae la IP, la máscara y el router (as any = no revisar el tipo).
    const detalles = estadoRed.details as any;

    // Devolvemos solo lo que nos importa.
    return {
      // IP del celular (o null si no hay).
      ip: detalles?.ipAddress ?? null,

      // Máscara de subred.
      subnet: detalles?.subnet ?? null,

      // IP del router.
      gateway: detalles?.gateway ?? null,
    };

  };


  // ============================================================
  // CREAR IPs DE LA RED (las 254 posibles del /24)
  // ============================================================

  // Ej: "192.168.0.50" → ["192.168.0.51", "192.168.0.49", "192.168.0.52", ...].
  const generarIPsDeLaRed = (ip: string) => {

    // Separamos la IP en sus 4 números: ["192", "168", "0", "50"].
    const partes = ip.split('.');

    // Si no tiene 4 partes, no es una IP válida.
    if (partes.length !== 4) {
      // Devolvemos una lista vacía.
      return [];
    }

    // Los 3 primeros números son iguales para toda la red: "192.168.0.".
    const prefijo = `${partes[0]}.${partes[1]}.${partes[2]}.`;

    // El último número es el de nuestro celular (ej: 50).
    const numeroPropio = Number(partes[3]);

    // Acá vamos juntando las IPs a probar.
    const listaIPs: string[] = [];

    // Primero buscamos cerca de nuestra IP (las PCs suelen tener números parecidos).
    for (let distancia = 1; distancia <= 254; distancia++) {

      // Un número arriba y uno abajo del nuestro (ej: 51 y 49).
      const candidatos = [numeroPropio + distancia, numeroPropio - distancia];

      // Revisamos cada candidato.
      for (const valor of candidatos) {

        // Solo valen del 1 al 254 (0 y 255 son especiales).
        if (valor >= 1 && valor <= 254) {

          // Lo agregamos a la lista completa: "192.168.0." + 51.
          listaIPs.push(prefijo + valor);

        }

      }

    }

    // new Set quita los repetidos y [... ] lo vuelve a convertir en lista.
    return [...new Set(listaIPs)];

  };


  // ============================================================
  // PEDIDO HTTP CON LÍMITE DE TIEMPO
  // ============================================================
  // fetch() por sí solo puede quedarse esperando muchísimo. Esta versión corta
  // el pedido si la PC no contesta a tiempo.

  // direccion = URL, opciones = método/cuerpo, tiempoMaximo = ms (por defecto 500).
  const pedirConLimiteDeTiempo = async (direccion: string, opciones: RequestInit = {}, tiempoMaximo = TIEMPO_MAXIMO_PEDIDO) => {

    // El AbortController sirve para cancelar un fetch.
    const controlador = new AbortController();

    // Cuando se cumple el tiempo, cancelamos el pedido.
    const temporizador = setTimeout(() => controlador.abort(), tiempoMaximo);

    try {

      // Hacemos el pedido, pasándole la "señal" para poder cancelarlo.
      return await fetch(direccion, {
        // ...opciones copia todo lo que nos pasaron (método, cuerpo, etc.).
        ...opciones,
        // La señal del controlador.
        signal: controlador.signal,
      });

    // finally se ejecuta siempre, haya salido bien o mal.
    } finally {

      // Apagamos el temporizador (ya no hace falta).
      clearTimeout(temporizador);

    }

  };


  // ============================================================
  // PROBAR SI UNA IP ES UNA PC CON LOCALSEND
  // ============================================================

  // Devuelve true si en esa IP hay una PC con nuestra app abierta.
  const esPCLocalSend = async (ip: string): Promise<boolean> => {

    try {

      // Le pedimos /ping a esa IP.
      const respuesta = await pedirConLimiteDeTiempo(`http://${ip}:${PUERTO_HTTP}/ping`);

      // Si contestó con un error (ej: 404), no es nuestra PC.
      if (!respuesta.ok) {
        // No es.
        return false;
      }

      // Leemos el JSON de la respuesta.
      const datos = await respuesta.json();

      // Es nuestra PC solo si dice "service: LocalSend".
      return (datos?.service === 'LocalSend');

    } catch {

      // No contestó (no hay nada en esa IP): no es.
      return false;

    }

  };


  // ============================================================
  // REGISTRAR EL CELULAR EN LA PC
  // ============================================================

  // Le dice a la PC "acá estoy" para que nos muestre en su lista.
  const registrarseEnPC = async (ip: string) => {

    // Mandamos un POST a /register con nuestros datos.
    const respuesta = await pedirConLimiteDeTiempo(

      // Dirección del servidor de la PC.
      `http://${ip}:${PUERTO_HTTP}/register`,

      {
        // POST = mandar datos.
        method: 'POST',

        // Avisamos que el cuerpo es JSON.
        headers: {
          'Content-Type': 'application/json',
        },

        // El cuerpo: nuestros datos convertidos a texto JSON.
        // (Los nombres de los campos van en inglés porque la PC los espera así).
        body: JSON.stringify({

          // Nombre del celular.
          alias: NOMBRE_DEL_CELULAR,

          // Puerto (informativo).
          port: PUERTO_HTTP,

          // Avisamos que somos un celular.
          deviceType: 'mobile',

        }),

      },

      // Le damos hasta 1,5 segundos para contestar.
      1500

    );

    // Si la PC respondió con error...
    if (!respuesta.ok) {
      // ...lanzamos un error con el código (ej: "HTTP 500").
      throw new Error(`HTTP ${respuesta.status}`);
    }

    // Devolvemos lo que contestó la PC.
    return respuesta.json();

  };


  // ============================================================
  // DESCUBRIMIENTO UDP (forma principal de encontrar la PC)
  // ============================================================
  //
  // La PC manda cada 1 s un "anuncio" por broadcast (a toda
  // la red) al puerto 53317. Al escucharlo sabemos su IP al
  // instante, sin escanear la red. A la vez mandamos nuestro
  // propio anuncio para que la PC nos vea aunque todavía no
  // nos registramos.

  // Se ejecuta cada vez que cambia "hayWifi".
  useEffect(() => {

    // Sin Wi-Fi no tiene sentido escuchar la red.
    if (!hayWifi) {
      // Salimos.
      return;
    }

    // Los tipos de react-native-udp no declaran .on(),
    // pero el socket lo tiene; por eso lo marcamos como "any".
    let socketUdp: any = null;

    // true cuando el socket ya quedó escuchando en el puerto.
    let puertoAbierto = false;

    try {

      // Creamos un socket UDP (IPv4) que pueda compartir el puerto.
      socketUdp = dgram.createSocket({
        // UDP sobre IPv4.
        type: 'udp4',
        // Permite reabrir el puerto aunque otro socket lo esté usando.
        reusePort: true,
      });

      // Cada vez que llega un mensaje UDP...
      socketUdp.on('message', (mensajeRecibido: any, infoRemitente: any) => {

        try {

          // ...lo pasamos de bytes a texto y de texto a objeto.
          const datos = JSON.parse(mensajeRecibido.toString());

          // Si lo mandó una PC y no es la que ya tenemos conectada...
          if (datos?.deviceType === 'desktop' && ipPCConectadaRef.current !== infoRemitente.address) {

            // ...lo anotamos en la consola
            console.log('📡 Beacon de PC:', infoRemitente.address);

            // ...y nos conectamos a esa IP.
            conectarConPC(infoRemitente.address);

          }

        } catch {
          // Paquete que no es nuestro (no es JSON). Lo ignoramos.
        }

      });

      // Si el socket tiene un error, solo lo anotamos.
      socketUdp.on('error', (error: any) => {
        // Mostramos el error en la consola.
        console.log('UDP error:', error);
      });

      // Abrimos el puerto 53317 para escuchar.
      socketUdp.bind(PUERTO_UDP, () => {

        // Ya quedó escuchando.
        puertoAbierto = true;

        // Activamos el broadcast para poder mandar a toda la red.
        try {
          // setBroadcast(true) = permitir mandar a 255.255.255.255.
          socketUdp?.setBroadcast(true);
        } catch {}

      });

    } catch (error) {

      // Si UDP no está disponible (ej: Expo Go),
      // queda el escaneo HTTP como respaldo.
      console.log('UDP no disponible:', error);

    }

    // Cada 1 segundo mandamos nuestro anuncio.
    const temporizadorAnuncio = setInterval(() => {

      // Si el socket no está listo, todavía no mandamos nada.
      if (!socketUdp || !puertoAbierto) {
        // Salimos hasta la próxima vuelta.
        return;
      }

      // El anuncio: nuestros datos en JSON (nombres en inglés porque la PC los espera así).
      const anuncio = JSON.stringify({
        // Nombre del celular.
        alias: NOMBRE_DEL_CELULAR,
        // Puerto.
        port: PUERTO_HTTP,
        // Somos un celular.
        deviceType: 'mobile',
      });

      try {

        // Lo mandamos a 255.255.255.255 (= todos los equipos de la red).
        socketUdp.send(anuncio, undefined, undefined, PUERTO_UDP, '255.255.255.255', () => {});

      } catch {}

    }, INTERVALO_ANUNCIO_UDP);

    // Al limpiar el efecto (sin Wi-Fi o al cerrar la app):
    return () => {

      // Dejamos de mandar anuncios
      clearInterval(temporizadorAnuncio);

      // y cerramos el socket.
      try {
        // Cierra el puerto UDP.
        socketUdp?.close();
      } catch {}

    };

  }, [hayWifi]);


  // ============================================================
  // DESCUBRIMIENTO HTTP (respaldo si UDP no funciona)
  // ============================================================
  //
  // Si la red bloquea el broadcast UDP (pasa en algunas redes
  // de facultad o routers), probamos /ping en toda la subred.
  // 64 pedidos en paralelo con 500 ms de límite → la subred
  // completa se recorre en ~2 segundos.

  // Busca la PC probando IP por IP.
  const buscarPCEnLaRed = async () => {

    // No buscamos si: no hay Wi-Fi, ya estamos conectados o ya hay un escaneo en curso.
    if (!hayWifiRef.current || ipPCConectadaRef.current || escaneoEnCursoRef.current) {
      // Salimos sin hacer nada.
      return;
    }

    // Marcamos que empezó un escaneo.
    escaneoEnCursoRef.current = true;

    try {

      // Reconexión rápida: probamos primero la última
      // PC conocida antes de recorrer toda la red.
      if (ultimaIpPCRef.current && await esPCLocalSend(ultimaIpPCRef.current)) {

        // Contestó: nos conectamos directamente.
        await conectarConPC(ultimaIpPCRef.current);

        // Listo, no hace falta escanear.
        return;

      }

      // Averiguamos nuestra IP.
      const red = await obtenerDatosRed();

      // Sin IP no podemos saber qué red escanear.
      if (!red.ip) {
        // Salimos.
        return;
      }

      // Mensaje en la consola.
      console.log('🔎 Buscando PC en:', red.ip);

      // Armamos la lista de las 254 IPs a probar.
      const listaIPs = generarIPsDeLaRed(red.ip);

      // Recorremos la lista de a tandas de 64.
      for (let inicioTanda = 0; inicioTanda < listaIPs.length; inicioTanda += IPS_POR_TANDA) {

        // Si mientras tanto UDP ya la encontró, cortamos.
        if (ipPCConectadaRef.current) {
          // Salimos.
          return;
        }

        // Tomamos las 64 IPs de esta tanda.
        const tanda = listaIPs.slice(inicioTanda, inicioTanda + IPS_POR_TANDA);

        // Las probamos TODAS al mismo tiempo y esperamos a que terminen.
        const resultados = await Promise.all(

          // Para cada IP: si es la PC devolvemos la IP; si no, null.
          tanda.map(async ip => (await esPCLocalSend(ip)) ? ip : null)

        );

        // Buscamos la primera que no sea null (la PC).
        const ipEncontrada = resultados.find(valor => valor !== null);

        // Si apareció...
        if (ipEncontrada) {

          // ...la mostramos en la consola
          console.log('🖥️ PC encontrada:', ipEncontrada);

          // ...nos conectamos
          await conectarConPC(ipEncontrada);

          // ...y terminamos.
          return;

        }

      }

    } catch (error) {

      // Si algo falló, lo anotamos (se reintenta en el próximo intervalo).
      console.log('Error discovery:', error);

    } finally {

      // Pase lo que pase, marcamos que el escaneo terminó.
      escaneoEnCursoRef.current = false;

    }

  };


  // ============================================================
  // CONECTAR CON LA PC
  // ============================================================

  // Se registra en la PC y arranca los temporizadores. Devuelve true si salió bien.
  const conectarConPC = async (ip: string): Promise<boolean> => {

    // Evita conectar dos veces a la vez
    // (UDP y el escaneo pueden encontrarla juntos).
    if (conectandoARef.current === ip) {
      // Ya hay una conexión en marcha a esa IP.
      return false;
    }

    // Anotamos que nos estamos conectando a esta IP.
    conectandoARef.current = ip;

    try {

      // Nos registramos en la PC (si falla, salta al catch).
      await registrarseEnPC(ip);

      // Guardamos la IP de la PC conectada.
      ipPCConectadaRef.current = ip;

      // Y la recordamos para reconectar rápido la próxima vez.
      ultimaIpPCRef.current = ip;

      // Reiniciamos el contador de fallas.
      fallasSeguidasRef.current = 0;

      // Pedimos la lista de dispositivos para mostrar la PC ya mismo.
      await consultarDispositivos(ip);

      // Dejamos de buscar (para el radar).
      setBuscandoPC(false);

      // Empezamos a mandar el "sigo vivo".
      iniciarLatido(ip);

      // Empezamos a pedir la lista de dispositivos cada 2 s.
      iniciarConsultaDispositivos(ip);

      // Empezamos a preguntar cada 2 s si hay archivos para nosotros.
      iniciarConsultaEntrantes(ip);

      // Todo salió bien.
      return true;

    } catch (error) {

      // No se pudo conectar: lo anotamos.
      console.log('No se pudo conectar:', error);

      // Si habíamos guardado esta IP como conectada...
      if (ipPCConectadaRef.current === ip) {
        // ...la borramos.
        ipPCConectadaRef.current = null;
      }

      // Avisamos que falló.
      return false;

    } finally {

      // Ya no nos estamos conectando a ninguna IP.
      conectandoARef.current = null;

    }

  };


  // ============================================================
  // DESCONECTAR (PC perdida o sin Wi-Fi)
  // ============================================================

  // Apaga los 3 temporizadores que hablan con la PC.
  const detenerIntervalos = () => {

    // Recorremos los 3 temporizadores.
    for (const refIntervalo of [intervaloLatidoRef, intervaloDispositivosRef, intervaloEntrantesRef]) {

      // Si está corriendo...
      if (refIntervalo.current) {

        // ...lo frenamos
        clearInterval(refIntervalo.current);

        // ...y lo borramos.
        refIntervalo.current = null;

      }

    }

  };

  // Se desconecta de la PC y vuelve a buscar.
  const desconectarDePC = () => {

    // Frenamos los temporizadores.
    detenerIntervalos();

    // Ya no hay PC conectada.
    ipPCConectadaRef.current = null;

    // Reiniciamos el contador de fallas.
    fallasSeguidasRef.current = 0;

    // Vaciamos la lista de la pantalla.
    setDispositivos([]);

    // Volvemos a mostrar el radar buscando.
    setBuscandoPC(true);

  };


  // ============================================================
  // LATIDO ("sigo vivo")
  // ============================================================

  // Cada 1 s se vuelve a registrar en la PC para que no nos borre.
  const iniciarLatido = (ip: string) => {

    // Si ya había un latido corriendo...
    if (intervaloLatidoRef.current) {

      // ...lo frenamos para no tener dos.
      clearInterval(intervaloLatidoRef.current);

    }

    // Arrancamos el temporizador nuevo.
    intervaloLatidoRef.current = setInterval(() => {

      // Nos registramos otra vez; si falla no pasa nada (.catch vacío).
      registrarseEnPC(ip).catch(() => {});

    }, INTERVALO_LATIDO);

  };


  // ============================================================
  // CONSULTAR DISPOSITIVOS (cada 2 segundos)
  // ============================================================

  // Pide la lista de dispositivos a la PC cada 2 s.
  const iniciarConsultaDispositivos = (ip: string) => {

    // Si ya había uno corriendo...
    if (intervaloDispositivosRef.current) {

      // ...lo frenamos.
      clearInterval(intervaloDispositivosRef.current);

    }

    // Arrancamos el temporizador nuevo.
    intervaloDispositivosRef.current = setInterval(() => {

      // Pedimos la lista.
      consultarDispositivos(ip);

    }, 2000);

  };


  // ============================================================
  // CONSULTAR ARCHIVOS ENTRANTES (cada 2 segundos)
  // ============================================================

  // Pregunta a la PC cada 2 s si tiene archivos para nosotros.
  const iniciarConsultaEntrantes = (ip: string) => {

    // Si ya había uno corriendo...
    if (intervaloEntrantesRef.current) {

      // ...lo frenamos.
      clearInterval(intervaloEntrantesRef.current);

    }

    // Arrancamos el temporizador nuevo.
    intervaloEntrantesRef.current = setInterval(() => {

      // Preguntamos a la PC.
      revisarArchivosEntrantes(ip);

    }, 2000);

  };


  // ============================================================
  // INICIAR LA BÚSQUEDA AUTOMÁTICA
  // ============================================================

  // Se ejecuta cada vez que cambia "hayWifi".
  useEffect(() => {

    // Sin Wi-Fi no buscamos.
    if (!hayWifi) {
      // Salimos.
      return;
    }

    // Buscamos una vez ya mismo...
    buscarPCEnLaRed();

    // ...y después cada 2,5 segundos.
    intervaloBusquedaRef.current = setInterval(buscarPCEnLaRed, INTERVALO_BUSQUEDA);

    // Al limpiar (sin Wi-Fi o al salir):
    return () => {

      // Si el temporizador existe...
      if (intervaloBusquedaRef.current) {

        // ...lo frenamos.
        clearInterval(intervaloBusquedaRef.current);

      }

    };

  }, [hayWifi]);


  // ============================================================
  // LIMPIEZA (al cerrar la pantalla)
  // ============================================================

  // Solo nos interesa la función de limpieza (el return).
  useEffect(() => {

    // Se ejecuta cuando la pantalla se cierra.
    return () => {

      // Si la búsqueda seguía corriendo...
      if (intervaloBusquedaRef.current) {
        // ...la frenamos.
        clearInterval(intervaloBusquedaRef.current);
      }

      // Frenamos los temporizadores de la PC.
      detenerIntervalos();

      // Cancelamos cualquier transferencia en curso (?. = solo si existe).
      tareaActivaRef.current?.cancel();

    };

  }, []);


  // ============================================================
  // OBTENER DISPOSITIVOS
  // ============================================================

  // Pide /devices a la PC y actualiza la lista de la pantalla.
  const consultarDispositivos = async (ip: string) => {

    try {

      // Pedimos la lista (le damos hasta 3 s).
      const respuesta = await pedirConLimiteDeTiempo(`http://${ip}:${PUERTO_HTTP}/devices`, {}, 3000);

      // Si la PC contestó con error, no hacemos nada.
      if (!respuesta.ok) {
        // Salimos.
        return;
      }

      // Convertimos la respuesta JSON en una lista de dispositivos.
      const lista: Dispositivo[] = await respuesta.json();

      // La PC contestó: reiniciamos las fallas.
      fallasSeguidasRef.current = 0;

      // Solo mostramos PCs: a otro celular no se le
      // puede enviar (no tiene servidor).
      // Y usamos la IP con la que YA estamos conectados:
      // es la que seguro funciona, aunque la PC tenga
      // varios adaptadores de red.
      setDispositivos(
        lista
          // Nos quedamos solo con las PCs.
          .filter(dispositivo => dispositivo.deviceType === 'desktop')
          // A cada una le ponemos la IP que sabemos que funciona.
          .map(dispositivo => ({
            // Copiamos todos sus datos...
            ...dispositivo,
            // ...y reemplazamos la IP.
            ip,
          }))
      );

    } catch {

      // Durante una transferencia el Wi-Fi está saturado
      // y es normal que esto tarde: no desconectamos.
      if (tareaActivaRef.current) {
        // Salimos.
        return;
      }

      // Toleramos alguna falla suelta: sumamos una.
      fallasSeguidasRef.current += 1;

      // Si ya van 4 fallas seguidas...
      if (fallasSeguidasRef.current >= MAXIMO_FALLAS_SEGUIDAS) {

        // ...damos la PC por perdida
        console.log('📴 PC perdida:', ip);

        // ...y volvemos a buscar.
        desconectarDePC();

      }

    }

  };


  // ============================================================
  // ARCHIVOS ENTRANTES (PC → celular)
  // ============================================================

  // Pregunta a la PC si tiene archivos en cola para nosotros.
  const revisarArchivosEntrantes = async (ip: string) => {

    // Uno a la vez: si hay una transferencia o un cartel abierto, esperamos.
    if (tareaActivaRef.current || esperandoRespuestaRef.current) {
      // Salimos.
      return;
    }

    try {

      // Pedimos /incoming (la cola de la PC).
      const respuesta = await pedirConLimiteDeTiempo(`http://${ip}:${PUERTO_HTTP}/incoming`, {}, 1500);

      // Si contestó con error, no hacemos nada.
      if (!respuesta.ok) {
        // Salimos.
        return;
      }

      // Lista de archivos que la PC quiere mandarnos.
      const lista: ArchivoEntrante[] = await respuesta.json();

      // Buscamos el primero que no se esté descargando ni haya fallado.
      const entrante = lista.find(archivoEnCola => !idsDescargando.current.has(archivoEnCola.id) && !idsFallidos.current.has(archivoEnCola.id));

      // Si hay uno...
      if (entrante) {

        // ...le preguntamos al usuario si lo quiere.
        preguntarSiAcepta(ip, entrante);

      }

    } catch {

      // No hacemos nada.
      // El siguiente intervalo volverá a intentar.

    }

  };


  // ============================================================
  // HANDSHAKE = PEDIR PERMISO (PC → celular)
  // ============================================================
  //
  // Antes de descargar, el usuario del celular decide.
  // Rechazar → avisamos a la PC (/discard?reason=rejected)
  // para que lo saque de la cola y muestre "rechazado".

  // Muestra el cartel "¿Lo aceptás?".
  const preguntarSiAcepta = (ip: string, entrante: ArchivoEntrante) => {

    // Mientras el cartel esté abierto no buscamos más archivos.
    esperandoRespuestaRef.current = true;

    // Alert.alert(título, mensaje, botones, opciones).
    Alert.alert(
      // Título.
      '📥 Archivo entrante',
      // Mensaje con el nombre y el tamaño del archivo.
      `La PC quiere enviarte "${entrante.fileName}" (${formatearTamano(entrante.fileSize)}).\n\n¿Lo aceptás?`,
      // Botones.
      [
        {
          // Botón "Rechazar".
          text: 'Rechazar',
          // Estilo de botón de cancelar.
          style: 'cancel',
          // Qué pasa al tocarlo:
          onPress: () => {

            // Ya se respondió el cartel.
            esperandoRespuestaRef.current = false;

            // Por si el aviso a la PC falla, que no
            // vuelva a aparecer el mismo cartel.
            idsFallidos.current.add(entrante.id);

            // Le avisamos a la PC que lo rechazamos (encodeURIComponent protege caracteres raros).
            pedirConLimiteDeTiempo(`http://${ip}:${PUERTO_HTTP}/discard/${encodeURIComponent(entrante.id)}?reason=rejected`, {
              // POST = acción.
              method: 'POST',
            }, 3000).catch(() => {});

          },
        },
        {
          // Botón "Aceptar".
          text: 'Aceptar',
          // Qué pasa al tocarlo:
          onPress: () => {

            // Ya se respondió el cartel.
            esperandoRespuestaRef.current = false;

            // Empezamos la descarga.
            descargarArchivoEntrante(ip, entrante);

          },
        },
      ],
      {
        // No se puede cerrar tocando afuera: hay que elegir.
        cancelable: false,
      }
    );

  };



  // ============================================================
  // PROGRESO + VIGILANTE
  // ============================================================
  //
  // - Actualiza la barra como máximo cada INTERVALO_BARRA_PROGRESO.
  // - Calcula velocidad (MB/s) y tiempo restante.
  // - Si no hay avance en TIEMPO_MAXIMO_SIN_AVANCE, cancela la
  //   tarea con un motivo claro (la conexión quedó colgada).

  // Devuelve dos funciones: alAvanzar (llamarla con cada avance) y detener.
  const seguirTransferencia = (
    // Bytes que ya había (al reanudar), para que la
    // velocidad no salga inflada.
    bytesIniciales = 0
  ) => {

    // Momento en que empezó (para calcular la velocidad).
    const inicioEn = Date.now();

    // Última vez que actualizamos la barra.
    let ultimaActualizacion = 0;

    // Últimos bytes vistos (-1 = todavía ninguno).
    let ultimosBytes = -1;

    // Contamos como "avance" el momento de inicio.
    ultimoAvanceRef.current = inicioEn;

    // Todavía no hay motivo de cancelación.
    motivoCancelacionRef.current = null;

    // Vigilante: cada 2 s revisa si la transferencia se trabó.
    const vigilante = setInterval(() => {

      // Si hay una tarea y pasaron más de 20 s sin avanzar...
      if (tareaActivaRef.current && Date.now() - ultimoAvanceRef.current > TIEMPO_MAXIMO_SIN_AVANCE) {

        // ...guardamos el motivo para mostrarlo
        motivoCancelacionRef.current = `La transferencia se quedó trabada ${TIEMPO_MAXIMO_SIN_AVANCE / 1000} segundos sin avanzar: se perdió la conexión con la PC (puede que el Wi-Fi esté muy débil o que la PC se haya suspendido).`;

        // ...y cancelamos la tarea.
        tareaActivaRef.current.cancel();

      }

    }, 2000);

    // Se llama cada vez que pasan más bytes.
    const alAvanzar = (bytesActuales: number, totalActual: number) => {

      // Hora actual en milisegundos.
      const ahora = Date.now();

      // Si los bytes cambiaron desde la última vez...
      if (bytesActuales !== ultimosBytes) {

        // ...los guardamos
        ultimosBytes = bytesActuales;

        // ...y anotamos que hubo avance (calma al vigilante).
        ultimoAvanceRef.current = ahora;

      }

      // Si actualizamos la barra hace menos de 250 ms...
      if (ahora - ultimaActualizacion < INTERVALO_BARRA_PROGRESO) {
        // ...no la volvemos a dibujar todavía.
        return;
      }

      // Anotamos esta actualización.
      ultimaActualizacion = ahora;

      // Velocidad = bytes pasados en esta sesión / segundos transcurridos
      // (Math.max evita dividir por 0 o dar números negativos).
      const velocidad = Math.max(0, bytesActuales - bytesIniciales) / Math.max(0.001, (ahora - inicioEn) / 1000);

      // Actualizamos la barra a partir del estado anterior.
      setTransferencia(anterior => {

        // Si ya no hay transferencia o ya no está activa, no la tocamos.
        if (!anterior || anterior.estado !== 'active') {
          // La dejamos como estaba.
          return anterior;
        }

        // Si nos dieron el total lo usamos; si no, el que ya sabíamos.
        const totalReal = totalActual > 0 ? totalActual : anterior.bytesTotales;

        // Devolvemos el estado nuevo.
        return {
          // Copiamos lo anterior...
          ...anterior,
          // ...y actualizamos los bytes,
          bytesTransferidos: bytesActuales,
          // el total,
          bytesTotales: totalReal,
          // la velocidad
          velocidad,
          // y el tiempo restante = bytes que faltan / velocidad.
          segundosRestantes: velocidad > 0 && totalReal > 0
            ? Math.max(0, Math.round((totalReal - bytesActuales) / velocidad))
            // Sin velocidad no se puede calcular.
            : null,
        };

      });

    };

    // Se llama al terminar: apaga el vigilante.
    const detener = () => {

      // Frenamos el vigilante.
      clearInterval(vigilante);

      // Ya no hay tarea activa.
      tareaActivaRef.current = null;

    };

    // Devolvemos las dos funciones.
    return {
      // Para avisar el progreso.
      alAvanzar,
      // Para terminar.
      detener,
    };

  };


  // ============================================================
  // DIAGNÓSTICO DE ERRORES
  // ============================================================
  //
  // En vez de mostrar el error técnico, revisamos qué pasó
  // realmente: ¿hay Wi-Fi? ¿están en la misma red? ¿la PC
  // responde? Así el mensaje dice la causa concreta.

  // Devuelve un texto explicando por qué falló.
  const diagnosticarProblema = async (ipPC: string | undefined, error?: any): Promise<string> => {

    // 1) ¿El celular tiene Wi-Fi? Pedimos el estado de la red.
    const estadoRed = await NetInfo.fetch();

    // Si no hay conexión o no es Wi-Fi...
    if (!estadoRed.isConnected || estadoRed.type !== 'wifi') {

      // ...si está con datos móviles lo decimos; si no, que no tiene Wi-Fi.
      return estadoRed.type === 'cellular'
        ? 'El celular está usando datos móviles, no Wi-Fi. Conectalo a la misma red Wi-Fi que la PC.'
        : 'El celular no tiene conexión Wi-Fi. Conectalo a la misma red que la PC.';

    }

    // IP del celular.
    const ipCelular = (estadoRed.details as any)?.ipAddress as string | undefined;

    // 2) ¿Están en la misma red? Comparamos los 3 primeros números de las dos IPs.
    if (ipCelular && ipPC && ipCelular.split('.').slice(0, 3).join('.') !== ipPC.split('.').slice(0, 3).join('.')) {

      // Son redes distintas.
      return `El celular y la PC no están en la misma red Wi-Fi (celular: ${ipCelular}, PC: ${ipPC}). Conectá los dos a la misma red.`;

    }

    // 3) ¿La PC responde al /ping?
    if (ipPC && !(await esPCLocalSend(ipPC))) {

      // No responde.
      return 'La PC no responde. Puede que se haya cerrado la app de escritorio, que la PC se haya suspendido o que el Firewall de Windows esté bloqueando la conexión.';

    }

    // 4) La red está bien: el problema fue durante la transferencia.
    return explicarError(error);

  };


  // Marca la transferencia como fallida SIN borrar
  // el progreso: queda en el % en que se cortó.
  const marcarTransferenciaFallida = async (error: any, ipPC?: string, sePuedeReanudar = false) => {

    // Si el motivo ya se sabe (sin Wi-Fi, trabada, archivo
    // ilegible...) lo usamos; si no, diagnosticamos la red.
    const mensaje = motivoCancelacionRef.current ?? (error instanceof ErrorDeArchivo
      // Error con mensaje ya pensado para el usuario.
      ? error.message
      // Cualquier otro: averiguamos la causa.
      : await diagnosticarProblema(ipPC, error));

    // Ya usamos el motivo: lo borramos.
    motivoCancelacionRef.current = null;

    // Actualizamos la barra.
    setTransferencia(anterior => anterior
      ? {
          // Copiamos lo anterior (así queda el % donde se cortó)...
          ...anterior,
          // ...marcamos el error,
          estado: 'error',
          // velocidad en 0,
          velocidad: 0,
          // sin tiempo restante,
          segundosRestantes: null,
          // el motivo
          mensaje,
          // y si se puede reanudar.
          sePuedeReanudar,
        }
      // Si no había transferencia, la dejamos igual.
      : anterior);

  };


  // ============================================================
  // NOMBRE ÚNICO (si ya existe, "foto (1).jpg")
  // ============================================================

  // Devuelve un archivo nuevo dentro de la app que no pise a otro.
  const obtenerDestinoUnico = (nombreArchivo: string) => {

    // Cambiamos por "_" los caracteres que no se permiten en un nombre de archivo.
    const nombreSeguro = nombreArchivo.replace(/[\\/:*?"<>|]/g, '_');

    // Primer intento: el nombre tal cual en la carpeta de la app.
    let destino = new File(Paths.document, nombreSeguro);

    // Posición del último punto.
    const posicionPunto = nombreSeguro.lastIndexOf('.');

    // Parte del nombre sin extensión ("foto").
    const nombreBase = posicionPunto > 0 ? nombreSeguro.slice(0, posicionPunto) : nombreSeguro;

    // La extensión (".jpg").
    const extension = posicionPunto > 0 ? nombreSeguro.slice(posicionPunto) : '';

    // Número de copia (empieza en 1).
    let numeroCopia = 1;

    // Mientras ya exista un archivo con ese nombre...
    while (destino.exists) {

      // ...probamos con "foto (1).jpg", "foto (2).jpg", etc.
      destino = new File(Paths.document, `${nombreBase} (${numeroCopia})${extension}`);

      // Siguiente número.
      numeroCopia++;

    }

    // Devolvemos el primero libre.
    return destino;

  };


  // ============================================================
  // GUARDAR EN EL CELULAR (carpeta elegida por el usuario)
  // ============================================================
  //
  // Los archivos recibidos llegan a la carpeta privada de la
  // app. "Guardar" los copia a una carpeta pública del
  // celular (ej: Descargas) que el usuario elige UNA vez.
  // La copia es por streams: no carga el archivo en RAM.

  // Abre el selector de carpetas de Android. Devuelve la carpeta o null.
  const elegirCarpetaGuardado = async (): Promise<Directory | null> => {

    try {

      // Mostramos el selector y esperamos a que elija.
      const carpeta = await Directory.pickDirectoryAsync();

      // La recordamos.
      carpetaGuardadoRef.current = carpeta;

      // Mostramos su nombre en pantalla.
      setNombreCarpetaGuardado(carpeta.name);

      // La guardamos en la configuración para la próxima vez.
      guardarConfiguracion({
        // Copiamos lo que ya había guardado...
        ...leerConfiguracion(),
        // ...y cambiamos la carpeta.
        uriCarpetaGuardado: carpeta.uri,
      });

      // Devolvemos la carpeta elegida.
      return carpeta;

    } catch {

      // El usuario cerró el selector sin elegir.
      return null;

    }

  };

  // Guarda un archivo recibido en la Galería (fotos/videos) o en la carpeta elegida.
  const guardarEnCelular = async (recibido: ArchivoRecibido) => {

    // El archivo dentro de la app (el original).
    const archivoOrigen = new File(recibido.uri);

    // Si ya no existe...
    if (!archivoOrigen.exists) {

      // ...avisamos al usuario.
      Alert.alert('❌ No se pudo guardar', 'El archivo ya no está en la app (puede que se haya borrado). Pedile a la PC que lo vuelva a enviar.');

      // Y salimos.
      return;

    }

    // Tipo del archivo (si no lo sabemos, lo deducimos del nombre).
    const tipoMime = recibido.tipoMime ?? tipoSegunNombre(recibido.nombre);

    // ==================================================
    // FOTOS Y VIDEOS → GALERÍA
    // ==================================================
    //
    // Es lo que espera cualquier usuario: que aparezca en
    // la Galería. Solo pide permiso de ESCRITURA (no puede
    // ver tus otras fotos).
    // La expresión /^(image|video)\// revisa si el tipo empieza con "image/" o "video/".
    if (/^(image|video)\//.test(tipoMime)) {

      try {

        // Pedimos permiso (true = solo escritura).
        const permiso = await MediaLibrary.requestPermissionsAsync(true);

        // Si el usuario rechaza, la promesa NO falla:
        // se resuelve con granted = false. Ahí vemos si
        // Android todavía deja volver a preguntar.
        if (!permiso.granted) {

          // ¿Se puede volver a preguntar?
          if (permiso.canAskAgain) {

            // Rechazó una vez: explicamos para qué es
            // y le damos la opción de volver a intentar.
            Alert.alert('🔒 Falta permiso', 'Sin el permiso de fotos y videos no podemos guardar el archivo en la Galería. Solo se usa para guardar, no para ver tus fotos.', [
              {
                // Botón para no hacer nada.
                text: 'Ahora no',
                // Estilo cancelar.
                style: 'cancel',
              },
              {
                // Botón para pedir el permiso otra vez.
                text: 'Volver a pedir',
                // Al tocarlo, volvemos a llamar a esta misma función.
                onPress: () => {
                  // Reintenta guardar (vuelve a pedir el permiso).
                  guardarEnCelular(recibido);
                },
              },
            ]);

          } else {

            // Rechazó "para siempre": Android ya no muestra
            // el cartel, solo se puede activar en Ajustes.
            Alert.alert('🔒 Permiso bloqueado', 'Rechazaste el permiso de fotos y videos. Para guardar en la Galería, activalo en Ajustes → Permisos de LocalSend. El archivo sigue disponible en la app.', [
              {
                // Botón para no hacer nada.
                text: 'Cancelar',
                // Estilo cancelar.
                style: 'cancel',
              },
              {
                // Botón que lleva a los Ajustes de la app.
                text: 'Abrir Ajustes',
                // Al tocarlo:
                onPress: () => {
                  // Abrimos los Ajustes (si falla, no hacemos nada).
                  Linking.openSettings().catch(() => {});
                },
              },
            ]);

          }

          // Sin permiso no podemos seguir.
          return;

        }

        // Con permiso: copiamos el archivo a la Galería.
        await MediaLibrary.saveToLibraryAsync(recibido.uri);

        // Marcamos en la lista que quedó guardado.
        setRecibidos(anterior => anterior.map(archivoDeLista => archivoDeLista.id === recibido.id
          ? {
              // Copiamos sus datos...
              ...archivoDeLista,
              // ...y anotamos dónde se guardó.
              guardadoEn: 'la Galería',
            }
          // Los demás quedan igual.
          : archivoDeLista));

        // Avisamos al usuario.
        Alert.alert('✅ Guardado en la Galería', `"${recibido.nombre}" ya está en la Galería del celular.`);

        // Listo.
        return;

      } catch (error) {

        // Si la Galería falla, seguimos con la carpeta.
        console.log('No se pudo guardar en la Galería:', error);

      }

    }

    // ==================================================
    // OTROS ARCHIVOS → CARPETA ELEGIDA
    // ==================================================

    // La carpeta elegida (puede ser null si nunca eligió).
    let carpeta = carpetaGuardadoRef.current;

    // Si todavía no eligió carpeta...
    if (!carpeta) {

      // ...le explicamos y le ofrecemos elegirla.
      Alert.alert('📁 Elegí dónde guardar', 'Se va a abrir el selector de carpetas.\n\nOjo: Android NO deja elegir "Descargas" directamente. Entrá a Descargas, tocá "Crear carpeta" (por ejemplo "LocalSend") y elegí esa. Se usa siempre; podés cambiarla después.', [
        {
          // Botón para no hacer nada.
          text: 'Cancelar',
          // Estilo cancelar.
          style: 'cancel',
        },
        {
          // Botón para elegir la carpeta.
          text: 'Elegir carpeta',
          // Al tocarlo:
          onPress: async () => {

            // Abrimos el selector.
            const carpetaElegida = await elegirCarpetaGuardado();

            // Si eligió una...
            if (carpetaElegida) {
              // ...volvemos a intentar guardar.
              guardarEnCelular(recibido);
            }

          },
        },
      ]);

      // Salimos (se sigue cuando elija la carpeta).
      return;

    }

    try {

      // Primer intento: crear el archivo con su nombre y copiarle el contenido.
      try {

        // createFile respeta el nombre; si ya existe,
        // Android lo renombra a "nombre (1).ext".
        const archivoDestino = carpeta.createFile(recibido.nombre, tipoMime);

        // Copiamos el contenido (overwrite = pisar si hiciera falta).
        await archivoOrigen.copy(archivoDestino, {
          // Pisar el archivo destino.
          overwrite: true,
        });

      } catch (primerError) {

        // El primer intento falló: lo anotamos.
        console.log('createFile + copy falló, copio a la carpeta:', primerError);

        // Alternativa: copiar directo dentro de la carpeta.
        await archivoOrigen.copy(carpeta);

      }

      // Marcamos en la lista que quedó guardado (y en qué carpeta).
      setRecibidos(anterior => anterior.map(archivoDeLista => archivoDeLista.id === recibido.id
        ? {
            // Copiamos sus datos...
            ...archivoDeLista,
            // ...y anotamos el nombre de la carpeta.
            guardadoEn: carpeta?.name ?? 'la carpeta elegida',
          }
        // Los demás quedan igual.
        : archivoDeLista));

      // Avisamos al usuario.
      Alert.alert('✅ Guardado', `"${recibido.nombre}" se guardó en la carpeta "${carpeta.name}" del celular.`);

    } catch (error: any) {

      // No se pudo guardar: lo anotamos.
      console.log('Error guardando:', error);

      // La carpeta ya no existe o se perdió el permiso:
      // pedimos elegirla de nuevo.
      carpetaGuardadoRef.current = null;

      // Borramos el nombre de la pantalla.
      setNombreCarpetaGuardado(null);

      // Texto del error.
      const textoError = String(error?.message ?? '');

      // Elegimos el mensaje según el tipo de error.
      Alert.alert('❌ No se pudo guardar', /space|ENOSPC/i.test(textoError)
        // Falta espacio.
        ? 'No hay espacio suficiente en el celular.'
        // Ya existe un archivo con ese nombre.
        : /exist/i.test(textoError)
          ? 'Ya hay un archivo con ese nombre en la carpeta y no se pudo reemplazar. Tocá "Guardar" de nuevo y elegí otra carpeta.'
          // Se perdió el permiso.
          : /permission|denied|security/i.test(textoError)
            ? 'La app perdió el permiso para escribir en esa carpeta. Tocá "Guardar" de nuevo y elegí la carpeta otra vez.'
            // Cualquier otro.
            : `No se pudo escribir en la carpeta elegida (puede que se haya borrado). Tocá "Guardar" de nuevo y elegí otra carpeta.\n\nDetalle: ${textoError}`);

    }

  };

  // Abre el archivo con otra app del celular ("Abrir con...").
  const abrirConOtraApp = async (recibido: ArchivoRecibido) => {

    try {

      // Mostramos el menú de compartir de Android.
      await Sharing.shareAsync(recibido.uri, {
        // Le decimos qué tipo es, para que ofrezca las apps correctas.
        mimeType: recibido.tipoMime ?? tipoSegunNombre(recibido.nombre),
        // Título del menú.
        dialogTitle: 'Abrir con...',
      });

    } catch {

      // No hay apps que lo abran.
      Alert.alert('❌ Error', 'No hay ninguna app instalada que pueda abrir este archivo.');

    }

  };


  // ============================================================
  // DESCARGAR ARCHIVO (PC → celular)
  // ============================================================

  // Baja el archivo de la PC (o sigue desde donde quedó).
  const descargarArchivoEntrante = async (ip: string, entrante: ArchivoEntrante) => {

    // Marcamos que lo estamos descargando (para no preguntar otra vez).
    idsDescargando.current.add(entrante.id);

    // Si había fallado antes, lo sacamos de los fallidos.
    idsFallidos.current.delete(entrante.id);

    // ¿Quedó una parte de un intento anterior?
    const uriParcial = descargasParcialesRef.current.get(entrante.id);

    // Si quedó, armamos el objeto archivo; si no, null.
    const archivoParcial = uriParcial ? new File(uriParcial) : null;

    // Desde qué byte seguir: solo si el parcial existe, tiene algo y no está completo.
    const reanudarDesde = archivoParcial?.exists && (archivoParcial.size ?? 0) > 0 && (archivoParcial.size ?? 0) < entrante.fileSize
      // Seguimos desde su tamaño actual.
      ? archivoParcial.size ?? 0
      // Si no, desde cero.
      : 0;

    // Dónde se guarda: el parcial (si reanudamos) o un archivo nuevo con nombre único.
    const destino = reanudarDesde > 0 && archivoParcial
      ? archivoParcial
      : obtenerDestinoUnico(entrante.fileName);

    // Mostramos la barra de progreso.
    setTransferencia({
      // Estamos recibiendo.
      sentido: 'receive',
      // En curso.
      estado: 'active',
      // Nombre del archivo.
      nombreArchivo: entrante.fileName,
      // Lo que ya tenemos.
      bytesTransferidos: reanudarDesde,
      // Tamaño total.
      bytesTotales: entrante.fileSize,
      // Todavía sin velocidad.
      velocidad: 0,
      // Todavía sin tiempo restante.
      segundosRestantes: null,
      // Guardamos el archivo para poder reintentar.
      archivoEntrante: entrante,
      // Y la IP de la PC.
      ipPC: ip,
    });

    // Arrancamos el seguimiento del progreso.
    const seguimiento = seguirTransferencia(reanudarDesde);

    // Dirección de descarga del archivo en la PC.
    const urlDescarga = `http://${ip}:${PUERTO_HTTP}/download/${entrante.id}`;

    // Android llama a esta función a medida que llegan bytes.
    const alAvanzarDescarga = ({
      // Bytes escritos hasta ahora.
      bytesWritten: bytesEscritos,
      // Bytes totales.
      totalBytes: bytesTotalesTarea,
    }: {
      bytesWritten: number;
      totalBytes: number;
    }) => {

      // Se lo pasamos al seguimiento (actualiza la barra).
      seguimiento.alAvanzar(bytesEscritos, bytesTotalesTarea);

    };

    try {

      // El archivo descargado (null si se interrumpió).
      let archivoDescargado: File | null;

      // ¿Hay que reanudar?
      if (reanudarDesde > 0) {

        // ==================================================
        // REANUDAR
        // ==================================================
        //
        // Le pedimos a la PC solo lo que falta
        // ("Range: bytes=<lo que ya tenemos>-") y se agrega
        // al final del archivo parcial.
        console.log('⏯️ Reanudando desde', formatearTamano(reanudarDesde));

        // Creamos una descarga "reanudable" (nombres en inglés = los pide la librería).
        const tareaNativa = DownloadTask.fromSavable({
          // De dónde bajar.
          url: urlDescarga,
          // Dónde escribir.
          fileUri: destino.uri,
          // Es un archivo, no una carpeta.
          isDirectory: false,
          // Desde qué byte seguir.
          resumeData: String(reanudarDesde),
        }, {
          // Función de progreso.
          onProgress: alAvanzarDescarga,
        });

        // La guardamos para poder cancelarla.
        tareaActivaRef.current = tareaNativa;

        // Reanudamos y esperamos a que termine.
        archivoDescargado = await tareaNativa.resumeAsync();

      } else {

        // El archivo se escribe directo al disco a medida
        // que llega: nunca se carga completo en memoria.
        const tareaNativa = File.createDownloadTask(urlDescarga, destino, {
          // Función de progreso.
          onProgress: alAvanzarDescarga,
        });

        // La guardamos para poder cancelarla.
        tareaActivaRef.current = tareaNativa;

        // Descargamos y esperamos a que termine.
        archivoDescargado = await tareaNativa.downloadAsync();

      }

      // Si no hay archivo, la descarga se cortó.
      if (!archivoDescargado) {

        // Lanzamos un error (salta al catch).
        throw new Error('La descarga se interrumpió antes de terminar.');

      }

      // PRUEBA DE INTEGRIDAD:
      // el peso tiene que ser exactamente el mismo que en la PC.
      if (entrante.fileSize > 0 && archivoDescargado.size !== entrante.fileSize) {

        // Si llegó incompleto lo borramos.
        try {
          // Borra el archivo.
          archivoDescargado.delete();
        } catch {}

        // Y avisamos con un mensaje claro.
        throw new ErrorDeArchivo(`El archivo llegó incompleto (${formatearTamano(archivoDescargado.size ?? 0)} de ${formatearTamano(entrante.fileSize)}): seguramente se cortó la conexión justo al final. Tocá "Reintentar".`);

      }

      // Llegó bien: lo anotamos.
      console.log('📥 Archivo recibido:', archivoDescargado.uri);

      // Ya no hay parcial pendiente.
      descargasParcialesRef.current.delete(entrante.id);

      // Ponemos la barra en "terminado" (100%).
      setTransferencia(anterior => anterior
        ? {
            // Copiamos lo anterior...
            ...anterior,
            // ...terminado,
            estado: 'done',
            // todos los bytes,
            bytesTransferidos: entrante.fileSize,
            // no falta nada.
            segundosRestantes: 0,
          }
        : anterior);

      // Armamos el registro para la lista de recibidos.
      const nuevoRecibido: ArchivoRecibido = {
        // Mismo código que en la PC.
        id: entrante.id,
        // Nombre con el que quedó guardado.
        nombre: archivoDescargado.name,
        // Dónde quedó.
        uri: archivoDescargado.uri,
        // Tamaño.
        tamano: entrante.fileSize,
        // El tipo según la extensión: lo necesitan "Abrir"
        // (para elegir la app) y "Guardar".
        tipoMime: archivoDescargado.type || tipoSegunNombre(archivoDescargado.name),
        // Fecha de llegada.
        recibidoEn: Date.now(),
      };

      // Lo agregamos arriba de la lista.
      setRecibidos(anterior => {

        // Nueva lista: el nuevo primero, después los anteriores (máximo 30).
        const listaNueva = [nuevoRecibido, ...anterior].slice(0, 30);

        // La guardamos en el JSON para no perderla al cerrar la app.
        guardarConfiguracion({
          // Lo que ya había...
          ...leerConfiguracion(),
          // ...con la lista nueva.
          archivosRecibidos: listaNueva,
        });

        // Devolvemos la lista para la pantalla.
        return listaNueva;

      });

      // Preguntamos si quiere guardarlo ya.
      Alert.alert(

        // Título.
        '📥 Archivo recibido',

        // Mensaje.
        `"${entrante.fileName}" (${formatearTamano(entrante.fileSize)}) llegó completo.\n\n¿Querés guardarlo en el celular? (las fotos y videos van a la Galería)`,

        // Botones.
        [

          {
            // Dejarlo para después.
            text: 'Más tarde',
            // Estilo cancelar.
            style: 'cancel',
          },

          {
            // Guardarlo ahora.
            text: 'Guardar',
            // Al tocarlo, lo guardamos.
            onPress: () => guardarEnCelular(nuevoRecibido),
          },

        ]

      );

    } catch (error: any) {

      // La descarga falló: lo anotamos.
      console.log('❌ Error descargando:', error);

      // Texto del error.
      const textoError = String(error?.message ?? '');

      // La PC ya no tiene el archivo (se cerró la app de
      // escritorio): no hay nada que reanudar.
      const pcYaNoLoTiene = /HTTP 404|HTTP 416/.test(textoError);

      // Si quedó una parte, la GUARDAMOS para reanudar.
      let tamanoParcial = 0;

      // Medimos cuánto se alcanzó a bajar.
      try {
        // Si el archivo existe tomamos su tamaño; si no, 0.
        tamanoParcial = destino.exists ? destino.size ?? 0 : 0;
      } catch {}

      // Se puede reanudar si: la PC lo sigue teniendo, no fue un error del archivo
      // y quedó una parte (ni vacía ni completa).
      const sePuedeReanudar = !pcYaNoLoTiene && !(error instanceof ErrorDeArchivo) && tamanoParcial > 0 && tamanoParcial < entrante.fileSize;

      // Si se puede...
      if (sePuedeReanudar) {

        // ...guardamos dónde quedó el parcial.
        descargasParcialesRef.current.set(entrante.id, destino.uri);

      } else {

        // Si no, olvidamos el parcial...
        descargasParcialesRef.current.delete(entrante.id);

        // ...y lo borramos del celular.
        try {
          // Solo si existe.
          if (destino.exists) {
            // Lo borramos.
            destino.delete();
          }
        } catch {}

      }

      // No se reintenta solo: espera al usuario.
      idsFallidos.current.add(entrante.id);

      // Frenamos el vigilante.
      seguimiento.detener();

      // Mostramos el error en la barra.
      await marcarTransferenciaFallida(pcYaNoLoTiene
        // Si la PC ya no lo tiene, mensaje específico.
        ? new ErrorDeArchivo('La PC ya no tiene este archivo (seguramente se cerró o se reinició la app de escritorio). Volvé a enviarlo desde la PC.')
        // Si no, el error original.
        : error, ip, sePuedeReanudar);

    } finally {

      // Pase lo que pase, frenamos el vigilante...
      seguimiento.detener();

      // ...y sacamos el archivo de "descargando".
      idsDescargando.current.delete(entrante.id);

    }

  };


  // ============================================================
  // SELECCIONAR ARCHIVO
  // ============================================================

  // Abre el selector de archivos del celular.
  const elegirArchivo = async () => {

    try {

      // Usamos el selector de expo-file-system: devuelve el
      // archivo como content:// (Storage Access Framework).
      //
      // ¿Por qué no expo-document-picker? Porque copia el
      // archivo a cache/DocumentPicker/ y Expo Go no deja
      // leer esa carpeta ("Location ... isn't readable").
      // Además, sin copia no se duplica un video de 500 MB.
      const resultado = await File.pickFileAsync();

      // Si cerró el selector sin elegir...
      if (resultado.canceled || !resultado.result) {

        // ...no hacemos nada.
        return;

      }

      // El archivo elegido.
      const archivoElegido = resultado.result;

      // Si no se puede leer...
      if (!archivoElegido.exists) {

        // ...avisamos (suele pasar con archivos de la nube).
        throw new ErrorDeArchivo('No se pudo leer el archivo elegido. Si está en Google Drive u otra nube, descargalo primero al celular y volvé a elegirlo.');

      }

      // Tamaño en bytes (0 si no se sabe).
      const tamano = archivoElegido.size ?? 0;

      // Un archivo vacío no tiene sentido enviarlo.
      if (tamano === 0) {

        // Avisamos.
        throw new ErrorDeArchivo('El archivo elegido está vacío (0 bytes) o es de una nube que no lo descargó. Elegí otro.');

      }

      // Nos aseguramos de que el nombre tenga extensión.
      const nombre = asegurarExtension(archivoElegido.name, archivoElegido.type);

      // Guardamos el archivo elegido (aparece en la pantalla).
      setArchivoSeleccionado({

        // Nombre.
        nombre,

        // Dirección del archivo.
        uri: archivoElegido.uri,

        // Tamaño.
        tamano,

        // Tipo (si Android no lo sabe, lo deducimos del nombre).
        tipoMime: archivoElegido.type || tipoSegunNombre(nombre),

      });

    } catch (error: any) {

      // Algo falló: lo anotamos.
      console.log('Error seleccionando:', error);

      // Texto del error.
      const textoError = String(error?.message ?? '');

      // Mostramos un mensaje según el error.
      Alert.alert(

        // Título.
        '❌ No se pudo usar ese archivo',

        // Si es un error nuestro, usamos su mensaje.
        error instanceof ErrorDeArchivo
          ? error.message
          // Si falta espacio...
          : /space|ENOSPC/i.test(textoError)
            ? 'No hay espacio suficiente en el celular para preparar el archivo.'
            // Cualquier otro.
            : 'No se pudo abrir el archivo elegido. Probá elegirlo desde otra carpeta (por ejemplo "Descargas" o la Galería).'

      );

    }

  };


  // ============================================================
  // ENVIAR ARCHIVO (celular → PC)
  // ============================================================

  // Pide permiso a la PC y, si acepta, sube el archivo.
  const iniciarEnvio = async (pcDestino: Dispositivo, archivoAEnviar: ArchivoSeleccionado) => {

    // Usamos la IP con la que estamos conectados (o la del dispositivo).
    const ipPC = ipPCConectadaRef.current ?? pcDestino.ip;

    // Mostramos la barra en "esperando que acepte".
    setTransferencia({
      // Estamos enviando.
      sentido: 'send',
      // En curso.
      estado: 'active',
      // Nombre del archivo.
      nombreArchivo: archivoAEnviar.nombre,
      // Todavía nada enviado.
      bytesTransferidos: 0,
      // Tamaño total.
      bytesTotales: archivoAEnviar.tamano,
      // Sin velocidad.
      velocidad: 0,
      // Sin tiempo restante.
      segundosRestantes: null,
      // A qué PC (para reintentar).
      dispositivo: pcDestino,
      // IP de la PC.
      ipPC,
      // Si es una imagen, la mostramos como miniatura.
      uriMiniatura: archivoAEnviar.tipoMime.startsWith('image/')
        ? archivoAEnviar.uri
        : undefined,
      // Esperando que la PC toque "Aceptar".
      esperandoAceptacion: true,
    });

    // Se crea recién cuando la PC acepta: si no, el
    // vigilante contaría el tiempo que el usuario tarda
    // en tocar "Aceptar" como si la red estuviera trabada.
    let seguimiento: ReturnType<typeof seguirTransferencia> | null = null;

    // Mientras esperamos la respuesta no se arranca otra transferencia.
    esperandoRespuestaRef.current = true;

    try {

      // El archivo en el celular.
      const archivoEnDisco = new File(archivoAEnviar.uri);

      // Si se borró o se movió...
      if (!archivoEnDisco.exists) {

        // ...avisamos.
        throw new ErrorDeArchivo('El archivo ya no está en el celular (se borró o se movió). Seleccionalo de nuevo.');

      }

      // Antes de empezar, confirmamos que la PC responde
      // para dar un error claro y no quedarnos esperando.
      if (!(await esPCLocalSend(ipPC))) {

        // No responde: error (el diagnóstico explica por qué).
        throw new Error('PC sin respuesta');

      }

      // Tamaño real del archivo.
      const tamanoArchivo = archivoEnDisco.size ?? archivoAEnviar.tamano;

      // Dirección base del servidor de la PC.
      const urlBase = `http://${ipPC}:${pcDestino.port || PUERTO_HTTP}`;

      // ======================================================
      // HANDSHAKE: pedir permiso a la PC
      // ======================================================
      //
      // Primero mandamos SOLO los datos del archivo (JSON). La PC
      // muestra "Aceptar / Rechazar" y no responde hasta que
      // el usuario decide. Si acepta, nos da un token (código
      // secreto) y recién ahí mandamos los bytes.

      // Mensaje en la consola.
      console.log('❓ Pidiendo permiso a la PC para', archivoAEnviar.nombre);

      // Pedimos permiso (esperamos hasta 65 s a que el usuario de la PC conteste).
      const respuestaPermiso = await pedirConLimiteDeTiempo(`${urlBase}/prepare-upload`, {
        // POST = mandar datos.
        method: 'POST',
        // El cuerpo es JSON.
        headers: {
          'Content-Type': 'application/json',
        },
        // Datos del archivo (en inglés porque la PC los espera así).
        body: JSON.stringify({
          // Nombre.
          fileName: archivoAEnviar.nombre,
          // Tamaño.
          size: tamanoArchivo,
          // Tipo.
          mimeType: archivoAEnviar.tipoMime,
          // Nombre del celular.
          alias: NOMBRE_DEL_CELULAR,
        }),
      }, TIEMPO_ESPERA_ACEPTACION);

      // Leemos la respuesta (si no es JSON, usamos un objeto vacío).
      const respuestaPC = await respuestaPermiso.json().catch(() => ({}));

      // Si respondió con error o no nos dio token...
      if (!respuestaPermiso.ok || !respuestaPC?.token) {

        // Rechazo: NO es un error. La app sigue
        // funcionando y el archivo queda elegido.
        const motivo = respuestaPC?.error ?? 'La PC rechazó el archivo.';

        // Lo anotamos.
        console.log('🚫 Rechazado por la PC:', motivo);

        // Mostramos el rechazo en la barra.
        setTransferencia(anterior => anterior
          ? {
              // Copiamos lo anterior...
              ...anterior,
              // ...terminó (no es un error de red, pero se muestra en rojo),
              estado: 'error',
              // ya no esperamos,
              esperandoAceptacion: false,
              // fue rechazado,
              fueRechazado: true,
              // sin velocidad,
              velocidad: 0,
              // sin tiempo,
              segundosRestantes: null,
              // y el motivo.
              mensaje: motivo,
            }
          : anterior);

        // Cartel para el usuario.
        Alert.alert('🚫 Envío rechazado', `${motivo}\n\nNo se envió ningún dato. Podés volver a intentarlo cuando quieras.`);

        // Salimos.
        return;

      }

      // La PC aceptó: ya no esperamos respuesta.
      esperandoRespuestaRef.current = false;

      // Sacamos el "esperando que acepte" de la barra.
      setTransferencia(anterior => anterior
        ? {
            // Copiamos lo anterior...
            ...anterior,
            // ...ya aceptó.
            esperandoAceptacion: false,
          }
        : anterior);

      // Ahora sí empezamos a medir el progreso.
      seguimiento = seguirTransferencia();

      // Dirección de subida: nombre, tamaño y el token que nos dio la PC.
      const urlSubida = `${urlBase}/upload?fileName=` + encodeURIComponent(archivoAEnviar.nombre) + `&size=${tamanoArchivo}` + `&token=${encodeURIComponent(respuestaPC.token)}`;

      // Lo anotamos.
      console.log('📤 Enviando', archivoAEnviar.nombre, '→', urlSubida);

      // Subida BINARIA y por partes desde el lado nativo:
      // no usa base64 ni carga 500 MB en RAM.
      // (Las opciones van en inglés porque las pide la librería).
      const tareaNativa = archivoEnDisco.createUploadTask(

        // A dónde subir.
        urlSubida,

        {
          // Método POST.
          httpMethod: 'POST',

          // 0 = BINARY_CONTENT (el archivo tal cual)
          uploadType: 0,

          // Tipo del archivo.
          mimeType: archivoAEnviar.tipoMime,

          // Cabecera con el tipo.
          headers: {
            'Content-Type': archivoAEnviar.tipoMime,
          },

          // Android llama a esto a medida que se envían bytes.
          onProgress: ({
            // Bytes enviados.
            bytesSent: bytesEnviados,
            // Bytes totales.
            totalBytes: bytesTotalesTarea,
          }) => {

            // Actualizamos la barra.
            seguimiento?.alAvanzar(bytesEnviados, bytesTotalesTarea);

          },
        }

      );

      // La guardamos para poder cancelarla.
      tareaActivaRef.current = tareaNativa;

      // Subimos y esperamos a que termine.
      const resultado = await tareaNativa.uploadAsync();

      // Si el código no es 2xx (200-299), la PC lo rechazó.
      if (resultado.status < 200 || resultado.status >= 300) {

        // La PC explica el motivo en el JSON.
        let motivo = `La PC rechazó el archivo (código ${resultado.status}).`;

        try {

          // Leemos el JSON de la respuesta.
          const cuerpo = JSON.parse(resultado.body);

          // Si trae un error, lo usamos como motivo.
          if (cuerpo?.error) {
            // Motivo que mandó la PC.
            motivo = `La PC rechazó el archivo: ${cuerpo.error}`;
          }

        } catch {}

        // Lanzamos el error (salta al catch).
        throw new ErrorDeArchivo(motivo);

      }

      // ¡Se envió! Barra al 100%.
      setTransferencia(anterior => anterior
        ? {
            // Copiamos lo anterior...
            ...anterior,
            // ...terminado,
            estado: 'done',
            // todos los bytes,
            bytesTransferidos: archivoAEnviar.tamano,
            // no falta nada.
            segundosRestantes: 0,
          }
        : anterior);

      // Limpiamos el archivo elegido.
      setArchivoSeleccionado(null);

    } catch (error: any) {

      // Falló el envío: lo anotamos.
      console.log('❌ ERROR AL ENVIAR', error);

      // Frenamos el vigilante (si existía).
      seguimiento?.detener();

      // Ya no esperamos que acepte.
      setTransferencia(anterior => anterior
        ? {
            // Copiamos lo anterior...
            ...anterior,
            // ...ya no esperamos.
            esperandoAceptacion: false,
          }
        : anterior);

      // El archivo seleccionado se mantiene
      // para poder reintentar.
      await marcarTransferenciaFallida(error, ipPC);

    } finally {

      // Pase lo que pase, ya no esperamos respuesta...
      esperandoRespuestaRef.current = false;

      // ...y frenamos el vigilante.
      seguimiento?.detener();

    }

  };


  // ============================================================
  // BOTÓN ENVIAR (al tocar una PC de la lista)
  // ============================================================

  // Revisa que se pueda enviar y pide confirmación.
  const confirmarEnvio = (pcDestino: Dispositivo) => {

    // Si no eligió archivo...
    if (!archivoSeleccionado) {

      // ...le avisamos.
      Alert.alert(

        // Título.
        '📂 Seleccionar archivo',

        // Mensaje.
        'Primero seleccioná el archivo que querés enviar.'

      );

      // Salimos.
      return;

    }

    // Si ya hay una transferencia o un cartel de permiso...
    if (tareaActivaRef.current || esperandoRespuestaRef.current) {

      // ...pedimos que espere.
      Alert.alert('⏳ Transferencia en curso', 'Esperá a que termine la transferencia actual.');

      // Salimos.
      return;

    }

    // Copiamos el archivo elegido (por si cambia mientras el cartel está abierto).
    const archivoAEnviar = archivoSeleccionado;

    // Cartel de confirmación.
    Alert.alert(

      // Título.
      '📤 Confirmar envío',

      // Mensaje con nombre, tamaño y destino.
      `¿Enviar "${archivoAEnviar.nombre}" (${formatearTamano(archivoAEnviar.tamano)}) a ${pcDestino.alias}?`,

      // Botones.
      [

        {
          // Botón cancelar.
          text: 'Cancelar',

          // Estilo cancelar.
          style: 'cancel',

        },

        {

          // Botón enviar.
          text: 'Enviar',

          // Al tocarlo:
          onPress: () => {

            // Arrancamos el envío.
            iniciarEnvio(pcDestino, archivoAEnviar);

          },

        },

      ]

    );

  };


  // ============================================================
  // REINTENTAR / CERRAR
  // ============================================================

  // Vuelve a intentar la transferencia que falló.
  const reintentarTransferencia = () => {

    // Si no hay transferencia, no hay nada que reintentar.
    if (!transferencia) {
      // Salimos.
      return;
    }

    // Si era un ENVÍO...
    if (transferencia.sentido === 'send') {

      // Necesitamos el archivo y la PC.
      if (!archivoSeleccionado || !transferencia.dispositivo) {

        // Si falta algo, avisamos.
        Alert.alert('No se puede reintentar', 'Volvé a seleccionar el archivo.');

        // Salimos.
        return;

      }

      // Usamos la IP actual de la PC por si cambió
      // (la buscamos por nombre en la lista; si no está, usamos la vieja).
      const pcDestino = dispositivos.find(dispositivoDeLista => dispositivoDeLista.alias === transferencia.dispositivo?.alias) ?? transferencia.dispositivo;

      // Volvemos a enviar.
      iniciarEnvio(pcDestino, archivoSeleccionado);

      // Salimos.
      return;

    }

    // Si era una RECEPCIÓN...
    if (transferencia.archivoEntrante) {

      // IP de la PC (la actual o la que teníamos).
      const ip = ipPCConectadaRef.current ?? transferencia.ipPC;

      // Si no sabemos la IP...
      if (!ip) {

        // ...avisamos.
        Alert.alert('Sin conexión', 'Todavía no se encontró la PC. Esperá a que aparezca en la lista.');

        // Salimos.
        return;

      }

      // Volvemos a descargar (sigue desde donde quedó si hay parcial).
      descargarArchivoEntrante(ip, transferencia.archivoEntrante);

    }

  };

  // Cierra la tarjeta de la transferencia.
  const cerrarTransferencia = () => {

    // Si se descarta una recepción fallida,
    // le avisamos a la PC para que la saque de la cola.
    if (transferencia?.estado === 'error' && transferencia.sentido === 'receive' && transferencia.archivoEntrante) {

      // ¿Quedó un archivo parcial?
      const uriParcial = descargasParcialesRef.current.get(transferencia.archivoEntrante.id);

      // Si quedó...
      if (uriParcial) {

        // ...lo borramos del celular
        try {
          // Borra el archivo parcial.
          new File(uriParcial).delete();
        } catch {}

        // ...y lo olvidamos.
        descargasParcialesRef.current.delete(transferencia.archivoEntrante.id);

      }

      // IP de la PC.
      const ip = ipPCConectadaRef.current ?? transferencia.ipPC;

      // Si la sabemos...
      if (ip) {

        // ...le pedimos que lo saque de su cola (si falla, no importa).
        pedirConLimiteDeTiempo(`http://${ip}:${PUERTO_HTTP}/discard/${transferencia.archivoEntrante.id}`, {
          // POST = acción.
          method: 'POST',
        }, 1500).catch(() => {});

      }

    }

    // Sacamos la tarjeta de la pantalla.
    setTransferencia(null);

  };


  // ============================================================
  // CONEXIÓN MANUAL (escribir la IP de la PC)
  // ============================================================

  // Abre la ventana para escribir la IP.
  const abrirConexionManual = () => {

    // Vaciamos el campo.
    setIpEscrita('');
    // Mostramos la ventana.
    setVentanaManualVisible(true);

  };


  // Se ejecuta al tocar "Conectar" en la ventana.
  const conectarConIPEscrita = async () => {

    // Sacamos los espacios de los costados.
    const ipDestino = ipEscrita.trim();

    // Revisamos que tenga forma de IP: 4 números de 1 a 3 cifras separados por puntos.
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ipDestino)) {

      // Si no, avisamos.
      Alert.alert('Error', 'Ingresá una IP válida (ej: 192.168.0.10).');

      // Salimos.
      return;

    }

    // Cerramos la ventana.
    setVentanaManualVisible(false);

    // Intentamos conectarnos.
    const conecto = await conectarConPC(ipDestino);

    // Si salió bien...
    if (conecto) {

      // ...avisamos.
      Alert.alert('✅ Conectado', `PC encontrada en ${ipDestino}`);

    } else {

      // Si no, explicamos qué revisar.
      Alert.alert('❌ Error', `No se pudo conectar con ${ipDestino}.\n\nVerificá que la app de escritorio esté abierta, que estén en la misma red Wi-Fi y que el Firewall de Windows permita la conexión.`);

    }

  };



  // ============================================================
  // PANTALLA DE CARGA
  // ============================================================

  // Mientras no sabemos cómo está el Wi-Fi...
  if (cargando) {

    // ...mostramos solo una ruedita girando.
    return (

      // Caja que ocupa toda la pantalla, con el contenido centrado.
      <ThemedView style={estilos.contenedorCargando}>

        {/* La ruedita: grande y del color principal. */}
        <ActivityIndicator size="large" color={paleta.acento} />

      </ThemedView>

    );

  }


  // ============================================================
  // DATOS QUE CALCULAMOS PARA DIBUJAR
  // ============================================================

  // Porcentaje de la barra (0 a 100).
  const porcentajeTransferencia = transferencia && transferencia.bytesTotales > 0
    // bytes pasados / total × 100, sin decimales y sin pasarse de 100.
    ? Math.min(100, Math.floor((transferencia.bytesTransferidos / transferencia.bytesTotales) * 100))
    // Si no hay transferencia, 0.
    : 0;

  // Color de la barra: rojo si falló, verde si terminó, violeta si está en curso.
  const colorTransferencia = transferencia?.estado === 'error'
    ? paleta.error
    : transferencia?.estado === 'done'
      ? paleta.exito
      : paleta.acento;

  // La PC conectada (la buscamos en la lista por su IP).
  const pcConectada = dispositivos.find(dispositivoDeLista => dispositivoDeLista.ip === ipPCConectadaRef.current);

  // Texto del estado: sin Wi-Fi / buscando / conectado.
  const textoEstado = !hayWifi
    ? 'Sin Wi-Fi'
    : buscandoPC
      ? 'Buscando PC...'
      // Si no sabemos el nombre de la PC, decimos "la PC".
      : `Conectado a ${pcConectada?.alias ?? 'la PC'}`;

  // Color del puntito del estado: rojo / amarillo / verde.
  const colorEstado = !hayWifi
    ? paleta.error
    : buscandoPC
      ? paleta.aviso
      : paleta.exito;

  // ============================================================
  // LO QUE SE DIBUJA (JSX = HTML dentro de JavaScript)
  // ============================================================
  return (

    // Caja principal con el color de fondo.
    <View
      // Ocupa toda la pantalla + color de fondo según el modo.
      style={[
        estilos.contenedor,
        {
          backgroundColor: paleta.fondo,
        },
      ]}
    >

      {/* La pantalla entera es scrolleable. Los márgenes
          vienen de los insets (barra de estado y pestañas). */}
      <ScrollView
        // Que ocupe todo el espacio.
        style={estilos.contenedor}
        // Estilo del contenido de adentro.
        contentContainerStyle={[
          estilos.contenidoScroll,
          {
            // Margen de arriba = barra de estado + un espacio.
            paddingTop: margenesSeguros.top + Spacing.three,
            // Margen de abajo = barra de navegación + pestañas + un espacio.
            paddingBottom: margenesSeguros.bottom + BottomTabInset + Spacing.four,
          },
        ]}
        // Ocultamos la barrita de desplazamiento.
        showsVerticalScrollIndicator={false}
      >

          {/* ENCABEZADO: logo, nombre de la app y botón de conexión manual */}

          {/* Fila del encabezado. */}
          <View style={estilos.encabezado}>

            {/* Cuadradito del logo, del color principal. */}
            <View
              style={[
                estilos.logo,
                {
                  backgroundColor: paleta.acento,
                },
              ]}
            >
              {/* Ícono de antena. */}
              <ThemedText style={estilos.textoLogo}>
                📡
              </ThemedText>
            </View>

            {/* Columna con el título y el nombre del celular. */}
            <View style={estilos.textoEncabezado}>

              {/* Título de la app. */}
              <ThemedText style={estilos.tituloApp}>
                LocalSend
              </ThemedText>

              {/* Nombre de este celular (chico, gris, en una sola línea). */}
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {NOMBRE_DEL_CELULAR}
              </ThemedText>

            </View>

            {/* Botón redondo 🔗: abre la conexión manual por IP. */}
            <TouchableOpacity
              // Qué hace al tocarlo.
              onPress={abrirConexionManual}
              // Botón redondo con borde.
              style={[
                estilos.botonIcono,
                {
                  backgroundColor: paleta.tarjeta,
                  borderColor: paleta.borde,
                },
              ]}
            >
              {/* Ícono de cadena. */}
              <ThemedText>
                🔗
              </ThemedText>
            </TouchableOpacity>

          </View>


          {/* ESTADO: "Sin Wi-Fi" / "Buscando PC..." / "Conectado a ..." */}

          {/* Pastilla con el estado. */}
          <View
            style={[
              estilos.pastillaEstado,
              {
                backgroundColor: paleta.tarjeta,
                borderColor: paleta.borde,
              },
            ]}
          >

            {/* Puntito de color (rojo, amarillo o verde). */}
            <View
              style={[
                estilos.puntoEstado,
                {
                  backgroundColor: colorEstado,
                },
              ]}
            />

            {/* Texto del estado en negrita. */}
            <ThemedText
              type="small"
              style={{
                fontWeight: '600',
              }}
            >
              {textoEstado}
            </ThemedText>

          </View>


          {/* PASO 1: ELEGIR ARCHIVO */}

          {/* Tarjeta del paso 1. */}
          <View
            style={[
              estilos.tarjeta,
              {
                backgroundColor: paleta.tarjeta,
                borderColor: paleta.borde,
              },
            ]}
          >

            {/* Fila del título de la tarjeta. */}
            <View style={estilos.filaTituloTarjeta}>

              {/* Circulito con el número del paso. */}
              <View
                style={[
                  estilos.numeroPaso,
                  {
                    backgroundColor: paleta.acentoSuave,
                  },
                ]}
              >
                {/* El número "1". */}
                <ThemedText
                  style={[
                    estilos.textoNumeroPaso,
                    {
                      color: paleta.acento,
                    },
                  ]}
                >
                  1
                </ThemedText>
              </View>

              {/* Título del paso. */}
              <ThemedText style={estilos.tituloTarjeta}>
                Elegí un archivo
              </ThemedText>

            </View>

            {/* Recuadro tocable para elegir el archivo. */}
            <TouchableOpacity
              // Al tocarlo abre el selector de archivos.
              onPress={elegirArchivo}
              // Se transparenta un poco al tocarlo.
              activeOpacity={0.7}
              // Borde verde y sólido si ya hay archivo; gris y punteado si no.
              style={[
                estilos.selectorArchivo,
                {
                  borderColor: archivoSeleccionado
                    ? paleta.exito
                    : paleta.borde,
                  borderStyle: archivoSeleccionado
                    ? 'solid'
                    : 'dashed',
                  backgroundColor: archivoSeleccionado
                    ? paleta.exitoSuave
                    : 'transparent',
                },
              ]}
            >

              {/* Si el archivo es una imagen, mostramos la foto; si no, un ícono. */}
              {archivoSeleccionado?.tipoMime.startsWith('image/') ? (

                // Vista previa de la foto.
                <Image
                  // De dónde sale la imagen.
                  source={{
                    uri: archivoSeleccionado.uri,
                  }}
                  // Tamaño de la vista previa.
                  style={estilos.vistaPrevia}
                  // Que llene el cuadro recortando lo que sobra.
                  contentFit="cover"
                />

              ) : (

                // Ícono grande.
                <ThemedText style={estilos.iconoArchivo}>
                  {/* 📄 si hay archivo, 📂 si no. */}
                  {archivoSeleccionado
                    ? '📄'
                    : '📂'}
                </ThemedText>

              )}

              {/* Texto: datos del archivo o la invitación a elegir uno. */}
              {archivoSeleccionado ? (

                // <> </> agrupa varios elementos sin agregar una caja.
                <>

                  {/* Nombre del archivo (hasta 2 líneas, centrado). */}
                  <ThemedText
                    numberOfLines={2}
                    style={{
                      fontWeight: '600',
                      textAlign: 'center',
                    }}
                  >

                    {archivoSeleccionado.nombre}

                  </ThemedText>

                  {/* Tamaño + aviso de que se puede cambiar. */}
                  <ThemedText type="small" themeColor="textSecondary">

                    {formatearTamano(archivoSeleccionado.tamano)} · tocá para cambiarlo

                  </ThemedText>

                </>

              ) : (

                // Todavía no eligió nada.
                <>

                  {/* Invitación a tocar. */}
                  <ThemedText
                    style={{
                      fontWeight: '600',
                    }}
                  >
                    Tocá para seleccionar
                  </ThemedText>

                  {/* Qué se puede elegir. */}
                  <ThemedText type="small" themeColor="textSecondary">
                    Fotos, videos o documentos
                  </ThemedText>

                </>

              )}

            </TouchableOpacity>

          </View>


          {/* TRANSFERENCIA (envío o recepción): solo si hay una */}

          {transferencia && (

            // Tarjeta con el borde del color de la transferencia.
            <View
              style={[
                estilos.tarjeta,
                {
                  backgroundColor: paleta.tarjeta,
                  borderColor: colorTransferencia,
                },
              ]}
            >

              {/* Fila: miniatura + nombre + porcentaje. */}
              <View style={estilos.filaTransferencia}>

                {/* Si es una foto mostramos la miniatura; si no, un ícono. */}
                {transferencia.uriMiniatura ? (

                  // Miniatura de la foto.
                  <Image
                    source={{
                      uri: transferencia.uriMiniatura,
                    }}
                    style={estilos.miniatura}
                    contentFit="cover"
                  />

                ) : (

                  // Cuadradito con un ícono.
                  <View
                    style={[
                      estilos.miniatura,
                      estilos.miniaturaIcono,
                      {
                        backgroundColor: paleta.acentoSuave,
                      },
                    ]}
                  >
                    {/* ✅ terminó, ⚠️ falló, 📤 enviando, 📥 recibiendo. */}
                    <ThemedText>
                      {transferencia.estado === 'done'
                        ? '✅'
                        : transferencia.estado === 'error'
                          ? '⚠️'
                          : transferencia.sentido === 'send'
                            ? '📤'
                            : '📥'}
                    </ThemedText>
                  </View>

                )}

                {/* Columna con el sentido y el nombre. */}
                <View style={estilos.infoTransferencia}>

                  {/* "Enviando a la PC" o "Recibiendo de la PC". */}
                  <ThemedText type="small" themeColor="textSecondary">

                    {transferencia.sentido === 'send'
                      ? 'Enviando a la PC'
                      : 'Recibiendo de la PC'}

                  </ThemedText>

                  {/* Nombre del archivo en una línea. */}
                  <ThemedText
                    numberOfLines={1}
                    style={{
                      fontWeight: '600',
                    }}
                  >

                    {transferencia.nombreArchivo}

                  </ThemedText>

                </View>

                {/* Porcentaje grande (100 si terminó). */}
                <ThemedText style={estilos.porcentaje}>

                  {transferencia.estado === 'done' ? 100 : porcentajeTransferencia}%

                </ThemedText>

              </View>

              {/* Fondo gris de la barra de progreso. */}
              <View
                style={[
                  estilos.fondoBarraProgreso,
                  {
                    backgroundColor: paleta.rielBarra,
                  },
                ]}
              >

                {/* Parte coloreada: su ancho es el porcentaje. */}
                <View
                  style={[
                    estilos.rellenoBarraProgreso,
                    {
                      width: `${transferencia.estado === 'done' ? 100 : porcentajeTransferencia}%`,
                      backgroundColor: colorTransferencia,
                    },
                  ]}
                />

              </View>

              {/* Si estamos esperando que la PC acepte, lo decimos. */}
              {transferencia.estado === 'active' &&
                transferencia.esperandoAceptacion && (

                <ThemedText type="small" themeColor="textSecondary">
                  ⏳ Esperando que la PC acepte el archivo...
                </ThemedText>

              )}

              {/* Si ya está pasando datos, mostramos 3 recuadros con números. */}
              {transferencia.estado === 'active' &&
                !transferencia.esperandoAceptacion && (

                // Fila de recuadros.
                <View style={estilos.filaEstadisticas}>

                  {/* Lista de [título, valor]; .map dibuja un recuadro por cada uno. */}
                  {[
                    // Cuánto pasó de cuánto.
                    ['Transferido', `${formatearTamano(transferencia.bytesTransferidos)}\nde ${formatearTamano(transferencia.bytesTotales)}`],
                    // Velocidad en MB/s (bytes / 1024 / 1024), con 1 decimal.
                    ['Velocidad', `${(transferencia.velocidad / (1024 * 1024)).toFixed(1)} MB/s`],
                    // Tiempo que falta.
                    ['Falta', formatearTiempoRestante(transferencia.segundosRestantes)],
                  ].map(([etiqueta, valor]) => (

                    // Un recuadro.
                    <View
                      // key = identificador único que React necesita en las listas.
                      key={etiqueta}
                      style={[
                        estilos.estadistica,
                        {
                          backgroundColor: paleta.tarjetaInterna,
                        },
                      ]}
                    >

                      {/* Título chiquito en mayúsculas. */}
                      <ThemedText
                        style={[
                          estilos.etiquetaEstadistica,
                          {
                            color: paleta.textoSecundario,
                          },
                        ]}
                      >
                        {etiqueta}
                      </ThemedText>

                      {/* El número. */}
                      <ThemedText style={estilos.valorEstadistica}>
                        {valor}
                      </ThemedText>

                    </View>

                  ))}

                </View>

              )}

              {/* Si terminó, texto verde "Completado". */}
              {transferencia.estado === 'done' && (

                <ThemedText
                  type="small"
                  style={{
                    color: paleta.exito,
                    fontWeight: '600',
                  }}
                >

                  Completado ({formatearTamano(transferencia.bytesTotales)})

                </ThemedText>

              )}

              {/* Si falló, caja roja con el motivo. */}
              {transferencia.estado === 'error' && (

                <View
                  style={[
                    estilos.cajaError,
                    {
                      backgroundColor: paleta.errorSuave,
                    },
                  ]}
                >

                  {/* El motivo del error, en rojo. */}
                  <ThemedText
                    type="small"
                    style={{
                      color: paleta.error,
                      fontWeight: '600',
                    }}
                  >

                    {transferencia.mensaje}

                  </ThemedText>

                  {/* Explicación de qué pasa si reintenta. */}
                  <ThemedText type="small" themeColor="textSecondary">

                    {transferencia.fueRechazado
                      // Si lo rechazaron.
                      ? 'No se envió ningún dato. Podés volver a enviarlo cuando quieras.'
                      // Si se puede reanudar.
                      : transferencia.sePuedeReanudar
                      ? `Se cortó en ${porcentajeTransferencia}% (${formatearTamano(transferencia.bytesTransferidos)} de ${formatearTamano(transferencia.bytesTotales)}). Lo recibido quedó guardado: tocá "Reanudar" y sigue desde ahí, sin empezar de cero.`
                      // Si hay que empezar de cero.
                      : `Se cortó en ${porcentajeTransferencia}% (${formatearTamano(transferencia.bytesTransferidos)} de ${formatearTamano(transferencia.bytesTotales)}). Al reintentar empieza desde el principio.`}

                  </ThemedText>

                </View>

              )}

              {/* Si ya no está en curso, mostramos los botones. */}
              {transferencia.estado !== 'active' && (

                // Fila de botones a la derecha.
                <View style={estilos.botonesTransferencia}>

                  {/* Botón Cerrar / Descartar. */}
                  <TouchableOpacity
                    // Cierra la tarjeta.
                    onPress={cerrarTransferencia}
                    // Botón con borde.
                    style={[
                      estilos.botonSecundario,
                      {
                        borderColor: paleta.borde,
                      },
                    ]}
                  >

                    {/* "Descartar" si falló una recepción; si no, "Cerrar". */}
                    <ThemedText
                      style={{
                        fontWeight: '600',
                      }}
                    >
                      {transferencia.estado === 'error' &&
                      transferencia.sentido === 'receive'
                        ? 'Descartar'
                        : 'Cerrar'}
                    </ThemedText>

                  </TouchableOpacity>

                  {/* Si falló, botón para reintentar. */}
                  {transferencia.estado === 'error' && (

                    <TouchableOpacity
                      // Vuelve a intentar.
                      onPress={reintentarTransferencia}
                      // Botón relleno del color principal.
                      style={[
                        estilos.botonPrincipal,
                        {
                          backgroundColor: paleta.acento,
                        },
                      ]}
                    >

                      {/* Texto del botón según el caso. */}
                      <ThemedText
                        style={{
                          color: '#fff',
                          fontWeight: '600',
                        }}
                      >
                        {transferencia.fueRechazado
                          ? 'Volver a enviar'
                          : transferencia.sePuedeReanudar
                          ? `Reanudar (${porcentajeTransferencia}%)`
                          : 'Reintentar'}
                      </ThemedText>

                    </TouchableOpacity>

                  )}

                </View>

              )}

            </View>

          )}


          {/* PASO 2: ELEGIR LA PC */}

          {/* Tarjeta del paso 2. */}
          <View
            style={[
              estilos.tarjeta,
              {
                backgroundColor: paleta.tarjeta,
                borderColor: paleta.borde,
              },
            ]}
          >

            {/* Fila del título. */}
            <View style={estilos.filaTituloTarjeta}>

              {/* Circulito con el número del paso. */}
              <View
                style={[
                  estilos.numeroPaso,
                  {
                    backgroundColor: paleta.acentoSuave,
                  },
                ]}
              >
                {/* El número "2". */}
                <ThemedText
                  style={[
                    estilos.textoNumeroPaso,
                    {
                      color: paleta.acento,
                    },
                  ]}
                >
                  2
                </ThemedText>
              </View>

              {/* Título del paso. */}
              <ThemedText style={estilos.tituloTarjeta}>
                Tocá la PC para enviar
              </ThemedText>

            </View>

            {/* Si no hay PCs mostramos el radar; si hay, la lista. */}
            {dispositivos.length === 0 ? (

              // Caja centrada para el radar y el texto.
              <View style={estilos.contenedorVacio}>

                {/* El radar solo se muestra si hay Wi-Fi. */}
                {hayWifi && (

                  // Círculo animado (Animated.View puede animarse).
                  <Animated.View
                    style={[
                      estilos.radar,
                      {
                        borderColor: paleta.acento,
                        backgroundColor: paleta.acentoSuave,
                        // El tamaño sigue a la animación del pulso.
                        transform: [
                          {
                            scale: animacionPulso,
                          },
                        ],
                      },
                    ]}
                  >
                    {/* Ícono de PC dentro del radar. */}
                    <ThemedText style={estilos.iconoRadar}>
                      🖥️
                    </ThemedText>
                  </Animated.View>

                )}

                {/* Texto explicativo centrado. */}
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  style={{
                    textAlign: 'center',
                  }}
                >

                  {hayWifi
                    ? 'Buscando la PC en la red...\nAbrí LocalSend en la compu (mismo Wi-Fi).'
                    : 'Conectá el celular a una red Wi-Fi.'}

                </ThemedText>

              </View>

            ) : (

              // Una tarjeta por cada PC encontrada.
              dispositivos.map(dispositivo => (

                // Toda la tarjeta es un botón.
                <TouchableOpacity

                  // Identificador único: tipo + nombre.
                  key={`${dispositivo.deviceType}-${dispositivo.alias}`}

                  // Se transparenta al tocarla.
                  activeOpacity={0.7}

                  // Borde violeta si ya hay archivo elegido (lista para enviar).
                  style={[
                    estilos.tarjetaDispositivo,
                    {
                      backgroundColor: paleta.tarjetaInterna,
                      borderColor: archivoSeleccionado
                        ? paleta.acento
                        : paleta.borde,
                    },
                  ]}

                  // Al tocarla, pide confirmación para enviar.
                  onPress={() => confirmarEnvio(dispositivo)}

                >

                  {/* Círculo con el ícono de PC. */}
                  <View
                    style={[
                      estilos.circuloIconoDispositivo,
                      {
                        backgroundColor: paleta.acentoSuave,
                      },
                    ]}
                  >
                    {/* Ícono de PC. */}
                    <ThemedText style={estilos.iconoDispositivo}>
                      🖥️
                    </ThemedText>
                  </View>

                  {/* Columna con nombre e IP. */}
                  <View style={estilos.infoDispositivo}>

                    {/* Nombre de la PC en negrita. */}
                    <ThemedText
                      style={{
                        fontWeight: '600',
                      }}
                    >

                      {dispositivo.alias}

                    </ThemedText>

                    {/* IP de la PC en gris. */}
                    <ThemedText type="small" themeColor="textSecondary">

                      {dispositivo.ip}

                    </ThemedText>

                  </View>

                  {/* Si hay archivo elegido, mostramos el chip "Enviar". */}
                  {archivoSeleccionado && (

                    // Pastilla del color principal.
                    <View
                      style={[
                        estilos.chipEnviar,
                        {
                          backgroundColor: paleta.acento,
                        },
                      ]}
                    >
                      {/* Texto blanco "Enviar". */}
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



          {/* PASO 3: ARCHIVOS RECIBIDOS */}

          {/* Tarjeta del paso 3. */}
          <View
            style={[
              estilos.tarjeta,
              {
                backgroundColor: paleta.tarjeta,
                borderColor: paleta.borde,
              },
            ]}
          >

            {/* Fila del título. */}
            <View style={estilos.filaTituloTarjeta}>

              {/* Circulito con el número del paso. */}
              <View
                style={[
                  estilos.numeroPaso,
                  {
                    backgroundColor: paleta.acentoSuave,
                  },
                ]}
              >
                {/* El número "3". */}
                <ThemedText
                  style={[
                    estilos.textoNumeroPaso,
                    {
                      color: paleta.acento,
                    },
                  ]}
                >
                  3
                </ThemedText>
              </View>

              {/* Título del paso. */}
              <ThemedText style={estilos.tituloTarjeta}>
                Archivos recibidos
              </ThemedText>

            </View>

            {/* Texto tocable: dónde se guarda cada cosa (tocar = cambiar carpeta). */}
            <TouchableOpacity onPress={elegirCarpetaGuardado}>
              <ThemedText type="small" themeColor="textSecondary">
                🖼️ Fotos y videos → Galería · 📁 Otros →{' '}
                {/* Nombre de la carpeta elegida, resaltado. */}
                <ThemedText
                  type="small"
                  style={{
                    color: paleta.acento,
                    fontWeight: '600',
                  }}
                >
                  {nombreCarpetaGuardado ?? 'elegir carpeta'} (cambiar)
                </ThemedText>
              </ThemedText>
            </TouchableOpacity>

            {/* Si no llegó nada, un mensaje; si no, la lista. */}
            {recibidos.length === 0 ? (

              // Mensaje centrado.
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

              // Una fila por cada archivo recibido.
              recibidos.map(recibido => (

                // Fila con borde.
                <View
                  // Identificador único (código + dirección).
                  key={recibido.id + recibido.uri}
                  style={[
                    estilos.filaRecibido,
                    {
                      backgroundColor: paleta.tarjetaInterna,
                      borderColor: paleta.borde,
                    },
                  ]}
                >

                  {/* Si es imagen, miniatura; si no, un ícono según el tipo. */}
                  {recibido.tipoMime?.startsWith('image/') ? (

                    // Miniatura de la foto.
                    <Image
                      source={{
                        uri: recibido.uri,
                      }}
                      style={estilos.miniatura}
                      contentFit="cover"
                    />

                  ) : (

                    // Cuadradito con ícono.
                    <View
                      style={[
                        estilos.miniatura,
                        estilos.miniaturaIcono,
                        {
                          backgroundColor: paleta.acentoSuave,
                        },
                      ]}
                    >
                      {/* 🎬 video, 🎵 audio, 📄 cualquier otro. */}
                      <ThemedText>
                        {recibido.tipoMime?.startsWith('video/')
                          ? '🎬'
                          : recibido.tipoMime?.startsWith('audio/')
                            ? '🎵'
                            : '📄'}
                      </ThemedText>
                    </View>

                  )}

                  {/* Columna con nombre y datos. */}
                  <View style={estilos.infoTransferencia}>

                    {/* Nombre del archivo. */}
                    <ThemedText
                      numberOfLines={1}
                      style={{
                        fontWeight: '600',
                      }}
                    >
                      {recibido.nombre}
                    </ThemedText>

                    {/* Tamaño + si está guardado (verde) o no (gris). */}
                    <ThemedText
                      type="small"
                      style={{
                        color: recibido.guardadoEn
                          ? paleta.exito
                          : paleta.textoSecundario,
                      }}
                    >
                      {formatearTamano(recibido.tamano)}
                      {recibido.guardadoEn
                        ? ` · ✓ guardado en ${recibido.guardadoEn}`
                        : ' · sin guardar'}
                    </ThemedText>

                  </View>

                  {/* Botón "Abrir" (con otra app). */}
                  <TouchableOpacity
                    // Abre el menú "Abrir con...".
                    onPress={() => abrirConOtraApp(recibido)}
                    // Botón chico con borde.
                    style={[
                      estilos.botonChico,
                      {
                        borderColor: paleta.borde,
                      },
                    ]}
                  >
                    {/* Texto del botón. */}
                    <ThemedText
                      type="small"
                      style={{
                        fontWeight: '600',
                      }}
                    >
                      Abrir
                    </ThemedText>
                  </TouchableOpacity>

                  {/* Botón "Guardar" (Galería o carpeta). */}
                  <TouchableOpacity
                    // Guarda el archivo.
                    onPress={() => guardarEnCelular(recibido)}
                    // Botón chico relleno del color principal.
                    style={[
                      estilos.botonChico,
                      {
                        backgroundColor: paleta.acento,
                        borderColor: paleta.acento,
                      },
                    ]}
                  >
                    {/* Texto blanco. */}
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


      {/* VENTANA DE CONEXIÓN MANUAL (escribir la IP) */}

      <Modal
        // Se ve solo si ventanaManualVisible es true.
        visible={ventanaManualVisible}
        // Fondo transparente (se ve la app detrás, oscurecida).
        transparent
        // Aparece con un fundido.
        animationType="fade"
        // Botón "atrás" de Android: cierra la ventana.
        onRequestClose={() => setVentanaManualVisible(false)}
      >

        {/* Fondo negro semitransparente. */}
        <View style={estilos.fondoModal}>

          {/* La cajita blanca del centro. */}
          <View
            style={[
              estilos.cajaModal,
              {
                backgroundColor: paleta.tarjeta,
              },
            ]}
          >

            {/* Título de la ventana. */}
            <ThemedText style={estilos.tituloTarjeta}>

              Conectar a la PC manualmente

            </ThemedText>

            {/* Explicación. */}
            <ThemedText type="small" themeColor="textSecondary">

              Usalo si la PC no aparece sola. La IP se ve arriba en la app de escritorio.

            </ThemedText>

            {/* Campo para escribir la IP. */}
            <TextInput

              // Lo que está escrito.
              value={ipEscrita}

              // Cada vez que escribe, guardamos el texto.
              onChangeText={setIpEscrita}

              // Ejemplo gris cuando está vacío.
              placeholder="192.168.0.106"

              // Color del ejemplo.
              placeholderTextColor={paleta.textoSecundario}

              // Teclado numérico.
              keyboardType="numeric"

              // Borde y color del texto según el modo.
              style={[
                estilos.campoModal,
                {
                  borderColor: paleta.borde,
                  color: paleta.texto,
                },
              ]}

            />

            {/* Fila de botones. */}
            <View style={estilos.botonesModal}>

              {/* Botón Cancelar: cierra la ventana. */}
              <TouchableOpacity
                onPress={() => setVentanaManualVisible(false)}
                style={[
                  estilos.botonSecundario,
                  {
                    borderColor: paleta.borde,
                  },
                ]}
              >

                {/* Texto del botón. */}
                <ThemedText>
                  Cancelar
                </ThemedText>

              </TouchableOpacity>

              {/* Botón Conectar: intenta conectarse a la IP escrita. */}
              <TouchableOpacity
                onPress={conectarConIPEscrita}
                style={[
                  estilos.botonPrincipal,
                  {
                    backgroundColor: paleta.acento,
                  },
                ]}
              >

                {/* Texto blanco. */}
                <ThemedText
                  style={{
                    color: '#fff',
                    fontWeight: '600',
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
// Los colores se escriben en hexadecimal: #RRGGBB (rojo, verde, azul).

const PALETAS_DE_COLORES = {

  // Colores para el modo claro.
  light: {
    // Fondo de toda la pantalla (gris muy clarito).
    fondo: '#f4f5fb',
    // Texto principal (casi negro).
    texto: '#171a2c',
    // Texto secundario (gris).
    textoSecundario: '#5d6380',
    // Fondo de las tarjetas (blanco).
    tarjeta: '#ffffff',
    // Fondo de las cosas dentro de una tarjeta.
    tarjetaInterna: '#f7f8fc',
    // Color de los bordes.
    borde: '#e1e4f0',
    // Parte vacía de la barra de progreso.
    rielBarra: '#e6e8f2',
    // Color principal (violeta).
    acento: '#5b5bf0',
    // Violeta suave (fondos de íconos).
    acentoSuave: '#e8e8ff',
    // Verde (todo bien).
    exito: '#16a34a',
    // Verde suave (fondo del archivo elegido).
    exitoSuave: '#e3f7ea',
    // Amarillo (buscando).
    aviso: '#d97706',
    // Rojo (error).
    error: '#dc2626',
    // Rojo suave (fondo de la caja de error).
    errorSuave: '#fde8e8',
  },

  // Colores para el modo oscuro (mismos nombres, colores oscuros).
  dark: {
    // Fondo de toda la pantalla (casi negro).
    fondo: '#0b0c12',
    // Texto principal (casi blanco).
    texto: '#eceef8',
    // Texto secundario (gris).
    textoSecundario: '#9499b5',
    // Fondo de las tarjetas.
    tarjeta: '#171925',
    // Fondo de las cosas dentro de una tarjeta.
    tarjetaInterna: '#1f2232',
    // Color de los bordes.
    borde: '#2a2d40',
    // Parte vacía de la barra de progreso.
    rielBarra: '#2a2d40',
    // Color principal (violeta claro).
    acento: '#7c7cff',
    // Violeta oscuro (fondos de íconos).
    acentoSuave: '#23244a',
    // Verde (todo bien).
    exito: '#22c55e',
    // Verde oscuro (fondo del archivo elegido).
    exitoSuave: '#0f2a1a',
    // Amarillo (buscando).
    aviso: '#f59e0b',
    // Rojo (error).
    error: '#f87171',
    // Rojo oscuro (fondo de la caja de error).
    errorSuave: '#2d1416',
  },

};


// ============================================================
// ESTILOS (como el CSS de una página web)
// ============================================================
// flex: 1 = ocupar todo el espacio libre.
// Los números son "puntos" de pantalla (se ven igual en cualquier celular).

const estilos = StyleSheet.create({

  // Caja que ocupa toda la pantalla.
  contenedor: {
    // Ocupa todo el espacio.
    flex: 1,
  },

  // Pantalla de carga.
  contenedorCargando: {
    // Ocupa todo el espacio.
    flex: 1,
    // Centrado vertical.
    justifyContent: 'center',
    // Centrado horizontal.
    alignItems: 'center',
  },

  // Contenido de la lista desplazable.
  contenidoScroll: {
    // Puede crecer para llenar la pantalla.
    flexGrow: 1,
    // Ancho completo...
    width: '100%',
    // ...pero sin pasarse del máximo (en tablets).
    maxWidth: MaxContentWidth,
    // Centrado en la pantalla.
    alignSelf: 'center',
    // Margen a los costados.
    paddingHorizontal: Spacing.three,
    // Espacio entre tarjetas.
    gap: Spacing.three,
  },

  // Fila del encabezado.
  encabezado: {
    // Elementos uno al lado del otro.
    flexDirection: 'row',
    // Centrados verticalmente.
    alignItems: 'center',
    // Espacio entre ellos.
    gap: 12,
  },

  // Cuadradito del logo.
  logo: {
    // Ancho.
    width: 46,
    // Alto.
    height: 46,
    // Esquinas redondeadas.
    borderRadius: 14,
    // Ícono centrado horizontal.
    alignItems: 'center',
    // Ícono centrado vertical.
    justifyContent: 'center',
  },

  // Ícono del logo.
  textoLogo: {
    // Tamaño del emoji.
    fontSize: 22,
    // Alto de línea (para que no se corte).
    lineHeight: 28,
  },

  // Columna de textos del encabezado.
  textoEncabezado: {
    // Ocupa el espacio que sobra (empuja el botón a la derecha).
    flex: 1,
  },

  // Título "LocalSend".
  tituloApp: {
    // Tamaño de letra.
    fontSize: 22,
    // Alto de línea.
    lineHeight: 28,
    // Negrita.
    fontWeight: '700',
  },

  // Botón redondo 🔗.
  botonIcono: {
    // Ancho.
    width: 42,
    // Alto.
    height: 42,
    // Mitad del ancho = círculo.
    borderRadius: 21,
    // Grosor del borde.
    borderWidth: 1,
    // Centrado horizontal.
    alignItems: 'center',
    // Centrado vertical.
    justifyContent: 'center',
  },

  // Pastilla del estado.
  pastillaEstado: {
    // Punto y texto en fila.
    flexDirection: 'row',
    // Centrados verticalmente.
    alignItems: 'center',
    // Solo ocupa lo necesario (pegada a la izquierda).
    alignSelf: 'flex-start',
    // Espacio entre punto y texto.
    gap: 8,
    // Relleno arriba y abajo.
    paddingVertical: 6,
    // Relleno a los costados.
    paddingHorizontal: 12,
    // Muy redondeada (forma de pastilla).
    borderRadius: 999,
    // Grosor del borde.
    borderWidth: 1,
  },

  // Puntito de color del estado.
  puntoEstado: {
    // Ancho.
    width: 8,
    // Alto.
    height: 8,
    // Círculo.
    borderRadius: 4,
  },

  // Tarjeta (cada paso).
  tarjeta: {
    // Esquinas redondeadas.
    borderRadius: 18,
    // Grosor del borde.
    borderWidth: 1,
    // Relleno interno.
    padding: Spacing.three,
    // Espacio entre lo de adentro.
    gap: 10,
  },

  // Fila del título de la tarjeta.
  filaTituloTarjeta: {
    // En fila.
    flexDirection: 'row',
    // Centrados verticalmente.
    alignItems: 'center',
    // Espacio entre número y título.
    gap: 10,
  },

  // Título de la tarjeta.
  tituloTarjeta: {
    // Tamaño de letra.
    fontSize: 16,
    // Negrita.
    fontWeight: '700',
  },

  // Circulito del número de paso.
  numeroPaso: {
    // Ancho.
    width: 24,
    // Alto.
    height: 24,
    // Círculo.
    borderRadius: 12,
    // Centrado horizontal.
    alignItems: 'center',
    // Centrado vertical.
    justifyContent: 'center',
  },

  // Número dentro del circulito.
  textoNumeroPaso: {
    // Tamaño de letra.
    fontSize: 12,
    // Alto de línea.
    lineHeight: 16,
    // Negrita.
    fontWeight: '700',
  },

  // Círculo del radar.
  radar: {
    // Ancho.
    width: 76,
    // Alto.
    height: 76,
    // Círculo.
    borderRadius: 38,
    // Borde grueso.
    borderWidth: 2,
    // Centrado horizontal.
    alignItems: 'center',
    // Centrado vertical.
    justifyContent: 'center',
  },

  // Ícono dentro del radar.
  iconoRadar: {
    // Tamaño del emoji.
    fontSize: 30,
    // Alto de línea.
    lineHeight: 36,
  },

  // Recuadro para elegir archivo.
  selectorArchivo: {
    // Borde grueso.
    borderWidth: 2,
    // Esquinas redondeadas.
    borderRadius: 14,
    // Relleno interno grande.
    padding: Spacing.four,
    // Contenido centrado.
    alignItems: 'center',
    // Espacio entre elementos.
    gap: 4,
  },

  // Ícono grande 📂/📄.
  iconoArchivo: {
    // Tamaño del emoji.
    fontSize: 34,
    // Alto de línea.
    lineHeight: 42,
  },

  // Vista previa de la foto elegida.
  vistaPrevia: {
    // Ancho.
    width: 84,
    // Alto.
    height: 84,
    // Esquinas redondeadas.
    borderRadius: 12,
    // Espacio debajo.
    marginBottom: 6,
  },

  // Fila de la transferencia.
  filaTransferencia: {
    // En fila.
    flexDirection: 'row',
    // Centrados verticalmente.
    alignItems: 'center',
    // Espacio entre elementos.
    gap: 12,
  },

  // Columna de textos de la transferencia.
  infoTransferencia: {
    // Ocupa el espacio que sobra.
    flex: 1,
  },

  // Miniatura (cuadradito de foto o ícono).
  miniatura: {
    // Ancho.
    width: 44,
    // Alto.
    height: 44,
    // Esquinas redondeadas.
    borderRadius: 10,
  },

  // Miniatura cuando es un ícono (lo centra).
  miniaturaIcono: {
    // Centrado horizontal.
    alignItems: 'center',
    // Centrado vertical.
    justifyContent: 'center',
  },

  // Porcentaje grande.
  porcentaje: {
    // Tamaño de letra.
    fontSize: 20,
    // Alto de línea.
    lineHeight: 26,
    // Negrita.
    fontWeight: '700',
  },

  // Caja roja del error.
  cajaError: {
    // Esquinas redondeadas.
    borderRadius: 10,
    // Relleno interno.
    padding: 10,
    // Espacio entre textos.
    gap: 4,
  },

  // Fila de botones de la transferencia.
  botonesTransferencia: {
    // En fila.
    flexDirection: 'row',
    // Pegados a la derecha.
    justifyContent: 'flex-end',
    // Espacio entre botones.
    gap: 10,
  },

  // Botón relleno (acción principal).
  botonPrincipal: {
    // Relleno arriba y abajo.
    paddingVertical: 10,
    // Relleno a los costados.
    paddingHorizontal: 18,
    // Esquinas redondeadas.
    borderRadius: 10,
  },

  // Botón con borde (acción secundaria).
  botonSecundario: {
    // Relleno arriba y abajo.
    paddingVertical: 10,
    // Relleno a los costados.
    paddingHorizontal: 18,
    // Esquinas redondeadas.
    borderRadius: 10,
    // Grosor del borde.
    borderWidth: 1,
  },

  // Fondo de la barra de progreso.
  fondoBarraProgreso: {
    // Alto de la barra.
    height: 10,
    // Ancho completo.
    width: '100%',
    // Bordes redondeados.
    borderRadius: 10,
    // Lo que se sale no se ve (redondea también el relleno).
    overflow: 'hidden',
  },

  // Parte coloreada de la barra.
  rellenoBarraProgreso: {
    // Mismo alto que el fondo.
    height: '100%',
    // Bordes redondeados.
    borderRadius: 10,
  },

  // Tarjeta de una PC en la lista.
  tarjetaDispositivo: {
    // Esquinas redondeadas.
    borderRadius: 14,
    // Relleno interno.
    padding: 12,
    // Elementos en fila.
    flexDirection: 'row',
    // Centrados verticalmente.
    alignItems: 'center',
    // Espacio entre elementos.
    gap: 12,
    // Grosor del borde.
    borderWidth: 1,
  },

  // Círculo del ícono de la PC.
  circuloIconoDispositivo: {
    // Ancho.
    width: 46,
    // Alto.
    height: 46,
    // Círculo.
    borderRadius: 23,
    // Centrado horizontal.
    alignItems: 'center',
    // Centrado vertical.
    justifyContent: 'center',
  },

  // Ícono 🖥️ de la PC.
  iconoDispositivo: {
    // Tamaño del emoji.
    fontSize: 22,
    // Alto de línea.
    lineHeight: 28,
  },

  // Fila de los 3 recuadros (transferido, velocidad, falta).
  filaEstadisticas: {
    // En fila.
    flexDirection: 'row',
    // Espacio entre recuadros.
    gap: 8,
  },

  // Un recuadro de estadística.
  estadistica: {
    // Los 3 ocupan lo mismo.
    flex: 1,
    // Esquinas redondeadas.
    borderRadius: 10,
    // Relleno arriba y abajo.
    paddingVertical: 8,
    // Relleno a los costados.
    paddingHorizontal: 10,
  },

  // Título chiquito del recuadro.
  etiquetaEstadistica: {
    // Letra chica.
    fontSize: 11,
    // Alto de línea.
    lineHeight: 14,
    // En MAYÚSCULAS.
    textTransform: 'uppercase',
    // Semi negrita.
    fontWeight: '600',
  },

  // Número del recuadro.
  valorEstadistica: {
    // Tamaño de letra.
    fontSize: 14,
    // Alto de línea.
    lineHeight: 19,
    // Negrita.
    fontWeight: '700',
  },

  // Fila de un archivo recibido.
  filaRecibido: {
    // Elementos en fila.
    flexDirection: 'row',
    // Centrados verticalmente.
    alignItems: 'center',
    // Espacio entre elementos.
    gap: 10,
    // Relleno interno.
    padding: 10,
    // Esquinas redondeadas.
    borderRadius: 12,
    // Grosor del borde.
    borderWidth: 1,
  },

  // Botones chicos (Abrir / Guardar).
  botonChico: {
    // Relleno arriba y abajo.
    paddingVertical: 6,
    // Relleno a los costados.
    paddingHorizontal: 10,
    // Esquinas redondeadas.
    borderRadius: 8,
    // Grosor del borde.
    borderWidth: 1,
  },

  // Columna con nombre e IP de la PC.
  infoDispositivo: {
    // Ocupa el espacio que sobra.
    flex: 1,
    // Espacio entre nombre e IP.
    gap: 2,
  },

  // Pastilla "Enviar".
  chipEnviar: {
    // Relleno arriba y abajo.
    paddingVertical: 6,
    // Relleno a los costados.
    paddingHorizontal: 12,
    // Forma de pastilla.
    borderRadius: 999,
  },

  // Caja del radar cuando no hay PCs.
  contenedorVacio: {
    // Relleno arriba y abajo.
    paddingVertical: Spacing.three,
    // Centrado horizontal.
    alignItems: 'center',
    // Espacio entre radar y texto.
    gap: 14,
  },

  // Fondo oscuro detrás de la ventana manual.
  fondoModal: {
    // Ocupa toda la pantalla.
    flex: 1,
    // Negro al 50% de transparencia.
    backgroundColor: 'rgba(0,0,0,0.5)',
    // Centrado vertical.
    justifyContent: 'center',
    // Centrado horizontal.
    alignItems: 'center',
  },

  // Cajita de la ventana manual.
  cajaModal: {
    // 88% del ancho de la pantalla.
    width: '88%',
    // Esquinas redondeadas.
    borderRadius: 18,
    // Relleno interno.
    padding: 20,
    // Espacio entre elementos.
    gap: 8,
  },

  // Campo para escribir la IP.
  campoModal: {
    // Grosor del borde.
    borderWidth: 1,
    // Esquinas redondeadas.
    borderRadius: 10,
    // Relleno interno.
    padding: 12,
    // Espacio arriba.
    marginTop: 8,
    // Espacio abajo.
    marginBottom: 8,
    // Tamaño de letra.
    fontSize: 16,
  },

  // Fila de botones de la ventana.
  botonesModal: {
    // En fila.
    flexDirection: 'row',
    // Pegados a la derecha.
    justifyContent: 'flex-end',
    // Espacio entre botones.
    gap: 10,
  },

});
