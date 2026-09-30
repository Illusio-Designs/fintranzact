/**
 * TurnstileModal — the "Quick verification" step before sign-up and the
 * partner application are sent.
 *
 * These tests verify:
 *   1. With Cloudflare's script loaded, the widget mounts and a passed check
 *      hands the token to the form (which then sends it).
 *   2. While the script is loading the modal says so instead of showing an
 *      empty box.
 *   3. If the script never loads (ad-blocker, firewall, offline) the modal
 *      explains it after a timeout and offers "Try again", which reloads
 *      the script and mounts the widget once it arrives.
 *   4. A failed check can be retried.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { TurnstileModal } from "../TurnstileModal";

type RenderOpts = Parameters<NonNullable<Window["turnstile"]>["render"]>[1];

function installTurnstile() {
  const calls: RenderOpts[] = [];
  window.turnstile = {
    render: vi.fn((_el: HTMLElement, opts: RenderOpts) => {
      calls.push(opts);
      return `widget-${calls.length}`;
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  };
  return calls;
}

beforeEach(() => {
  delete window.turnstile;
  document.querySelectorAll("script").forEach((s) => s.remove());
});

afterEach(() => {
  vi.useRealTimers();
  delete window.turnstile;
});

describe("TurnstileModal", () => {
  it("mounts the check and passes the token on when it succeeds", () => {
    const calls = installTurnstile();
    const onVerified = vi.fn();
    render(<TurnstileModal open onVerified={onVerified} onClose={vi.fn()} />);

    expect(window.turnstile!.render).toHaveBeenCalledTimes(1);
    act(() => calls[0]!.callback("token-123"));
    expect(onVerified).toHaveBeenCalledWith("token-123");
    expect(screen.queryByText(/Loading security check/)).not.toBeInTheDocument();
  });

  it("shows that the check is loading while the script is on its way", () => {
    vi.useFakeTimers();
    render(<TurnstileModal open onVerified={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/Loading security check/)).toBeInTheDocument();

    const calls = installTurnstile();
    act(() => vi.advanceTimersByTime(200));
    expect(calls).toHaveLength(1);
    expect(screen.queryByText(/Loading security check/)).not.toBeInTheDocument();
  });

  it("explains a blocked script instead of hanging, and recovers on Try again", () => {
    vi.useFakeTimers();
    render(<TurnstileModal open onVerified={vi.fn()} onClose={vi.fn()} />);

    act(() => vi.advanceTimersByTime(10_500));
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't load/);

    act(() => screen.getByRole("button", { name: "Try again" }).click());
    expect(document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]')).not.toBeNull();
    expect(screen.getByText(/Loading security check/)).toBeInTheDocument();

    const calls = installTurnstile();
    act(() => vi.advanceTimersByTime(200));
    expect(calls).toHaveLength(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("lets the visitor retry a failed check", () => {
    const calls = installTurnstile();
    render(<TurnstileModal open onVerified={vi.fn()} onClose={vi.fn()} />);

    act(() => calls[0]!["error-callback"]!());
    expect(screen.getByRole("alert")).toHaveTextContent(/Verification failed/);

    act(() => screen.getByRole("button", { name: "Try again" }).click());
    expect(window.turnstile!.remove).toHaveBeenCalledWith("widget-1");
    expect(calls).toHaveLength(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
