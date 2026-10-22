// ============================================================
// PESTAÑAS DE ABAJO (Android / iOS)
// ============================================================
// Usa las pestañas nativas del sistema (se ven como las de
// cualquier app del celular).

// Componente de pestañas nativas de Expo Router.
import { NativeTabs } from 'expo-router/unstable-native-tabs';
// Hook que dice si el celular está en modo claro u oscuro.
import { useColorScheme } from 'react-native';

// Colores de la app para modo claro y oscuro.
import { Colors } from '@/constants/theme';

// "export default" = este es el componente que importa _layout.tsx.
export default function PestanasApp() {
  // 'light', 'dark' o 'unspecified' (si el celular no lo informa).
  const esquemaColor = useColorScheme();
  // Elegimos los colores (si no se sabe el modo, usamos el claro).
  const colores = Colors[esquemaColor === 'unspecified' ? 'light' : esquemaColor];

  // Lo que se dibuja:
  return (
    // Barra de pestañas con los colores del tema.
    <NativeTabs
      // Fondo de la barra.
      backgroundColor={colores.background}
      // Color del "indicador" que marca la pestaña elegida.
      indicatorColor={colores.backgroundElement}
      // Color del texto de la pestaña elegida.
      labelStyle={{ selected: { color: colores.text } }}>
      {/* Pestaña 1: la pantalla principal (src/app/index.tsx). */}
      <NativeTabs.Trigger name="index">
        {/* Texto de la pestaña. */}
        <NativeTabs.Trigger.Label>Inicio</NativeTabs.Trigger.Label>
        {/* Ícono de la casita. */}
        <NativeTabs.Trigger.Icon
          // Imagen del ícono.
          src={require('@/assets/images/tabIcons/home.png')}
          // "template" = el sistema lo pinta del color de la pestaña.
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      {/* Pestaña 2: la pantalla "Explorar" (src/app/explore.tsx). */}
      <NativeTabs.Trigger name="explore">
        {/* Texto de la pestaña. */}
        <NativeTabs.Trigger.Label>Explorar</NativeTabs.Trigger.Label>
        {/* Ícono de explorar. */}
        <NativeTabs.Trigger.Icon
          // Imagen del ícono.
          src={require('@/assets/images/tabIcons/explore.png')}
          // "template" = el sistema lo pinta del color de la pestaña.
          renderingMode="template"
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
