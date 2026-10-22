// ============================================================
// DISEÑO GENERAL DE LA APP (se dibuja alrededor de todas las pantallas)
// ============================================================
// Expo Router usa este archivo como "marco": pone el tema de
// colores, la animación de inicio y las pestañas de abajo.

// Proveedor de tema y los dos temas que trae Expo Router (oscuro y claro).
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
// Hook que dice si el celular está en modo claro u oscuro.
import { useColorScheme } from 'react-native';

// Animación del logo que aparece al abrir la app.
import { AnimatedSplashOverlay } from '@/components/animated-icon';
// Las pestañas de abajo (Inicio y Explorar).
import PestanasApp from '@/components/app-tabs';

// "export default" = Expo Router usa esta función como diseño principal.
export default function DisenoConPestanas() {
  // 'dark' si el celular está en modo oscuro, 'light' si está en claro.
  const esquemaColor = useColorScheme();
  // Lo que se dibuja:
  return (
    // Le pasa a toda la app el tema oscuro o el claro según el celular.
    <ThemeProvider value={esquemaColor === 'dark' ? DarkTheme : DefaultTheme}>
      {/* Animación de inicio (se dibuja encima y después desaparece). */}
      <AnimatedSplashOverlay />
      {/* Las pestañas con las pantallas adentro. */}
      <PestanasApp />
    </ThemeProvider>
  );
}
