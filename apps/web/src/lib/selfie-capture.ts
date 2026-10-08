/**
 * Browser helpers for the employee check-in: the front camera for a selfie and one reading of the
 * position. Both are asked for ONLY when the employee taps Check in or Check out (never in the
 * background, never on a timer), and nothing is kept on the device. See the consent wording in
 * @fintranzact/shared (ATTENDANCE_CONSENT_POINTS) and docs/architecture/payroll-self-service.md.
 */

const DEVICE_KEY = "fintranzact:device-id";

/** A stable, random id for this browser (shown to HR next to the punch). It is not a hardware id. */
export function deviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const id = `web-${crypto.randomUUID().slice(0, 12)}`;
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return "web-unknown";
  }
}

export function cameraAvailable(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

/** Open the front camera. Rejects when the person declines or there is no camera. */
export function openCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 640 } }, audio: false });
}

export function stopCamera(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Draw the current frame to a JPEG data URL, scaled so the longest side is at most `maxSide` pixels. */
export function captureFrame(video: HTMLVideoElement, maxSide = 640, quality = 0.7): string {
  const w = video.videoWidth || 640;
  const h = video.videoHeight || 480;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

export interface Position {
  lat: number;
  lng: number;
  accuracyM: number;
}

/** One reading of the position, or null when it is refused, unavailable or times out. */
export function readPosition(timeoutMs = 10_000): Promise<Position | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}
