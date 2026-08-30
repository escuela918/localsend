
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import NetInfo from '@react-native-community/netinfo';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import React, {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Modal,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';


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
  mimeType?: string;
}

interface IncomingFile {
  id: string;
  fileName: string;
  fileSize: number;
}


// ============================================================
// CONFIGURACIÓN
// ============================================================

const WS_PORT = 53318;

const DEVICE_ALIAS =
  `Android-${Platform.OS === 'android' ? 'Phone' : 'Device'}`;


// ============================================================
// COMPONENTE
// ============================================================

export default function HomeScreen() {

  const theme = useTheme();


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

  const [sending, setSending] =
    useState(false);

  const [receiving, setReceiving] =
    useState(false);

  const [scanning, setScanning] =
    useState(false);

  const [modalVisible, setModalVisible] =
    useState(false);

  const [ipInput, setIpInput] =
    useState('');


  // ============================================================
  // REFS
  // ============================================================

  const pulseAnim =
    useRef(new Animated.Value(1)).current;

  const heartbeatRef =
    useRef<any>(null);

  const pollRef =
    useRef<any>(null);

  const incomingRef =
    useRef<any>(null);

  const downloadingIds =
    useRef<Set<string>>(new Set());


  // ============================================================
  // ANIMACIÓN
  // ============================================================

  useEffect(() => {

    if (scanning) {

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

      ).start();

    } else {

      pulseAnim.setValue(1);

    }

  }, [scanning, pulseAnim]);


  // ============================================================
  // INTERNET / WIFI
  // ============================================================

  useEffect(() => {

    const unsubscribe =
      NetInfo.addEventListener(
        state => {

          setIsConnected(
            !!state.isConnected
          );

          setLoading(false);

        }
      );


    return () => {

      unsubscribe();

      if (heartbeatRef.current) {
        clearInterval(
          heartbeatRef.current
        );
      }

      if (pollRef.current) {
        clearInterval(
          pollRef.current
        );
      }

      if (incomingRef.current) {
        clearInterval(
          incomingRef.current
        );
      }

    };

  }, []);


  // ============================================================
  // REGISTRAR CELULAR EN LA PC
  // ============================================================

  const registerWithDesktop =
    async (
      ip: string,
      port = WS_PORT
    ) => {

      const response =
        await fetch(
          `http://${ip}:${port}/register`,
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json',
            },

            body: JSON.stringify({

              alias:
                DEVICE_ALIAS,

              port:
                WS_PORT,

              deviceType:
                'mobile',

            }),

          }
        );


      if (!response.ok) {

        throw new Error(
          `Registro falló: HTTP ${response.status}`
        );

      }


      return response.json();

    };


  // ============================================================
  // OBTENER DISPOSITIVOS
  // ============================================================

  const pollDevices =
    async (
      ip: string,
      port = WS_PORT
    ) => {

      try {

        const response =
          await fetch(
            `http://${ip}:${port}/devices`
          );


        if (!response.ok) {

          throw new Error(
            `HTTP ${response.status}`
          );

        }


        const list: Device[] =
          await response.json();


        setDevices(list);

      } catch (error) {

        console.log(
          'No se pudo consultar /devices:',
          error
        );

      }

    };


  // ============================================================
  // VER SI HAY ARCHIVOS ENTRANTES
  // ============================================================

  const checkIncoming =
    async (
      ip: string,
      port = WS_PORT
    ) => {

      try {

        const response =
          await fetch(
            `http://${ip}:${port}/incoming`
          );


        if (!response.ok) {
          return;
        }


        const list: IncomingFile[] =
          await response.json();


        for (const item of list) {

          if (
            downloadingIds.current.has(
              item.id
            )
          ) {

            continue;

          }


          downloadingIds.current.add(
            item.id
          );


          downloadIncoming(
            ip,
            port,
            item
          );

        }

      } catch (error) {

        console.log(
          'No se pudo consultar /incoming:',
          error
        );

      }

    };


  // ============================================================
  // DESCARGAR ARCHIVO DE LA PC
  // ============================================================

  const downloadIncoming =
    async (
      ip: string,
      port: number,
      item: IncomingFile
    ) => {

      setReceiving(true);


      try {

        const safeName =
          item.fileName
            .replace(/[\\/:*?"<>|]/g, '_');


        const destUri =
          FileSystem.documentDirectory +
          safeName;


        console.log(
          'Descargando:',
          item.fileName
        );


        const result =
          await FileSystem.downloadAsync(

            `http://${ip}:${port}/download/${item.id}`,

            destUri

          );


        if (
          result.status !== 200
        ) {

          Alert.alert(
            'Error',

            `No se pudo descargar "${item.fileName}".`
          );

          return;

        }


        // ======================================================
        // ARCHIVO RECIBIDO
        // ======================================================

        Alert.alert(

          '📥 Archivo recibido',

          `"${item.fileName}" llegó correctamente al celular.`,

          [

            // -----------------------------------------------
            // AHORA NO
            // -----------------------------------------------

            {
              text: 'Más tarde',

              style: 'cancel',

              onPress: () => {

                Alert.alert(
                  '📁 Archivo guardado',

                  `El archivo está guardado dentro del almacenamiento de la aplicación.\n\nArchivo:\n${item.fileName}`
                );

              },

            },


            // -----------------------------------------------
            // GUARDAR
            // -----------------------------------------------

            {

              text: 'Guardar',

              onPress: async () => {

                try {

                  // En Expo Go no podemos garantizar acceso
                  // directo a la galería mediante MediaLibrary
                  // sin tener el módulo nativo incluido.
                  //
                  // Por eso usamos el sistema de compartir
                  // solamente como fallback.

                  const available =
                    await Sharing.isAvailableAsync();


                  if (!available) {

                    Alert.alert(

                      '✅ Guardado',

                      `El archivo quedó guardado en el almacenamiento de la aplicación.\n\n${item.fileName}`

                    );

                    return;

                  }


                  Alert.alert(

                    '📁 Archivo guardado',

                    `El archivo se descargó correctamente.\n\n${item.fileName}\n\nUbicación:\nAlmacenamiento de LocalSend`,

                    [

                      {
                        text: 'OK',
                        style: 'cancel',
                      },

                      {

                        text: 'Abrir / guardar en dispositivo',

                        onPress: async () => {

                          try {

                            await Sharing.shareAsync(
                              result.uri
                            );

                          } catch (error) {

                            console.log(
                              'No se pudo abrir:',
                              error
                            );

                          }

                        },

                      },

                    ]

                  );

                } catch (error) {

                  console.log(
                    'Error guardando:',
                    error
                  );


                  Alert.alert(

                    '📁 Archivo guardado',

                    `El archivo fue descargado correctamente.\n\n${item.fileName}`

                  );

                }

              },

            },


            // -----------------------------------------------
            // COMPARTIR
            // -----------------------------------------------

            {

              text: 'Compartir',

              onPress: async () => {

                try {

                  const available =
                    await Sharing.isAvailableAsync();


                  if (!available) {

                    Alert.alert(
                      'Error',
                      'Compartir no está disponible en este dispositivo.'
                    );

                    return;

                  }


                  await Sharing.shareAsync(
                    result.uri
                  );


                } catch (error) {

                  Alert.alert(
                    'Error',
                    'No se pudo compartir el archivo.'
                  );

                }

              },

            },

          ]

        );

      } catch (error: any) {

        Alert.alert(

          '❌ Error',

          `No se pudo descargar "${item.fileName}".\n\n${error?.message || ''}`

        );

      } finally {

        downloadingIds.current.delete(
          item.id
        );

        setReceiving(false);

      }

    };


  // ============================================================
  // CONECTAR MANUALMENTE
  // ============================================================

  const connectManually =
    () => {

      setIpInput('');

      setModalVisible(true);

    };


  // ============================================================
  // CONECTARSE A PC
  // ============================================================

  const handleConnect =
    async () => {

      if (
        !ipInput ||
        !ipInput.includes('.')
      ) {

        Alert.alert(
          'Error',
          'Dirección IP inválida.'
        );

        return;

      }


      const targetIP =
        ipInput.trim();


      setModalVisible(false);


      try {

        console.log(
          'Conectando con PC:',
          targetIP
        );


        await registerWithDesktop(
          targetIP
        );


        await pollDevices(
          targetIP
        );


        setScanning(true);


        // Limpiar intervalos anteriores

        if (
          heartbeatRef.current
        ) {

          clearInterval(
            heartbeatRef.current
          );

        }


        if (
          pollRef.current
        ) {

          clearInterval(
            pollRef.current
          );

        }


        if (
          incomingRef.current
        ) {

          clearInterval(
            incomingRef.current
          );

        }


        // Heartbeat

        heartbeatRef.current =
          setInterval(

            () => {

              registerWithDesktop(
                targetIP
              ).catch(
                () => {}
              );

            },

            5000

          );


        // Actualizar dispositivos

        pollRef.current =
          setInterval(

            () => {

              pollDevices(
                targetIP
              );

            },

            3000

          );


        // Buscar archivos

        incomingRef.current =
          setInterval(

            () => {

              checkIncoming(
                targetIP
              );

            },

            3000

          );


        Alert.alert(

          '✅ Conectado',

          `Emparejado con ${targetIP}`

        );


      } catch (error: any) {

        Alert.alert(

          '❌ Error',

          `No se pudo conectar.\n\n${error?.message || ''}\n\nRevisá que:\n\n• PC y celular estén en la misma red Wi-Fi\n• La IP sea correcta\n• El puerto 53318 esté permitido por Windows Firewall`

        );

      }

    };


  // ============================================================
  // SELECCIONAR ARCHIVO
  // ============================================================

  const pickFile =
    async () => {

      try {

        const result =
          await DocumentPicker.getDocumentAsync({

            copyToCacheDirectory:
              true,

            multiple:
              false,

          });


        if (
          result.canceled ||
          !result.assets ||
          !result.assets[0]
        ) {

          return;

        }


        const asset =
          result.assets[0];


        console.log(
          '================================='
        );

        console.log(
          'ARCHIVO SELECCIONADO'
        );

        console.log(
          'Nombre:',
          asset.name
        );

        console.log(
          'URI:',
          asset.uri
        );

        console.log(
          'Tamaño:',
          asset.size
        );

        console.log(
          'Tipo:',
          asset.mimeType
        );

        console.log(
          '================================='
        );


        setSelectedFile({

          name:
            asset.name,

          uri:
            asset.uri,

          size:
            asset.size ?? 0,

          mimeType:
            asset.mimeType ??
            'application/octet-stream',

        });


      } catch (error: any) {

        Alert.alert(

          '❌ Error',

          `No se pudo seleccionar el archivo.\n\n${error?.message || ''}`

        );

      }

    };


  // ============================================================
  // ENVIAR ARCHIVO
  //
  // IMPORTANTE:
  // Usamos XMLHttpRequest porque permite enviar el archivo
  // directamente como binario y mostrar progreso.
  //
  // NO usamos:
  // - uploadAsync
  // - copyAsync
  // - blob()
  // - base64
  //
  // ============================================================

  const performUpload =
    async (
      device: Device
    ) => {

      if (!selectedFile) {

        throw new Error(
          'No hay ningún archivo seleccionado.'
        );

      }


      const uploadUrl =
        `http://${device.ip}:${device.port}/upload?fileName=` +
        encodeURIComponent(
          selectedFile.name
        );


      console.log(
        '================================='
      );

      console.log(
        'INICIANDO ENVÍO'
      );

      console.log(
        'Archivo:',
        selectedFile.name
      );

      console.log(
        'URI:',
        selectedFile.uri
      );

      console.log(
        'Destino:',
        device.ip
      );

      console.log(
        'Puerto:',
        device.port
      );

      console.log(
        'URL:',
        uploadUrl
      );

      console.log(
        '================================='
      );


      return new Promise<void>(
        (
          resolve,
          reject
        ) => {

          const xhr =
            new XMLHttpRequest();


          xhr.open(
            'POST',
            uploadUrl,
            true
          );


          xhr.setRequestHeader(
            'Content-Type',
            selectedFile.mimeType ||
            'application/octet-stream'
          );


          // ====================================================
          // PROGRESO
          // ====================================================

          xhr.upload.onprogress =
            event => {

              if (
                event.lengthComputable
              ) {

                const progress =
                  Math.round(
                    (
                      event.loaded /
                      event.total
                    ) * 100
                  );


                console.log(
                  `Enviando: ${progress}%`
                );

              }

            };


          // ====================================================
          // RESPUESTA
          // ====================================================

          xhr.onload =
            () => {

              console.log(
                'Respuesta HTTP:',
                xhr.status
              );


              if (
                xhr.status >= 200 &&
                xhr.status < 300
              ) {

                resolve();

              } else {

                reject(

                  new Error(
                    `La PC respondió HTTP ${xhr.status}`
                  )

                );

              }

            };


          // ====================================================
          // ERROR
          // ====================================================

          xhr.onerror =
            () => {

              reject(

                new Error(
                  'No se pudo conectar con la PC.'
                )

              );

            };


          xhr.ontimeout =
            () => {

              reject(

                new Error(
                  'La conexión tardó demasiado.'
                )

              );

            };


          xhr.timeout =
            120000;


          // ====================================================
          // ENVIAR URI COMO BINARIO
          // ====================================================

          try {

            // React Native permite enviar la URI directamente
            // como objeto de archivo.

            xhr.send({

              uri:
                selectedFile.uri,

              type:
                selectedFile.mimeType ||
                'application/octet-stream',

              name:
                selectedFile.name,

            } as any);


          } catch (error) {

            reject(error);

          }

        }

      );

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


      Alert.alert(

        '📤 Confirmar envío',

        `¿Enviar "${selectedFile.name}" a ${device.alias}?`,

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
              async () => {

                setSending(true);


                try {

                  await performUpload(
                    device
                  );


                  Alert.alert(

                    '✅ Enviado',

                    `"${selectedFile.name}" fue enviado correctamente a ${device.alias}.`

                  );


                  setSelectedFile(
                    null
                  );


                } catch (error: any) {

                  console.log(
                    '================================='
                  );

                  console.log(
                    'ERROR AL ENVIAR ARCHIVO'
                  );

                  console.log(
                    error
                  );

                  console.log(
                    '================================='
                  );


                  Alert.alert(

                    '❌ Error al enviar',

                    `No se pudo enviar "${selectedFile.name}".\n\n${error?.message || 'Error desconocido.'}`

                  );

                } finally {

                  setSending(false);

                }

              },

          },

        ]

      );

    };


  // ============================================================
  // PANTALLA DE CARGA
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
          color="#6366f1"
        />

      </ThemedView>

    );

  }


  // ============================================================
  // INTERFAZ
  // ============================================================

  return (

    <ThemedView
      style={styles.container}
    >

      <SafeAreaView
        style={[
          styles.safeArea,
          {
            paddingBottom:
              BottomTabInset +
              Spacing.three,
          },
        ]}
      >

        {/* ================================================== */}
        {/* HEADER */}
        {/* ================================================== */}

        <ThemedView
          style={styles.header}
        >

          <ThemedText
            type="title"
          >
            LocalSend
          </ThemedText>


          <ThemedText
            type="small"
            themeColor="textSecondary"
          >

            {isConnected

              ? (

                scanning

                  ? '✅ Conectado a la PC'

                  : '📶 Wi-Fi conectado — pulsá "Conectar a PC"'

              )

              : '❌ Sin Wi-Fi'

            }

          </ThemedText>


          <TouchableOpacity
            style={
              styles.manualButton
            }
            onPress={
              connectManually
            }
            activeOpacity={0.8}
          >

            <ThemedText
              style={{
                color: '#fff',
                fontWeight: 'bold',
                fontSize: 13,
              }}
            >

              🔗 Conectar a PC manualmente

            </ThemedText>

          </TouchableOpacity>

        </ThemedView>


        {/* ================================================== */}
        {/* SELECTOR DE ARCHIVO */}
        {/* ================================================== */}

        <TouchableOpacity

          onPress={
            pickFile
          }

          style={[

            styles.filePicker,

            {

              borderColor:

                selectedFile

                  ? '#22c55e'

                  : (
                    (theme as any).border ??
                    '#333'
                  ),

              backgroundColor:

                selectedFile

                  ? '#0d1f12'

                  : 'transparent',

            },

          ]}

          activeOpacity={0.7}

        >

          {selectedFile ? (

            <>

              <ThemedText
                style={
                  styles.fileIcon
                }
              >
                📄
              </ThemedText>


              <ThemedText
                type="default"
                style={{
                  color: '#86efac',
                  fontWeight: '600',
                  textAlign: 'center',
                }}
              >

                {selectedFile.name}

              </ThemedText>


              {selectedFile.size > 0 && (

                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                >

                  {(
                    selectedFile.size /
                    1024 /
                    1024
                  ).toFixed(2)} MB

                </ThemedText>

              )}

            </>

          ) : (

            <>

              <ThemedText
                style={
                  styles.fileIcon
                }
              >
                📂
              </ThemedText>


              <ThemedText
                type="default"
              >
                Seleccionar archivo
              </ThemedText>

            </>

          )}

        </TouchableOpacity>


        {/* ================================================== */}
        {/* ESTADO ENVÍO */}
        {/* ================================================== */}

        {sending && (

          <ThemedView
            style={
              styles.statusRow
            }
          >

            <ActivityIndicator
              size="small"
              color="#22c55e"
            />

            <ThemedText
              type="small"
              themeColor="textSecondary"
            >

              Enviando archivo...

            </ThemedText>

          </ThemedView>

        )}


        {/* ================================================== */}
        {/* ESTADO RECEPCIÓN */}
        {/* ================================================== */}

        {receiving && (

          <ThemedView
            style={
              styles.statusRow
            }
          >

            <ActivityIndicator
              size="small"
              color="#6366f1"
            />

            <ThemedText
              type="small"
              themeColor="textSecondary"
            >

              Recibiendo archivo...

            </ThemedText>

          </ThemedView>

        )}


        {/* ================================================== */}
        {/* DISPOSITIVOS */}
        {/* ================================================== */}

        <FlatList

          data={
            devices
          }

          keyExtractor={
            item =>
              `${item.deviceType}-${item.ip}`
          }

          style={
            styles.list
          }

          renderItem={
            ({ item }) => (

              <TouchableOpacity

                style={[

                  styles.deviceCard,

                  {

                    backgroundColor:
                      theme.backgroundElement ??
                      '#1a1a2e',

                    borderColor:
                      (theme as any).border ??
                      '#333',

                  },

                ]}

                onPress={
                  () =>
                    sendFile(item)
                }

                activeOpacity={0.7}

              >

                <ThemedText
                  style={
                    styles.deviceIcon
                  }
                >

                  {item.deviceType === 'mobile'
                    ? '📱'
                    : '🖥️'}

                </ThemedText>


                <ThemedView
                  style={
                    styles.deviceInfo
                  }
                >

                  <ThemedText
                    type="default"
                    style={{
                      fontWeight: '600',
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

                </ThemedView>


                {selectedFile && (

                  <ThemedText
                    style={{
                      fontSize: 18,
                    }}
                  >
                    📤
                  </ThemedText>

                )}

              </TouchableOpacity>

            )
          }


          ListEmptyComponent={

            <ThemedView
              style={
                styles.emptyContainer
              }
            >

              {scanning && (

                <ActivityIndicator
                  size="small"
                  color="#6366f1"
                  style={{
                    marginBottom: 10,
                  }}
                />

              )}


              <ThemedText
                type="small"
                themeColor="textSecondary"
                style={{
                  textAlign: 'center',
                }}
              >

                {scanning

                  ? 'Esperando dispositivos...'

                  : 'Conectate a la PC para ver dispositivos'

                }

              </ThemedText>

            </ThemedView>

          }

        />

      </SafeAreaView>


      {/* ==================================================== */}
      {/* MODAL IP */}
      {/* ==================================================== */}

      <Modal

        visible={
          modalVisible
        }

        transparent

        animationType="fade"

        onRequestClose={
          () =>
            setModalVisible(false)
        }

      >

        <ThemedView
          style={
            styles.modalOverlay
          }
        >

          <ThemedView
            style={
              styles.modalBox
            }
          >

            <ThemedText
              type="default"
              style={{
                fontWeight: '600',
                marginBottom: 8,
              }}
            >

              Conectar a la PC

            </ThemedText>


            <ThemedText
              type="small"
              themeColor="textSecondary"
              style={{
                marginBottom: 12,
              }}
            >

              Ingresá la IP que muestra la pantalla de tu PC.

              {'\n\n'}

              Ejemplo: 192.168.0.106

            </ThemedText>


            <TextInput

              value={
                ipInput
              }

              onChangeText={
                setIpInput
              }

              placeholder="192.168.0.106"

              placeholderTextColor="#888"

              keyboardType="numeric"

              style={
                styles.modalInput
              }

              autoFocus

            />


            <ThemedView
              style={
                styles.modalButtons
              }
            >

              <TouchableOpacity

                onPress={
                  () =>
                    setModalVisible(false)
                }

                style={
                  styles.modalCancel
                }

              >

                <ThemedText>
                  Cancelar
                </ThemedText>

              </TouchableOpacity>


              <TouchableOpacity

                onPress={
                  handleConnect
                }

                style={
                  styles.modalConfirm
                }

              >

                <ThemedText
                  style={{
                    color: '#fff',
                    fontWeight: '600',
                  }}
                >

                  Conectar

                </ThemedText>

              </TouchableOpacity>

            </ThemedView>

          </ThemedView>

        </ThemedView>

      </Modal>

    </ThemedView>

  );

}


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
      justifyContent: 'center',
      alignItems: 'center',
    },


    safeArea: {
      flex: 1,
      paddingHorizontal:
        Spacing.four,
      gap:
        Spacing.three,
    },


    header: {
      paddingTop:
        Spacing.three,
      gap:
        Spacing.one,
    },


    manualButton: {

      backgroundColor:
        '#4f46e5',

      padding:
        10,

      borderRadius:
        8,

      alignItems:
        'center',

      marginTop:
        8,

      shadowColor:
        '#000',

      shadowOffset: {
        width: 0,
        height: 2,
      },

      shadowOpacity:
        0.2,

      shadowRadius:
        2,

      elevation:
        2,

    },


    filePicker: {

      borderWidth:
        2,

      borderStyle:
        'dashed',

      borderRadius:
        12,

      padding:
        Spacing.four,

      alignItems:
        'center',

      gap:
        Spacing.two,

    },


    fileIcon: {
      fontSize: 32,
    },


    statusRow: {

      flexDirection:
        'row',

      alignItems:
        'center',

      gap:
        8,

      marginVertical:
        8,

      justifyContent:
        'center',

    },


    list: {
      flex: 1,
    },


    deviceCard: {

      borderRadius:
        10,

      padding:
        Spacing.three,

      flexDirection:
        'row',

      alignItems:
        'center',

      gap:
        Spacing.three,

      marginBottom:
        Spacing.two,

      borderWidth:
        1,

    },


    deviceIcon: {
      fontSize: 28,
    },


    deviceInfo: {
      flex: 1,
      gap: 2,
    },


    emptyContainer: {

      paddingTop:
        Spacing.six,

      alignItems:
        'center',

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
        '85%',

      backgroundColor:
        '#1a1a2e',

      borderRadius:
        12,

      padding:
        20,

    },


    modalInput: {

      borderWidth:
        1,

      borderColor:
        '#333',

      borderRadius:
        8,

      padding:
        10,

      color:
        '#fff',

      marginBottom:
        16,

    },


    modalButtons: {

      flexDirection:
        'row',

      justifyContent:
        'flex-end',

      gap:
        10,

      backgroundColor:
        'transparent',

    },


    modalCancel: {

      paddingVertical:
        8,

      paddingHorizontal:
        14,

    },


    modalConfirm: {

      backgroundColor:
        '#4f46e5',

      paddingVertical:
        8,

      paddingHorizontal:
        14,

      borderRadius:
        8,

    },

  });
