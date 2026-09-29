/**
 * ToastContainer — app-wide goey-toast host
 *
 * ToastContainer mounts goey-toast's <GooeyToaster /> once and keeps its theme
 * in sync with the `.dark` class on <html>. These tests render the real
 * toaster and trigger toasts through the app's toast() helper.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { ToastContainer } from "../Toast";
import { toast } from "@/hooks/useToast";

// jsdom has no ResizeObserver; goey-toast measures its blob with one.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
  document.documentElement.classList.remove("dark");
});

describe("ToastContainer — goey-toast host", () => {
  it("renders the title of a toast fired through toast()", async () => {
    render(<ToastContainer />);
    act(() => {
      toast.success("Invoice saved", "INV-0023 has been saved successfully.");
    });
    await waitFor(() => expect(screen.getByText("Invoice saved")).toBeInTheDocument());
  });

  it("switches the toaster to the dark theme when the app is in dark mode", async () => {
    render(<ToastContainer />);
    act(() => {
      document.documentElement.classList.add("dark");
    });
    act(() => {
      toast.info("Syncing");
    });
    await waitFor(() =>
      expect(document.body.querySelector('[data-sonner-toaster][data-sonner-theme="dark"]')).not.toBeNull(),
    );
  });
});
