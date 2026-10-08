/**
 * The check-in / check-out flow of the employee app, with the camera, the location, the device id and the
 * server call injected so the logic is testable without a phone (src/__tests__/employee-punch.test.ts).
 *
 * Privacy rules the flow keeps (docs/architecture/payroll-self-service.md):
 *  - the selfie and the location are asked for ONLY here, when the person taps Check in or Check out,
 *    and only when the business asks for them (`selfieRequired`, `locationNeeded`);
 *  - the location is a single foreground reading, never watched, never read in the background;
 *  - nothing is stored on the phone: both are sent with the punch and dropped.
 * The time that counts is the server's; `clientTime` is only a reference (a phone that is far off is refused).
 */

export type PunchKind = "in" | "out";

export interface Position {
  lat: number;
  lng: number;
  accuracyM: number;
  /** Android only: the phone says the location is mocked. A hint, not proof. */
  mocked?: boolean;
}

export interface PunchRequest {
  kind: PunchKind;
  clientTime: number;
  deviceId: string;
  consentVersion: string;
  selfie?: string;
  lat?: number;
  lng?: number;
  accuracyM?: number;
  mockLocation?: boolean;
}

export interface PunchDeps {
  /** Open the front camera; a JPEG data URL, or null when the person cancels or the camera is not allowed. */
  captureSelfie(): Promise<string | null>;
  /** One foreground reading, or null when location is off or refused. */
  readPosition(): Promise<Position | null>;
  deviceId(): Promise<string>;
  now(): number;
  send(request: PunchRequest): Promise<{ warning: string | null }>;
}

export interface PunchSetup {
  kind: PunchKind;
  consentVersion: string;
  selfieRequired: boolean;
  locationNeeded: boolean;
}

export type PunchOutcome =
  | { ok: true; kind: PunchKind; warning: string | null }
  | { ok: false; reason: "selfie_missing" | "failed"; message: string };

export const SELFIE_MISSING_MESSAGE = "A selfie is needed to check in or out. Allow the camera and try again.";

export async function performPunch(setup: PunchSetup, deps: PunchDeps): Promise<PunchOutcome> {
  let selfie: string | null = null;
  if (setup.selfieRequired) {
    selfie = await deps.captureSelfie();
    if (!selfie) return { ok: false, reason: "selfie_missing", message: SELFIE_MISSING_MESSAGE };
  }
  const position = setup.locationNeeded ? await deps.readPosition() : null;
  try {
    const result = await deps.send({
      kind: setup.kind,
      clientTime: deps.now(),
      deviceId: await deps.deviceId(),
      consentVersion: setup.consentVersion,
      ...(selfie ? { selfie } : {}),
      ...(position ? { lat: position.lat, lng: position.lng, accuracyM: position.accuracyM } : {}),
      ...(position?.mocked ? { mockLocation: true } : {}),
    });
    return { ok: true, kind: setup.kind, warning: result.warning };
  } catch (e) {
    return { ok: false, reason: "failed", message: (e as { message?: string } | null)?.message || "Something went wrong. Please try again." };
  }
}
