import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PayNowButton } from "../PayNowButton";

afterEach(() => vi.unstubAllGlobals());

describe("PayNowButton", () => {
  it("asks the server for a link by share token alone (no amount, no credentials) and redirects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ url: "https://rzp.io/i/abc" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onRedirect = vi.fn();
    render(<PayNowButton token="tok123" onRedirect={onRedirect} />);
    fireEvent.click(screen.getByTestId("pay-now"));
    await waitFor(() => expect(onRedirect).toHaveBeenCalledWith("https://rzp.io/i/abc"));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/share\/tok123\/pay$/);
    expect(init).toMatchObject({ method: "POST", credentials: "omit" });
    expect(init.body).toBeUndefined();
  });

  it("shows the server's message when no link can be made", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "There is nothing to pay online on this invoice." }), { status: 409 })));
    const onRedirect = vi.fn();
    render(<PayNowButton token="t" onRedirect={onRedirect} />);
    fireEvent.click(screen.getByTestId("pay-now"));
    expect(await screen.findByTestId("pay-now-error")).toHaveTextContent("nothing to pay online");
    expect(onRedirect).not.toHaveBeenCalled();
    expect(screen.getByTestId("pay-now")).not.toBeDisabled();
  });

  it("copes with a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<PayNowButton token="t" onRedirect={vi.fn()} />);
    fireEvent.click(screen.getByTestId("pay-now"));
    expect(await screen.findByTestId("pay-now-error")).toHaveTextContent(/Could not reach/);
  });
});
