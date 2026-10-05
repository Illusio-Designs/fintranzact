import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { defaultPolicyTemplate } from "@fintranzact/shared";

const { updateMutate, resetMutate, invalidate, policiesState, toastSuccess, toastError } = vi.hoisted(() => ({
  updateMutate: vi.fn(),
  resetMutate: vi.fn(),
  invalidate: vi.fn(),
  policiesState: { data: undefined as unknown },
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    store: {
      getPolicies: { useQuery: () => ({ data: policiesState.data, isLoading: !policiesState.data }) },
      updatePolicy: { useMutation: () => ({ mutate: updateMutate, isPending: false }) },
      resetPolicy: { useMutation: () => ({ mutate: resetMutate, isPending: false }) },
    },
    useUtils: () => ({ store: { getPolicies: { invalidate } } }),
  },
}));

vi.mock("@/hooks/useToast", () => ({ toast: { success: toastSuccess, error: toastError } }));

import { StorePoliciesCard, policyUrls } from "../StorePoliciesCard";

const KINDS = ["terms", "refund", "shipping", "contact", "privacy"] as const;

function makeData(overrides: Record<string, { content: string; updatedAt: string }> = {}) {
  return {
    storeSlug: "sharma",
    variables: {
      businessName: "Sharma Electronics",
      address: "12 MG Road, Pune",
      gstin: "27ABCDE1234F1Z5",
      phone: "9876543210",
      email: "hello@sharma.example",
      returnWindowDays: 10,
    },
    policies: KINDS.map((kind) => ({
      kind,
      title: { terms: "Terms & Conditions", refund: "Refund & Cancellation Policy", shipping: "Shipping & Delivery Policy", contact: "Contact Us", privacy: "Privacy Policy" }[kind],
      template: defaultPolicyTemplate(kind),
      content: overrides[kind]?.content ?? null,
      isCustom: !!overrides[kind],
      updatedAt: overrides[kind]?.updatedAt ?? null,
    })),
  };
}

describe("StorePoliciesCard", () => {
  beforeEach(() => {
    updateMutate.mockReset();
    resetMutate.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    policiesState.data = makeData();
  });

  it("lists the five public links under the store address", () => {
    render(<StorePoliciesCard storeBaseUrl="https://store.example.com/sharma" />);
    expect(policyUrls("https://store.example.com/sharma").map((u) => u.url)).toEqual([
      "https://store.example.com/sharma/policies/terms",
      "https://store.example.com/sharma/policies/refund",
      "https://store.example.com/sharma/policies/shipping",
      "https://store.example.com/sharma/policies/contact",
      "https://store.example.com/sharma/policies/privacy",
    ]);
    const link = screen.getByRole("link", { name: "https://store.example.com/sharma/policies/refund" });
    expect(link).toHaveAttribute("href", "https://store.example.com/sharma/policies/refund");
    expect(screen.getByRole("button", { name: "Copy all links" })).toBeInTheDocument();
  });

  it("copies all five links at once", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<StorePoliciesCard storeBaseUrl="https://store.example.com/sharma" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy all links" }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0]![0] as string;
    expect(copied.split("\n")).toHaveLength(5);
    expect(copied).toContain("Privacy Policy: https://store.example.com/sharma/policies/privacy");
  });

  it("asks for a store URL before showing links when none is set", () => {
    render(<StorePoliciesCard storeBaseUrl={null} />);
    expect(screen.getByText(/Choose a store URL/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy all links" })).toBeNull();
  });

  it("shows one tab per page and starts on the template", () => {
    render(<StorePoliciesCard storeBaseUrl="https://store.example.com/sharma" />);
    expect(screen.getAllByRole("tab")).toHaveLength(5);
    expect(screen.getByTestId("policy-status")).toHaveTextContent("Using the template");
    const textarea = screen.getByLabelText("Terms & Conditions text") as HTMLTextAreaElement;
    expect(textarea.value).toBe(defaultPolicyTemplate("terms"));
    expect(screen.getByRole("button", { name: "Save page" })).toBeDisabled();
  });

  it("previews the page with the business details filled in", () => {
    render(<StorePoliciesCard storeBaseUrl="https://store.example.com/sharma" />);
    fireEvent.click(screen.getByRole("tab", { name: /Refund & Cancellation/ }));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    const preview = screen.getByTestId("policy-preview");
    expect(within(preview).getByText("10 days")).toBeInTheDocument();
    expect(preview.textContent).toContain("Sharma Electronics");
    expect(preview.textContent).not.toContain("{{");
  });

  it("previews owner text as text, never as HTML", () => {
    render(<StorePoliciesCard storeBaseUrl="https://store.example.com/sharma" />);
    fireEvent.change(screen.getByLabelText("Terms & Conditions text"), {
      target: { value: "<img src=x onerror=alert(1)> [x](javascript:alert(1))" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    const preview = screen.getByTestId("policy-preview");
    expect(preview.querySelector("img")).toBeNull();
    expect(preview.querySelector("a")).toBeNull();
    expect(preview.textContent).toContain("<img src=x");
  });

  it("saves edited text for the selected page", () => {
    render(<StorePoliciesCard storeBaseUrl="https://store.example.com/sharma" />);
    fireEvent.click(screen.getByRole("tab", { name: /Shipping & Delivery/ }));
    fireEvent.change(screen.getByLabelText("Shipping & Delivery Policy text"), { target: { value: "We ship in 3 days." } });
    fireEvent.click(screen.getByRole("button", { name: "Save page" }));
    expect(updateMutate).toHaveBeenCalledWith({ kind: "shipping", content: "We ship in 3 days." });
  });

  it("shows edited status and resets an edited page through the API", () => {
    policiesState.data = makeData({ privacy: { content: "My privacy text", updatedAt: "2026-10-05T10:00:00.000Z" } });
    render(<StorePoliciesCard storeBaseUrl="https://store.example.com/sharma" />);
    fireEvent.click(screen.getByRole("tab", { name: /Privacy Policy/ }));
    expect(screen.getByTestId("policy-status")).toHaveTextContent(/^Edited on /);
    expect((screen.getByLabelText("Privacy Policy text") as HTMLTextAreaElement).value).toBe("My privacy text");
    fireEvent.click(screen.getByRole("button", { name: "Reset to template" }));
    expect(resetMutate).toHaveBeenCalledWith({ kind: "privacy" });
  });

  it("can fill the placeholders with the business details for plain editing", () => {
    render(<StorePoliciesCard storeBaseUrl="https://store.example.com/sharma" />);
    fireEvent.click(screen.getByRole("button", { name: "Fill in my details" }));
    const value = (screen.getByLabelText("Terms & Conditions text") as HTMLTextAreaElement).value;
    expect(value).toContain("Sharma Electronics");
    expect(value).not.toContain("{{businessName}}");
    expect(screen.getByRole("button", { name: "Save page" })).toBeEnabled();
  });

  it("does not allow saving an empty page", () => {
    render(<StorePoliciesCard storeBaseUrl="https://store.example.com/sharma" />);
    fireEvent.change(screen.getByLabelText("Terms & Conditions text"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Save page" })).toBeDisabled();
  });
});
