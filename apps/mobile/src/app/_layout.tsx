import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';

const THEME = { ...DarkTheme, colors: { ...DarkTheme.colors, background: '#000', card: '#000', primary: '#3EE09A' } };
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from '../lib/store';
import { Backdrop, GradientButton, Txt } from '../ui/kit';
import { Splash } from '../ui/Splash';
import { ToastView } from '../ui/ToastView';
import { Onboarding } from '../ui/Onboarding';
import { usePushRegistration } from '../lib/push';

function Shell() {
  const { rtl, ready, onboarded, bootError, retryBoot, t } = useApp();
  const [splash, setSplash] = useState(true);
  const done = useCallback(() => setSplash(false), []);
  usePushRegistration();
  return (
    <View style={{ flex: 1, direction: rtl ? 'rtl' : 'ltr', backgroundColor: '#000' }}>
      <StatusBar style="light" />
      <Backdrop />
      <ThemeProvider value={THEME}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' }, animation: rtl ? 'slide_from_left' : 'slide_from_right' }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="product/[id]" />
        <Stack.Screen name="scan" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
        <Stack.Screen name="search" />
        <Stack.Screen name="auth" options={{ presentation: 'modal' }} />
      </Stack>
      </ThemeProvider>
      {ready && bootError && !splash ? (
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: 120, padding: 16, borderRadius: 18, backgroundColor: '#15181D', gap: 10 }}>
          <Txt center>{t('offline')}</Txt>
          <GradientButton label={t('retry')} onPress={retryBoot} />
        </View>
      ) : null}
      {ready && !onboarded && !splash ? <Onboarding /> : null}
      <ToastView />
      {splash ? <Splash onDone={done} credit={t('splashSub')} /> : null}
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <Shell />
      </AppProvider>
    </SafeAreaProvider>
  );
}
