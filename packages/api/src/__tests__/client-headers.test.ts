import { describe, it, expect } from "vitest";
import { getClientKind, isFirstPartyRequestedWith } from "../lib/client-headers.js";

describe("client-headers — Fintranzact headers", () => {
  it("accepts the new X-Requested-With value 'fintranzact'", () => {
    expect(isFirstPartyRequestedWith("fintranzact")).toBe(true);
  });

  it("rejects any other X-Requested-With value, including a missing header", () => {
    expect(isFirstPartyRequestedWith("XMLHttpRequest")).toBe(false);
    expect(isFirstPartyRequestedWith("Fintranzact")).toBe(false);
    expect(isFirstPartyRequestedWith("")).toBe(false);
    expect(isFirstPartyRequestedWith(null)).toBe(false);
    expect(isFirstPartyRequestedWith(undefined)).toBe(false);
  });

  it("reads the client kind from X-Fintranzact-Client", () => {
    expect(getClientKind(new Headers({ "x-fintranzact-client": "desktop" }))).toBe("desktop");
  });

  it("returns null when neither header is present", () => {
    expect(getClientKind(new Headers())).toBeNull();
  });
});
