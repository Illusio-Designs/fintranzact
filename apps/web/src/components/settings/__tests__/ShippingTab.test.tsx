import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { updateMutate, invalidateStub } = vi.hoisted(() => ({
  updateMutate: vi.fn(),
  invalidateStub: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    business: {
      update: {
        useMutation: (_opts?: { onSuccess?: () => void; onError?: (err: any) => void }) => ({
          mutate: updateMutate,
          isPending: false,
        }),
      },
    },
    useUtils: () => ({
      business: {
        list: { invalidate: invalidateStub },
      },
    }),
  },
}));

vi.mock("@/hooks/useToast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { ShippingTab } from "../ShippingTab";

describe("ShippingTab — save", () => {
  beforeEach(() => {
    updateMutate.mockReset();
  });

  it("sends business.update with { id, data: { customShippingMethods } }", () => {
    render(<ShippingTab biz={{ id: "biz-1", customShippingMethods: null }} />);

    fireEvent.change(screen.getByPlaceholderText(/Dunzo, Porter/), {
      target: { value: "Porter" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: /Save Shipping Settings/ }));

    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate).toHaveBeenCalledWith({
      id: "biz-1",
      data: {
        customShippingMethods: [{ id: "porter", label: "Porter", hasTracking: false }],
      },
    });
  });

  it("sends an empty list when every custom method is removed", () => {
    render(
      <ShippingTab
        biz={{
          id: "biz-1",
          customShippingMethods: [{ id: "porter", label: "Porter", hasTracking: false }],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: /Save Shipping Settings/ }));

    expect(updateMutate).toHaveBeenCalledWith({
      id: "biz-1",
      data: { customShippingMethods: [] },
    });
  });
});

describe("ShippingTab — adding methods", () => {
  beforeEach(() => {
    updateMutate.mockReset();
  });

  it("won't add a custom method that is already built in", async () => {
    const { toast } = await import("@/hooks/useToast");
    render(<ShippingTab biz={{ id: "biz-1", customShippingMethods: null }} />);

    fireEvent.change(screen.getByPlaceholderText(/Dunzo, Porter/), { target: { value: "Courier" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(toast.error).toHaveBeenCalledWith("That is already a built-in method");
    expect(screen.queryByRole("button", { name: /Save Shipping Settings/ })).not.toBeInTheDocument();
  });

  it("says where saved methods show up", () => {
    render(<ShippingTab biz={{ id: "biz-1", customShippingMethods: null }} />);
    expect(screen.getByText(/Once saved, they appear alongside the built-in methods/)).toBeInTheDocument();
  });
});
