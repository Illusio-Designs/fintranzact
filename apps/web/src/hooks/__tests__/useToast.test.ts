import { describe, it, expect, vi, beforeEach } from "vitest";

// toast() is a thin adapter over goey-toast — verify it maps each variant
// to the matching gooeyToast method with the right title and description.
const gooey = vi.hoisted(() => {
  const fn = Object.assign(vi.fn(), {
    success: vi.fn(() => "s"),
    error: vi.fn(() => "e"),
    info: vi.fn(() => "i"),
    warning: vi.fn(() => "w"),
    dismiss: vi.fn(),
    promise: vi.fn(),
  });
  return fn;
});
vi.mock("goey-toast", () => ({ gooeyToast: gooey }));

import { toast } from "@/hooks/useToast";

describe("toast() — goey-toast adapter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows a success toast with title and description, no timestamp, 4s", () => {
    const id = toast({ title: "Saved", description: "INV-1 saved", variant: "success" });
    expect(gooey.success).toHaveBeenCalledWith("Saved", expect.objectContaining({ description: "INV-1 saved", duration: 4000, showTimestamp: false }));
    expect(id).toBe("s");
  });

  it("toast.success / error / info / warning call the matching goey-toast method", () => {
    toast.success("A");
    toast.error("B", "went wrong");
    toast.info("C");
    toast.warning("D");
    expect(gooey.success).toHaveBeenCalledWith("A", expect.objectContaining({ description: undefined }));
    expect(gooey.error).toHaveBeenCalledWith("B", expect.objectContaining({ description: "went wrong" }));
    expect(gooey.info).toHaveBeenCalledWith("C", expect.anything());
    expect(gooey.warning).toHaveBeenCalledWith("D", expect.anything());
  });

  it("errors and warnings stay 6 seconds so there is time to read the fix", () => {
    toast.error("B", "went wrong");
    toast.warning("D");
    expect(gooey.error).toHaveBeenCalledWith("B", expect.objectContaining({ duration: 6000 }));
    expect(gooey.warning).toHaveBeenCalledWith("D", expect.objectContaining({ duration: 6000 }));
  });

  it("passes an action button through (e.g. Try again)", () => {
    const onClick = vi.fn();
    toast.error("Couldn't download the PDF", "Check your connection", { label: "Try again", onClick });
    expect(gooey.error).toHaveBeenCalledWith("Couldn't download the PDF", expect.objectContaining({ action: { label: "Try again", onClick } }));
  });

  it("defaults to the info variant when none is given", () => {
    toast({ title: "Heads up" });
    expect(gooey.info).toHaveBeenCalledWith("Heads up", expect.objectContaining({ showTimestamp: false }));
  });

  it("toast.promise shows one toast that goes from loading to done", async () => {
    const p = Promise.resolve(1);
    await toast.promise(p, { loading: "Saving…", success: "Saved", error: "Couldn't save" });
    expect(gooey.promise).toHaveBeenCalledWith(p, expect.objectContaining({ loading: "Saving…", success: "Saved", showTimestamp: false }));
  });

  it("toast.dismiss forwards to goey-toast", () => {
    toast.dismiss("s");
    expect(gooey.dismiss).toHaveBeenCalledWith("s");
  });
});
