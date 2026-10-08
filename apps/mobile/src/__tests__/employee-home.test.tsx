/**
 * The employee home screen with the camera and location modules mocked: consent first, then check in
 * through the selfie camera and one location reading.
 */
import React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { renderWithTheme as render } from "../test-utils";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));
jest.mock("expo-camera", () => ({ CameraView: "CameraView", useCameraPermissions: () => [{ granted: true }, jest.fn()] }));
jest.mock("expo-image-manipulator", () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: "jpeg" } }));
const mockReadPosition = jest.fn();
jest.mock("../lib/device-capture", () => ({ getDeviceId: async () => "app-test", readForegroundPosition: () => mockReadPosition() }));
// The camera modal is replaced by a stand-in with a "shoot" button, so the flow can be driven without a device.
jest.mock("../components/employee/SelfieCamera", () => {
  const { Text: T, TouchableOpacity: B, View: V } = require("react-native");
  return {
    SelfieCamera: ({ visible, onDone }: { visible: boolean; onDone: (v: string | null) => void }) =>
      visible ? (
        <V>
          <B accessibilityRole="button" accessibilityLabel="Take photo" onPress={() => onDone("data:image/jpeg;base64,/9j/FAKE")}><T>Take photo</T></B>
          <B accessibilityRole="button" accessibilityLabel="Cancel selfie" onPress={() => onDone(null)}><T>Cancel</T></B>
        </V>
      ) : null,
  };
});

const mockPunch = jest.fn();
const mockAccept = jest.fn();
const state: { me: any } = { me: null };
jest.mock("../lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ payrollSelf: { me: { invalidate: jest.fn(async () => undefined) }, attendance: { invalidate: jest.fn(async () => undefined) } } }),
    auth: { logout: { useMutation: () => ({ mutate: jest.fn() }) } },
    payrollSelf: {
      me: { useQuery: () => ({ data: state.me, isLoading: false, error: null, refetch: jest.fn() }) },
      acceptConsent: { useMutation: () => ({ mutate: mockAccept, isPending: false }) },
      punch: { useMutation: () => ({ mutateAsync: mockPunch }) },
    },
  },
}));

import { EmployeeHome } from "../components/employee/EmployeeHome";

const me = (over: Record<string, unknown> = {}) => ({
  serverTime: new Date(), businessName: "People Co", employee: { name: "Asha Verma", code: "E001" }, canPunch: true, next: "in", openSince: null,
  settings: { selfieRequired: true, geofencePolicy: "record", locationNeeded: true, retentionDays: 90 }, locationNames: ["Head office"],
  consent: { version: "v1", accepted: true }, today: [], ...over,
});

beforeEach(() => {
  mockPunch.mockReset();
  mockAccept.mockReset();
  mockReadPosition.mockReset().mockResolvedValue({ lat: 19.076, lng: 72.8777, accuracyM: 12 });
  state.me = me();
});

describe("EmployeeHome", () => {
  it("asks for consent first, showing what is collected, and saves the agreement", () => {
    state.me = me({ consent: { version: "v1", accepted: false } });
    render(<EmployeeHome />);
    expect(screen.getByText(/never tracks you in the background/i)).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "I understand and agree" }));
    expect(mockAccept).toHaveBeenCalledWith({ version: "v1" });
    expect(screen.queryByTestId("punch-button")).toBeNull();
  });

  it("checks in through the selfie camera and one location reading", async () => {
    mockPunch.mockResolvedValue({ kind: "in", warning: null });
    render(<EmployeeHome />);
    expect(screen.getByText("You are not checked in.")).toBeTruthy();
    expect(mockReadPosition).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("punch-button"));
    fireEvent.press(await screen.findByRole("button", { name: "Take photo" }));
    await waitFor(() => expect(mockPunch).toHaveBeenCalled());
    expect(mockPunch).toHaveBeenCalledWith(expect.objectContaining({ kind: "in", deviceId: "app-test", consentVersion: "v1", selfie: "data:image/jpeg;base64,/9j/FAKE", lat: 19.076, lng: 72.8777, accuracyM: 12 }));
    expect(mockReadPosition).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("You are checked in.")).toBeTruthy();
  });

  it("shows the server's warning about the location", async () => {
    mockPunch.mockResolvedValue({ kind: "in", warning: "You are about 450 m from Head office. Your punch was saved and HR will review it." });
    render(<EmployeeHome />);
    fireEvent.press(screen.getByTestId("punch-button"));
    fireEvent.press(await screen.findByRole("button", { name: "Take photo" }));
    expect(await screen.findByText(/HR will review it/)).toBeTruthy();
  });

  it("does not send anything when the selfie is cancelled", async () => {
    render(<EmployeeHome />);
    fireEvent.press(screen.getByTestId("punch-button"));
    fireEvent.press(await screen.findByRole("button", { name: "Cancel selfie" }));
    expect(await screen.findByText(/A selfie is needed/)).toBeTruthy();
    expect(mockPunch).not.toHaveBeenCalled();
    expect(mockReadPosition).not.toHaveBeenCalled();
  });

  it("offers Check out when checked in, and skips the camera when the business does not ask for a selfie", async () => {
    state.me = me({ next: "out", openSince: new Date(), settings: { selfieRequired: false, geofencePolicy: "off", locationNeeded: false, retentionDays: 90 } });
    mockPunch.mockResolvedValue({ kind: "out", warning: null });
    render(<EmployeeHome />);
    expect(screen.getByText("You are checked in.")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Check out" }));
    await waitFor(() => expect(mockPunch).toHaveBeenCalled());
    expect(mockPunch.mock.calls[0]![0]).not.toHaveProperty("selfie");
    expect(mockReadPosition).not.toHaveBeenCalled();
    expect(await screen.findByText("You are checked out.")).toBeTruthy();
  });

  it("disables the button when check-in is switched off", () => {
    state.me = me({ canPunch: false });
    render(<EmployeeHome />);
    expect(screen.getByText(/switched off for your business/)).toBeTruthy();
    expect(screen.getByTestId("punch-button").props.accessibilityState?.disabled ?? screen.getByTestId("punch-button").props.disabled).toBeTruthy();
  });
});
