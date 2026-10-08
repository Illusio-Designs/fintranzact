import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ATTENDANCE_CONSENT_POINTS } from "@fintranzact/shared";

const h = vi.hoisted(() => ({
  me: { data: undefined as unknown, isLoading: false },
  punch: vi.fn(),
  accept: vi.fn(),
  invalidate: vi.fn(async () => undefined),
  toast: vi.fn(),
  readPosition: vi.fn(),
  openCamera: vi.fn(),
  captureFrame: vi.fn(() => "data:image/jpeg;base64,/9j/FAKE"),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ payrollSelf: { me: { invalidate: h.invalidate }, attendance: { invalidate: h.invalidate } } }),
    payrollSelf: {
      me: { useQuery: () => h.me },
      punch: { useMutation: () => ({ mutateAsync: h.punch, isPending: false }) },
      acceptConsent: { useMutation: (o: { onSuccess?: () => void }) => ({ mutate: (v: unknown) => { h.accept(v); o.onSuccess?.(); }, isPending: false }) },
    },
  },
}));
vi.mock("@/hooks/useToast", () => ({ toast: h.toast }));
vi.mock("@/lib/selfie-capture", () => ({
  cameraAvailable: () => true,
  deviceId: () => "web-test-device",
  openCamera: h.openCamera,
  stopCamera: vi.fn(),
  captureFrame: h.captureFrame,
  readPosition: h.readPosition,
}));

import { CheckInPanel } from "../CheckInPanel";

const me = (over: Record<string, unknown> = {}) => ({
  serverTime: new Date(), businessName: "People Co", employee: { name: "Asha Verma", code: "E001" }, canPunch: true, next: "in", openSince: null,
  settings: { selfieRequired: true, geofencePolicy: "record", locationNeeded: true, retentionDays: 90 }, locationNames: ["Head office"],
  consent: { version: "v1", accepted: true }, today: [], ...over,
});

describe("CheckInPanel", () => {
  beforeAll(() => {
    // jsdom has no media playback.
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  });
  beforeEach(() => {
    for (const f of [h.punch, h.accept, h.invalidate, h.toast, h.readPosition, h.openCamera]) f.mockReset();
    h.invalidate.mockResolvedValue(undefined);
    h.openCamera.mockResolvedValue({ getTracks: () => [] });
    h.readPosition.mockResolvedValue({ lat: 19.076, lng: 72.8777, accuracyM: 12 });
    h.me = { data: me(), isLoading: false };
  });

  it("asks for consent first, showing what is collected, and saves it", () => {
    h.me = { data: me({ consent: { version: "v1", accepted: false } }), isLoading: false };
    render(<CheckInPanel />);
    const points = screen.getByTestId("consent-points");
    for (const p of ATTENDANCE_CONSENT_POINTS) expect(points).toHaveTextContent(p.slice(0, 40));
    expect(points).toHaveTextContent(/never tracks you in the background/i);
    fireEvent.click(screen.getByRole("button", { name: "I understand and agree" }));
    expect(h.accept).toHaveBeenCalledWith({ version: "v1" });
    expect(h.punch).not.toHaveBeenCalled();
  });

  it("takes a selfie and one location reading only when the button is pressed, then punches with the phone's clock for reference", async () => {
    h.punch.mockResolvedValue({ kind: "in", warning: null });
    render(<CheckInPanel />);
    expect(h.openCamera).not.toHaveBeenCalled();
    expect(h.readPosition).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Check in" }));
    fireEvent.click(await screen.findByRole("button", { name: /take photo and check in/i }));
    await waitFor(() => expect(h.punch).toHaveBeenCalled());
    expect(h.punch).toHaveBeenCalledWith(expect.objectContaining({
      kind: "in", deviceId: "web-test-device", consentVersion: "v1", selfie: "data:image/jpeg;base64,/9j/FAKE", lat: 19.076, lng: 72.8777, accuracyM: 12, clientTime: expect.any(Number),
    }));
    expect(h.readPosition).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Checked in", variant: "success" })));
  });

  it("checks out when checked in, and shows the server's warning about the location", async () => {
    h.me = { data: me({ next: "out", openSince: new Date("2026-10-05T03:30:00Z"), today: [{ id: "p1", kind: "in", time: "09:00", resultLabel: "Outside the work location", review: "pending" }] }), isLoading: false };
    h.punch.mockResolvedValue({ kind: "out", warning: "You are about 450 m from Head office, outside the allowed area. Your punch was saved and HR will review it." });
    render(<CheckInPanel />);
    expect(screen.getByText(/you checked in at 09:00/i)).toBeInTheDocument();
    expect(screen.getByText("With HR")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check out" }));
    fireEvent.click(await screen.findByRole("button", { name: /take photo and check out/i }));
    expect(await screen.findByRole("status")).toHaveTextContent("HR will review it");
    expect(h.punch).toHaveBeenCalledWith(expect.objectContaining({ kind: "out" }));
  });

  it("does not use the camera when the business does not ask for a selfie, nor the location when it is off", async () => {
    h.me = { data: me({ settings: { selfieRequired: false, geofencePolicy: "off", locationNeeded: false, retentionDays: 90 } }), isLoading: false };
    h.punch.mockResolvedValue({ kind: "in", warning: null });
    render(<CheckInPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Check in" }));
    await waitFor(() => expect(h.punch).toHaveBeenCalled());
    expect(h.openCamera).not.toHaveBeenCalled();
    expect(h.readPosition).not.toHaveBeenCalled();
    const sent = h.punch.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent).not.toHaveProperty("selfie");
    expect(sent).not.toHaveProperty("lat");
  });

  it("sends no location when the person refuses it, and shows the server's refusal", async () => {
    h.readPosition.mockResolvedValue(null);
    h.punch.mockRejectedValue(new Error("Your location could not be read. Turn on location for the app and try again."));
    render(<CheckInPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Check in" }));
    fireEvent.click(await screen.findByRole("button", { name: /take photo and check in/i }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not record your punch", description: expect.stringContaining("Turn on location"), variant: "error" })));
    expect(h.punch.mock.calls[0]![0]).not.toHaveProperty("lat");
  });

  it("explains when check-in is switched off", () => {
    h.me = { data: me({ canPunch: false }), isLoading: false };
    render(<CheckInPanel />);
    expect(screen.getByText(/switched off for your business/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check in" })).toBeDisabled();
  });
});
