import { afterEach, describe, expect, it, vi } from "vitest";
import superjson from "superjson";
import { FintranzactApiError, FintranzactClient } from "../client.js";
import { completeTwoFactor } from "../auth.js";
import { EXIT } from "../output.js";

type Verify = (input: { challengeToken: string; code: string }) => Promise<{ sessionToken: string }>;
const fakeClient = (verify: Verify) => ({ auth: { verifyTwoFactor: verify } }) as unknown as FintranzactClient;
const wrong = () =>
  new FintranzactApiError({ code: "validation_failed", fields: { _: ["That code is not right. Check your authenticator app and try again."] } });

afterEach(() => vi.restoreAllMocks());

describe("completeTwoFactor", () => {
  it("uses a code given up front (--code / FINTRANZACT_2FA_CODE) once and returns the session token", async () => {
    const verify = vi.fn<Verify>().mockResolvedValue({ sessionToken: "tok" });
    const token = await completeTwoFactor(fakeClient(verify), "chal", { code: "123456" });
    expect(token).toBe("tok");
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith({ challengeToken: "chal", code: "123456" });
  });

  it("a wrong up-front code is not retried: it fails with the server message", async () => {
    vi.spyOn(process, "exit").mockImplementation(((c?: number) => {
      throw new Error(`exit ${c}`);
    }) as never);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const verify = vi.fn<Verify>().mockRejectedValue(wrong());
    await expect(completeTwoFactor(fakeClient(verify), "chal", { code: "000000" })).rejects.toThrow(`exit ${EXIT.AUTH}`);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(String(stderr.mock.calls[0][0])).toContain("That code is not right");
  });

  it("an interactive prompt gets a retry after a wrong code", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const verify = vi.fn<Verify>().mockRejectedValueOnce(wrong()).mockResolvedValueOnce({ sessionToken: "tok2" });
    const prompt = vi.fn().mockResolvedValueOnce(" 000000 ").mockResolvedValueOnce("654321");
    expect(await completeTwoFactor(fakeClient(verify), "chal", { promptCode: prompt })).toBe("tok2");
    expect(verify.mock.calls.map((c) => c[0].code)).toEqual(["000000", "654321"]);
  });

  it("with no code and no terminal it explains --code and the env var", async () => {
    vi.spyOn(process, "exit").mockImplementation(((c?: number) => {
      throw new Error(`exit ${c}`);
    }) as never);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const verify = vi.fn<Verify>();
    await expect(completeTwoFactor(fakeClient(verify), "chal", {})).rejects.toThrow(`exit ${EXIT.AUTH}`);
    expect(verify).not.toHaveBeenCalled();
    expect(String(stderr.mock.calls[0][0])).toMatch(/--code.*FINTRANZACT_2FA_CODE/);
  });
});

describe("client auth calls", () => {
  const sent: Array<{ url: string; body: unknown }> = [];
  const mockFetch = (data: unknown) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        sent.push({ url, body: superjson.parse(init.body) });
        return new Response(JSON.stringify({ result: { data: superjson.serialize(data) } }), { status: 200 });
      }),
    );
  const client = new FintranzactClient({ apiUrl: "http://x.test", token: "", tenantId: "", businessId: "" });

  afterEach(() => {
    vi.unstubAllGlobals();
    sent.length = 0;
  });

  it("login identifies itself as the CLI and reads sessionToken (the API never returned sessionId)", async () => {
    mockFetch({ twoFactorRequired: false, user: { id: "u", email: "a@b.in", name: null }, sessionToken: "sess" });
    const r = await client.auth.login({ email: "a@b.in", password: "pw" });
    expect(sent[0].body).toEqual({ email: "a@b.in", password: "pw", client: "cli" });
    expect(!r.twoFactorRequired && r.sessionToken).toBe("sess");
  });

  it("verifyTwoFactor never asks to remember the device", async () => {
    mockFetch({ user: { id: "u", email: "a@b.in", name: null }, sessionToken: "sess" });
    await client.auth.verifyTwoFactor({ challengeToken: "c", code: "123456" });
    expect(sent[0].url).toContain("auth.verifyTwoFactor");
    expect(sent[0].body).toEqual({ challengeToken: "c", code: "123456", rememberDevice: false, client: "cli" });
  });
});
