/**
 * The check-in flow with the camera, the location and the server injected (no device needed): what is
 * asked for, when, and what is sent.
 */
import { performPunch, SELFIE_MISSING_MESSAGE, type PunchDeps, type PunchRequest } from "../lib/punch";

function deps(over: Partial<PunchDeps> = {}) {
  const sent: PunchRequest[] = [];
  const calls = { selfie: 0, position: 0 };
  const d: PunchDeps = {
    captureSelfie: async () => {
      calls.selfie++;
      return "data:image/jpeg;base64,/9j/FAKE";
    },
    readPosition: async () => {
      calls.position++;
      return { lat: 19.076, lng: 72.8777, accuracyM: 12 };
    },
    deviceId: async () => "app-abc123",
    now: () => 1_800_000_000_000,
    send: async (r) => {
      sent.push(r);
      return { warning: null };
    },
    ...over,
  };
  return { d, sent, calls };
}

const setup = { kind: "in" as const, consentVersion: "v1", selfieRequired: true, locationNeeded: true };

describe("performPunch", () => {
  it("takes one selfie and one location reading, then sends them with the phone's clock and device id", async () => {
    const { d, sent, calls } = deps();
    const out = await performPunch(setup, d);
    expect(out).toEqual({ ok: true, kind: "in", warning: null });
    expect(calls).toEqual({ selfie: 1, position: 1 });
    expect(sent).toEqual([{ kind: "in", clientTime: 1_800_000_000_000, deviceId: "app-abc123", consentVersion: "v1", selfie: "data:image/jpeg;base64,/9j/FAKE", lat: 19.076, lng: 72.8777, accuracyM: 12 }]);
  });

  it("does not open the camera or read the location when the business does not ask for them", async () => {
    const { d, sent, calls } = deps();
    const out = await performPunch({ ...setup, kind: "out", selfieRequired: false, locationNeeded: false }, d);
    expect(out.ok).toBe(true);
    expect(calls).toEqual({ selfie: 0, position: 0 });
    expect(sent[0]).not.toHaveProperty("selfie");
    expect(sent[0]).not.toHaveProperty("lat");
    expect(sent[0]!.kind).toBe("out");
  });

  it("stops, without calling the server, when the selfie is cancelled or the camera is refused", async () => {
    const { d, sent, calls } = deps({ captureSelfie: async () => null });
    const out = await performPunch(setup, d);
    expect(out).toEqual({ ok: false, reason: "selfie_missing", message: SELFIE_MISSING_MESSAGE });
    expect(sent).toHaveLength(0);
    expect(calls.position).toBe(0); // the location is not even read for a punch that will not be sent
  });

  it("sends the punch without a location when the person refuses it (the business policy decides what that means)", async () => {
    const { d, sent } = deps({ readPosition: async () => null });
    const out = await performPunch(setup, d);
    expect(out.ok).toBe(true);
    expect(sent[0]).not.toHaveProperty("lat");
  });

  it("passes on a mocked-location hint, and the server's warning", async () => {
    const { d, sent } = deps({
      readPosition: async () => ({ lat: 1, lng: 2, accuracyM: 5, mocked: true }),
      send: async (r) => {
        sent.push(r);
        return { warning: "You are about 450 m from Head office. Your punch was saved and HR will review it." };
      },
    });
    const out = await performPunch(setup, d);
    expect(out).toMatchObject({ ok: true, warning: expect.stringContaining("HR will review") });
    expect(sent[0]).toMatchObject({ mockLocation: true });
  });

  it("returns the server's refusal as the message", async () => {
    const { d } = deps({
      send: async () => {
        throw new Error("You are not checked in. Check in first.");
      },
    });
    expect(await performPunch({ ...setup, kind: "out" }, d)).toEqual({ ok: false, reason: "failed", message: "You are not checked in. Check in first." });
  });

  it("falls back to a plain message for an unknown failure", async () => {
    const { d } = deps({
      send: async () => {
        throw {};
      },
    });
    expect(await performPunch(setup, d)).toMatchObject({ ok: false, reason: "failed", message: "Something went wrong. Please try again." });
  });
});
