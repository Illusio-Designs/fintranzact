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
  });
  return fn;
});
vi.mock("goey-toast", () => ({ gooeyToast: gooey }));

import { toast } from "@/hooks/useToast";

describe("toast() — goey-toast adapter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows a success toast with title and description", () => {
    const id = toast({ title: "Saved", description: "INV-1 saved", variant: "success" });
    expect(gooey.success).toHaveBeenCalledWith("Saved", { description: "INV-1 saved" });
    expect(id).toBe("s");
  });

  it("toast.success / error / info / warning call the matching goey-toast method", () => {
    toast.success("A");
    toast.error("B", "went wrong");
    toast.info("C");
    toast.warning("D");
    expect(gooey.success).toHaveBeenCalledWith("A", undefined);
    expect(gooey.error).toHaveBeenCalledWith("B", { description: "went wrong" });
    expect(gooey.info).toHaveBeenCalledWith("C", undefined);
    expect(gooey.warning).toHaveBeenCalledWith("D", undefined);
  });

  it("defaults to the info variant when none is given", () => {
    toast({ title: "Heads up" });
    expect(gooey.info).toHaveBeenCalledWith("Heads up", undefined);
  });

  it("toast.dismiss forwards to goey-toast", () => {
    toast.dismiss("s");
    expect(gooey.dismiss).toHaveBeenCalledWith("s");
  });
});
