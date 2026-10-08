/**
 * The phone-side pieces of check-in: one foreground location reading and a stable (random) device id.
 * The camera is the SelfieCamera component. Nothing here runs in the background or on a timer.
 */
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import type { Position } from "./punch";

const DEVICE_KEY = "fintranzact_device_id";

function randomId(): string {
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 12; i++) out += hex[Math.floor(Math.random() * 16)];
  return `app-${out}`;
}

/** A random id for this install, shown to HR next to the punch. It is not a hardware identifier. */
export async function getDeviceId(): Promise<string> {
  try {
    const existing = await SecureStore.getItemAsync(DEVICE_KEY);
    if (existing) return existing;
    const id = randomId();
    await SecureStore.setItemAsync(DEVICE_KEY, id);
    return id;
  } catch {
    return randomId();
  }
}

/**
 * One reading of the position, with the foreground permission only (never background location).
 * Returns null when the permission is refused, location services are off or the reading fails.
 */
export async function readForegroundPosition(): Promise<Position | null> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") return null;
    const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return { lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy ?? 9999, ...(p.mocked ? { mocked: true } : {}) };
  } catch {
    return null;
  }
}
