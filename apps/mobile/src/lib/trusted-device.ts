/**
 * The two-factor "trust this device" token (docs/TWO-FACTOR.md). The server
 * returns it in the response body for `client: "mobile"`; we keep it in the
 * OS keystore and present it on every `auth.login`. It belongs to the device,
 * not the session, so it survives sign-out. Storage failures never break
 * sign-in: without the token the user is simply asked for a code.
 */
import * as SecureStore from "expo-secure-store";

export const TRUSTED_DEVICE_KEY = "fintranzact_trusted_device_token";

export async function getTrustedDeviceToken(): Promise<string | null> {
  try {
    return (await SecureStore.getItemAsync(TRUSTED_DEVICE_KEY)) || null;
  } catch {
    return null;
  }
}

export async function setTrustedDeviceToken(token: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(TRUSTED_DEVICE_KEY, token);
  } catch {
    /* keystore unavailable: next sign-in just asks for a code */
  }
}

export async function clearTrustedDeviceToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TRUSTED_DEVICE_KEY);
  } catch {
    /* nothing to do */
  }
}

/** Mobile does not send X-Fintranzact-Client, so the client kind goes in the input. */
export function buildLoginInput(email: string, password: string, trustedDeviceToken: string | null) {
  return {
    email,
    password,
    client: "mobile" as const,
    ...(trustedDeviceToken ? { trustedDeviceToken } : {}),
  };
}

export function buildVerifyInput(challengeToken: string, code: string, rememberDevice: boolean) {
  return { challengeToken, code, rememberDevice, client: "mobile" as const };
}
