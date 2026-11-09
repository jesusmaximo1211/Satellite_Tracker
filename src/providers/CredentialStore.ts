/**
 * Almacenamiento seguro de credenciales de APIs y URL del Proxy (Sección 4.3).
 * Utiliza expo-secure-store (Keychain en iOS / Keystore cifrado en Android) con fallback a AsyncStorage en Web,
 * garantizando que ninguna API Key ni contraseña quede embebida en el código fuente o bundle.
 */

import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const KEY_N2YO_API_KEY = 'tp7_sec_n2yo_api_key';
const KEY_SPACETRACK_USER = 'tp7_sec_spacetrack_user';
const KEY_SPACETRACK_PASS = 'tp7_sec_spacetrack_pass';
const KEY_PROXY_URL = 'tp7_sec_proxy_url';

export interface StoredCredentials {
  n2yoApiKey: string;
  spaceTrackIdentity: string;
  spaceTrackPassword: string;
  proxyBaseUrl: string;
}

async function setSecureItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(key, value);
    return;
  }
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    await AsyncStorage.setItem(key, value);
  }
}

async function getSecureItem(key: string): Promise<string> {
  if (Platform.OS === 'web') {
    return (await AsyncStorage.getItem(key)) || '';
  }
  try {
    return (await SecureStore.getItemAsync(key)) || '';
  } catch {
    return (await AsyncStorage.getItem(key)) || '';
  }
}

class CredentialStoreService {
  private cached: StoredCredentials | null = null;

  public async getCredentials(): Promise<StoredCredentials> {
    if (this.cached) return this.cached;

    const [n2yoApiKey, spaceTrackIdentity, spaceTrackPassword, proxyBaseUrl] = await Promise.all([
      getSecureItem(KEY_N2YO_API_KEY),
      getSecureItem(KEY_SPACETRACK_USER),
      getSecureItem(KEY_SPACETRACK_PASS),
      getSecureItem(KEY_PROXY_URL),
    ]);

    this.cached = {
      n2yoApiKey: n2yoApiKey.trim(),
      spaceTrackIdentity: spaceTrackIdentity.trim(),
      spaceTrackPassword: spaceTrackPassword.trim(),
      proxyBaseUrl: proxyBaseUrl.trim(),
    };
    return this.cached;
  }

  public async saveCredentials(partial: Partial<StoredCredentials>): Promise<StoredCredentials> {
    const current = await this.getCredentials();
    const updated: StoredCredentials = {
      n2yoApiKey: partial.n2yoApiKey !== undefined ? partial.n2yoApiKey.trim() : current.n2yoApiKey,
      spaceTrackIdentity:
        partial.spaceTrackIdentity !== undefined
          ? partial.spaceTrackIdentity.trim()
          : current.spaceTrackIdentity,
      spaceTrackPassword:
        partial.spaceTrackPassword !== undefined
          ? partial.spaceTrackPassword.trim()
          : current.spaceTrackPassword,
      proxyBaseUrl:
        partial.proxyBaseUrl !== undefined ? partial.proxyBaseUrl.trim() : current.proxyBaseUrl,
    };

    await Promise.all([
      setSecureItem(KEY_N2YO_API_KEY, updated.n2yoApiKey),
      setSecureItem(KEY_SPACETRACK_USER, updated.spaceTrackIdentity),
      setSecureItem(KEY_SPACETRACK_PASS, updated.spaceTrackPassword),
      setSecureItem(KEY_PROXY_URL, updated.proxyBaseUrl),
    ]);

    this.cached = updated;
    return updated;
  }
}

export const credentialStore = new CredentialStoreService();

