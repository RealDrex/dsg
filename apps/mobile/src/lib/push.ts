import { useEffect } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { api } from './api';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

/**
 * Asks for notification permission only when the user starts watching a
 * price (never at launch), then registers the Expo push token.
 */
export async function registerForPush(): Promise<boolean> {
  if (Platform.OS === 'web' || !Device.isDevice) return false;
  try {
    const current = await Notifications.getPermissionsAsync();
    const status = current.granted ? current : await Notifications.requestPermissionsAsync();
    if (!status.granted) return false;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('price-alerts', { name: 'Price alerts', importance: Notifications.AndroidImportance.DEFAULT });
    }
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
    if (!projectId) return false;
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.setPushToken(token.data);
    return true;
  } catch {
    return false;
  }
}

/** Opens the product when the user taps a price alert. */
export function usePushRegistration() {
  const last = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const id = last?.notification.request.content.data?.productId;
    if (typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)) router.push(`/product/${id}`);
  }, [last]);
}
