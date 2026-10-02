import * as SecureStore from "expo-secure-store";
import {
  TRUSTED_DEVICE_KEY,
  buildLoginInput,
  buildVerifyInput,
  clearTrustedDeviceToken,
  getTrustedDeviceToken,
  setTrustedDeviceToken,
} from "../trusted-device";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const store = SecureStore as jest.Mocked<typeof SecureStore>;
beforeEach(() => jest.resetAllMocks());

describe("trusted device token storage", () => {
  it("reads, writes and clears under its own key", async () => {
    store.getItemAsync.mockResolvedValue("tok");
    expect(await getTrustedDeviceToken()).toBe("tok");
    expect(store.getItemAsync).toHaveBeenCalledWith(TRUSTED_DEVICE_KEY);
    await setTrustedDeviceToken("abc");
    expect(store.setItemAsync).toHaveBeenCalledWith(TRUSTED_DEVICE_KEY, "abc");
    await clearTrustedDeviceToken();
    expect(store.deleteItemAsync).toHaveBeenCalledWith(TRUSTED_DEVICE_KEY);
  });

  it("does not collide with the session token key", () => {
    expect(TRUSTED_DEVICE_KEY).not.toBe("fintranzact_session_token");
  });

  it("returns null for a missing or empty value", async () => {
    store.getItemAsync.mockResolvedValue(null);
    expect(await getTrustedDeviceToken()).toBeNull();
    store.getItemAsync.mockResolvedValue("");
    expect(await getTrustedDeviceToken()).toBeNull();
  });

  it("swallows storage failures", async () => {
    store.getItemAsync.mockRejectedValue(new Error("keystore"));
    store.setItemAsync.mockRejectedValue(new Error("keystore"));
    store.deleteItemAsync.mockRejectedValue(new Error("keystore"));
    expect(await getTrustedDeviceToken()).toBeNull();
    await expect(setTrustedDeviceToken("x")).resolves.toBeUndefined();
    await expect(clearTrustedDeviceToken()).resolves.toBeUndefined();
  });
});

describe("input builders", () => {
  it("login always sends client mobile and the stored token when there is one", () => {
    expect(buildLoginInput("a@b.in", "pw", "tok")).toEqual({
      email: "a@b.in",
      password: "pw",
      client: "mobile",
      trustedDeviceToken: "tok",
    });
    const none = buildLoginInput("a@b.in", "pw", null);
    expect(none).toEqual({ email: "a@b.in", password: "pw", client: "mobile" });
    expect("trustedDeviceToken" in none).toBe(false);
  });

  it("verify always sends client mobile", () => {
    expect(buildVerifyInput("ch", "123456", true)).toEqual({
      challengeToken: "ch",
      code: "123456",
      rememberDevice: true,
      client: "mobile",
    });
  });
});
