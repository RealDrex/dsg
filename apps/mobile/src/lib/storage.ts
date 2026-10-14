import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Secrets (refresh token) live in the iOS Keychain / Android Keystore via
 * SecureStore. The web preview has no secure storage, so it falls back to
 * localStorage there; the web build is for design review, not production.
 */
const web = Platform.OS === 'web';

export async function getSecret(key: string): Promise<string | null> {
  if (web) {
    try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
  }
  return SecureStore.getItemAsync(key);
}

export async function setSecret(key: string, value: string | null): Promise<void> {
  if (web) {
    try {
      if (value === null) globalThis.localStorage?.removeItem(key);
      else globalThis.localStorage?.setItem(key, value);
    } catch { /* storage unavailable */ }
    return;
  }
  if (value === null) await SecureStore.deleteItemAsync(key);
  else await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
}

/** Non-sensitive local preferences (language, onboarding done). */
export const getPref = getSecret;
export const setPref = setSecret;
