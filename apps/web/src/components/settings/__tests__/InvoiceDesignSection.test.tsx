import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { INVOICE_TEMPLATE_INFO } from "@fintranzact/shared";

const { updateMutate, invalidateStub } = vi.hoisted(() => ({
  updateMutate: vi.fn(),
  invalidateStub: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    business: {
      update: {
        useMutation: () => ({ mutate: updateMutate, isPending: false }),
      },
    },
    useUtils: () => ({ business: { list: { invalidate: invalidateStub } } }),
  },
  getBusinessId: () => "biz-1",
}));

vi.mock("@/hooks/useToast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { InvoiceDesignSection } from "../InvoiceDesignSection";

const biz = { id: "biz-1", invoiceTemplate: "modern", thermalWidth: 80 };

describe("InvoiceDesignSection", () => {
  beforeEach(() => {
    updateMutate.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("offers the ten A4 designs as one labelled radio group with the saved one checked", () => {
    render(<InvoiceDesignSection biz={biz} />);
    const group = screen.getByRole("radiogroup", { name: "Invoice design" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(10);
    for (const t of INVOICE_TEMPLATE_INFO) {
      const radio = within(group).getByRole("radio", { name: t.name });
      expect(radio).toHaveAccessibleDescription(t.description);
      expect(screen.getByTestId(`invoice-design-thumb-${t.id}`)).toHaveAttribute("aria-hidden", "true");
    }
    expect(within(group).getByRole("radio", { name: "Modern GST" })).toBeChecked();
    expect(within(group).getByRole("radio", { name: "Tally Classic" })).not.toBeChecked();
  });

  it("shows Save only after a change, and saves the design and roll width", () => {
    render(<InvoiceDesignSection biz={biz} />);
    expect(screen.queryByRole("button", { name: "Save invoice design" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Tally Classic" }));
    fireEvent.click(screen.getByRole("radio", { name: "58 mm" }));
    expect(screen.getByRole("radio", { name: "Tally Classic" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save invoice design" }));
    expect(updateMutate).toHaveBeenCalledWith({ id: "biz-1", data: { invoiceTemplate: "tally", thermalWidth: 58 } });
  });

  it("defaults to the classic design and the 80 mm roll for a business that never chose", () => {
    render(<InvoiceDesignSection biz={{ id: "biz-1" }} />);
    expect(screen.getByRole("radio", { name: "Classic" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "80 mm" })).toBeChecked();
  });

  it("previews the chosen design as a PDF for the active business", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(["%PDF-1.3"], { type: "application/pdf" }), { status: 200 }));
    const openMock = vi.fn().mockReturnValue({});
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("open", openMock);
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    render(<InvoiceDesignSection biz={biz} />);
    fireEvent.click(screen.getByRole("radio", { name: "Bold Header Band" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview PDF" }));
    await waitFor(() => expect(openMock).toHaveBeenCalledWith("blob:preview", "_blank"));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/api/invoice-templates/preview?template=bold");
    expect(init.headers["x-business-id"]).toBe("biz-1");
    expect(init.credentials).toBe("include");
  });

  it("previews the thermal receipt at the chosen width", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(["%PDF-1.3"]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("open", vi.fn().mockReturnValue({}));
    URL.createObjectURL = vi.fn(() => "blob:preview");
    render(<InvoiceDesignSection biz={biz} />);
    fireEvent.click(screen.getByRole("radio", { name: "58 mm" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview receipt" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/api/invoice-templates/preview?format=thermal&width=58");
  });
});
