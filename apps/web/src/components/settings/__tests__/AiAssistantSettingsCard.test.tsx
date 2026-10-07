import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  settings: { current: { enabled: true, disabledRoles: [] as string[], actionsEnabled: true, actionsDisabledRoles: [] as string[], roles: [] as Array<{ role: string; label: string }> } },
  save: vi.fn(),
  invalidate: vi.fn(),
  billing: { current: { addons: { ai_assistant: true, ai_plus: false }, trial: { active: false, caps: null }, readOnly: false, canManageBilling: true } as unknown },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ ai: { settings: { invalidate: h.invalidate }, status: { invalidate: h.invalidate } } }),
    billing: { status: { useQuery: () => ({ data: h.billing.current, isLoading: false }) } },
    ai: {
      settings: { useQuery: () => ({ data: h.settings.current }) },
      updateSettings: {
        useMutation: (opts: { onSuccess?: () => void } = {}) => ({ isPending: false, mutate: (v: unknown) => { h.save(v); opts.onSuccess?.(); } }),
      },
    },
  },
}));
vi.mock("@/hooks/useToast", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock("@tanstack/react-router", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));

import { AiAssistantSettingsCard } from "../AiAssistantSettingsCard";

beforeEach(() => {
  vi.clearAllMocks();
  h.settings.current = { enabled: true, disabledRoles: [], actionsEnabled: true, actionsDisabledRoles: [], roles: [] };
});

describe("AiAssistantSettingsCard", () => {
  it("is for the owner only", () => {
    for (const role of ["admin", "seller", "accountant", undefined]) {
      const { container, unmount } = render(<AiAssistantSettingsCard role={role} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
    render(<AiAssistantSettingsCard role="owner" />);
    expect(screen.getByTestId("ai-settings-card")).toBeInTheDocument();
  });

  it("lists the switchable roles, all on by default, and Save starts disabled", () => {
    render(<AiAssistantSettingsCard role="superadmin" />);
    for (const label of ["Admin", "Sales manager", "Salesperson", "Accountant"]) expect(screen.getByRole("checkbox", { name: label })).toBeChecked();
    expect(screen.getByRole("switch", { name: /Allow the AI assistant/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.queryByRole("checkbox", { name: /auditor|owner/i })).not.toBeInTheDocument();
  });

  it("saves a role switched off", async () => {
    render(<AiAssistantSettingsCard role="owner" />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Salesperson" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(h.save).toHaveBeenCalledWith({ enabled: true, disabledRoles: ["seller"], actionsEnabled: true, actionsDisabledRoles: [] });
  });

  it("saves the organisation switch and greys out the role list while off", async () => {
    render(<AiAssistantSettingsCard role="owner" />);
    await userEvent.click(screen.getByRole("switch", { name: /Allow the AI assistant/ }));
    expect(screen.getByRole("checkbox", { name: "Admin" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(h.save).toHaveBeenCalledWith({ enabled: false, disabledRoles: [], actionsEnabled: true, actionsDisabledRoles: [] });
  });

  it("loads what is saved", () => {
    h.settings.current = { enabled: true, disabledRoles: ["accountant"], actionsEnabled: true, actionsDisabledRoles: [], roles: [] };
    render(<AiAssistantSettingsCard role="owner" />);
    expect(screen.getByRole("checkbox", { name: "Accountant" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Admin" })).toBeChecked();
  });

  it("has its own switch and role list for actions, on by default", () => {
    render(<AiAssistantSettingsCard role="owner" />);
    expect(screen.getByRole("switch", { name: /Allow the assistant to prepare actions/ })).toBeChecked();
    for (const label of ["Admin", "Sales manager", "Salesperson", "Accountant"]) expect(screen.getByRole("checkbox", { name: `${label}: actions` })).toBeChecked();
  });

  it("saves actions switched off for one role, leaving the assistant itself on", async () => {
    render(<AiAssistantSettingsCard role="owner" />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Salesperson: actions" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(h.save).toHaveBeenCalledWith({ enabled: true, disabledRoles: [], actionsEnabled: true, actionsDisabledRoles: ["seller"] });
  });

  it("saves actions switched off for the organisation and greys out their role list", async () => {
    render(<AiAssistantSettingsCard role="superadmin" />);
    await userEvent.click(screen.getByRole("switch", { name: /Allow the assistant to prepare actions/ }));
    expect(screen.getByRole("checkbox", { name: "Admin: actions" })).toBeDisabled();
    // The chat's own role list is not affected.
    expect(screen.getByRole("checkbox", { name: "Admin" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(h.save).toHaveBeenCalledWith({ enabled: true, disabledRoles: [], actionsEnabled: false, actionsDisabledRoles: [] });
  });

  it("loads the saved action switches, and treats an older server answer as actions on", () => {
    h.settings.current = { enabled: true, disabledRoles: [], actionsEnabled: false, actionsDisabledRoles: ["admin"], roles: [] };
    const { unmount } = render(<AiAssistantSettingsCard role="owner" />);
    expect(screen.getByRole("switch", { name: /Allow the assistant to prepare actions/ })).not.toBeChecked();
    unmount();
    h.settings.current = { enabled: true, disabledRoles: [], roles: [] } as never;
    render(<AiAssistantSettingsCard role="owner" />);
    expect(screen.getByRole("switch", { name: /Allow the assistant to prepare actions/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("says the switches apply once the add-on is there when the organisation does not have it", () => {
    h.billing.current = { addons: { ai_assistant: false, ai_plus: false }, trial: { active: false, caps: null }, readOnly: false, canManageBilling: true };
    render(<AiAssistantSettingsCard role="owner" />);
    expect(screen.getByTestId("ai-settings-card")).toHaveTextContent("does not have the add-on yet");
  });
});
