import '~/global.css';

import { DarkTheme, DefaultTheme, Theme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as React from 'react';
import { Platform, View } from 'react-native';
import { NAV_THEME } from '~/lib/constants';
import { useColorScheme } from '~/lib/useColorScheme';
import { PortalHost } from '@rn-primitives/portal';
import { ThemeToggle } from '~/components/ThemeToggle';
import { setAndroidNavigationBar } from '~/lib/android-navigation-bar';

// Container component for web layout to prevent excessive stretching
const Container = ({ children }: { children: React.ReactNode }) => {
  if (Platform.OS === 'web') {
    return (
      <View style={{ 
        flex: 1, 
        maxWidth: 768, 
        width: '100%', 
        alignSelf: 'center' 
      }}>
        {children}
      </View>
    );
  }
  return <>{children}</>;
};

const LIGHT_THEME: Theme = {
  ...DefaultTheme,
  colors: NAV_THEME.light,
};
const DARK_THEME: Theme = {
  ...DarkTheme,
  colors: NAV_THEME.dark,
};

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export default function RootLayout() {
  const hasMounted = React.useRef(false);
  const { colorScheme, isDarkColorScheme } = useColorScheme();
  const [isColorSchemeLoaded, setIsColorSchemeLoaded] = React.useState(false);
  // Create memoized theme to prevent unnecessary re-renders
  const theme = React.useMemo(
    () => (isDarkColorScheme ? DARK_THEME : LIGHT_THEME),
    [isDarkColorScheme]
  );

  useIsomorphicLayoutEffect(() => {
    if (hasMounted.current) {
      return;
    }

    if (Platform.OS === 'web') {
      // Adds the background color to the html element to prevent white background on overscroll.
      document.documentElement.classList.add('bg-background');
    }
    setAndroidNavigationBar(colorScheme);
    setIsColorSchemeLoaded(true);
    hasMounted.current = true;
  }, []);

  if (!isColorSchemeLoaded) {
    return null;
  }

  return (
    <ThemeProvider value={theme}>
      <StatusBar style={isDarkColorScheme ? 'light' : 'dark'} />
      <Container>
        <Stack screenOptions={{ headerBackVisible: false }}>
          <Stack.Screen
            name='index'
            options={{
              title: 'Доступные игры',
              headerRight: () => <ThemeToggle />,
            }}
          />
          <Stack.Screen
            name='create-game'
            options={{
              title: 'Create Game',
              headerBackVisible: true,
            }}
          />
          <Stack.Screen name='lobby/[gameId]' options={{ headerBackVisible: true }} />
        </Stack>
      </Container>
      <PortalHost />
    </ThemeProvider>
  );
}

// Define useIsomorphicLayoutEffect outside of component to avoid hooks rule violations
const useIsomorphicLayoutEffect = React.useLayoutEffect;
