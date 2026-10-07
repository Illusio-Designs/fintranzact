/**
 * Platform admin trial controls: the list label, the organisation panel's
 * facts and actions (extend, custom trial, end now) with a required reason,
 * and the trial settings form with its bounds.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  extend: vi.fn(),
  grant: vi.fn(),
  end: vi.fn(),
  save: vi.fn(),
  invalidate: vi.fn(),
  settings: { current: { days: 14, partnerDays: 30, caps: { aiQuestions: 50, payrollEmployees: 10 } } },
  mutation: (fn: (input: unknown) => void) => ({
    useMutation: (opts: any = {}) => ({
      isPending: false,
      mutate: (input: any) => {
        fn(input);
        opts.onSuccess?.({}, input);
      },
    }),
  }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ platform: { tenant: { invalidate: h.invalidate }, tenants: { invalidate: h.invalidate }, trialSettings: { invalidate: h.invalidate } } }),
    platform: {
      extendTrial: h.mutation(h.extend),
      grantTrial: h.mutation(h.grant),
      endTrial: h.mutation(h.end),
      saveTrialSettings: h.mutation(h.save),
      trialSettings: { useQuery: () => ({ data: h.settings.current }) },
    },
  },
}));
vi.mock("@/hooks/useToast", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

import { TrialSection, trialListLabel, type TrialDetail } from "../TrialSection";
import { TrialSettingsCard } from "../TrialSettingsCard";

const running: TrialDetail = {
  id: "t1",
  accessGrandfathered: false,
  accessState: "trialing",
  trialSource: "partner",
  trialStartedAt: "2026-10-01T00:00:00.000Z",
  trialEndsAt: "2026-10-31T00:00:00.000Z",
  trial: { active: true, ended: false, daysLeft: 28, source: "partner", totalDays: 30 },
};

beforeEach(() => vi.clearAllMocks());

describe("trialListLabel", () => {
  it("says what the trial is in one line", () => {
    const base = { accessGrandfathered: false, trialEndsAt: "2026-10-31", trialSource: "signup", trialDaysLeft: 9 };
    expect(trialListLabel(base)).toEqual({ text: "9 days left", tone: "green" });
    expect(trialListLabel({ ...base, trialDaysLeft: 1 })).toEqual({ text: "1 day left", tone: "amber" });
    expect(trialListLabel({ ...base, trialDaysLeft: 0 })).toEqual({ text: "Ended", tone: "red" });
    expect(trialListLabel({ ...base, trialDaysLeft: 0, trialSource: "none" })).toEqual({ text: "No trial", tone: "red" });
    expect(trialListLabel({ ...base, trialEndsAt: null })).toEqual({ text: "No trial", tone: "grey" });
    expect(trialListLabel({ ...base, accessGrandfathered: true })).toEqual({ text: "Grandfathered", tone: "grey" });
  });
});

describe("TrialSection", () => {
  it("shows source, start, end and days left", () => {
    render(<TrialSection detail={running} />);
    expect(screen.getByText("Partner referral")).toBeInTheDocument();
    expect(screen.getByText("Trial running")).toBeInTheDocument();
    expect(screen.getByText("28")).toBeInTheDocument();
  });

  it("extend needs a reason, then sends days and reason", async () => {
    const user = userEvent.setup();
    render(<TrialSection detail={running} />);
    await user.click(screen.getByRole("button", { name: "Extend trial" }));
    const submit = screen.getAllByRole("button", { name: "Extend trial" }).find((b) => b.getAttribute("type") === "submit")!;
    expect(submit).toBeDisabled();
    await user.clear(screen.getByLabelText("Days"));
    await user.type(screen.getByLabelText("Days"), "10");
    await user.type(screen.getByLabelText(/Reason/), "Asked for time");
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);
    expect(h.extend).toHaveBeenCalledWith({ tenantId: "t1", days: 10, reason: "Asked for time" });
  });

  it("a custom trial and ending now go through their own procedures", async () => {
    const user = userEvent.setup();
    render(<TrialSection detail={running} />);
    await user.click(screen.getByRole("button", { name: "Grant custom trial" }));
    await user.type(screen.getByLabelText(/Reason/), "Demo for partner");
    await user.click(screen.getByRole("button", { name: "Grant trial" }));
    expect(h.grant).toHaveBeenCalledWith({ tenantId: "t1", days: 7, reason: "Demo for partner" });

    await user.click(screen.getByRole("button", { name: "End trial now" }));
    await user.type(screen.getByLabelText(/Reason/), "Abuse");
    await user.click(screen.getByRole("button", { name: "End trial" }));
    expect(h.end).toHaveBeenCalledWith({ tenantId: "t1", reason: "Abuse" });
  });

  it("End trial now is offered only while a trial runs; grandfathered organisations get no actions", () => {
    const { rerender } = render(<TrialSection detail={{ ...running, trial: { ...running.trial, active: false, ended: true }, accessState: "trial_expired" }} />);
    expect(screen.queryByRole("button", { name: "End trial now" })).toBeNull();
    expect(screen.getByRole("button", { name: "Extend trial" })).toBeInTheDocument();
    rerender(<TrialSection detail={{ ...running, accessGrandfathered: true }} />);
    expect(screen.queryByRole("button", { name: "Extend trial" })).toBeNull();
    expect(screen.getByText(/permanent full access/)).toBeInTheDocument();
  });
});

describe("TrialSettingsCard", () => {
  it("shows no field errors while the saved settings are still loading", () => {
    const loaded = h.settings.current;
    (h.settings as { current: unknown }).current = undefined;
    try {
      render(<TrialSettingsCard />);
      for (const label of ["Trial length (days)", "Partner referral trial (days)", "AI questions in the trial", "Payroll employees in the trial"]) {
        expect(screen.getByLabelText(label)).not.toHaveAttribute("aria-invalid");
      }
    } finally {
      h.settings.current = loaded;
    }
  });

  it("loads the settings, and saving is disabled until something valid changes", async () => {
    const user = userEvent.setup();
    render(<TrialSettingsCard />);
    const save = screen.getByRole("button", { name: "Save trial settings" });
    expect(screen.getByLabelText("Trial length (days)")).toHaveValue(14);
    expect(screen.getByLabelText("Partner referral trial (days)")).toHaveValue(30);
    expect(screen.getByLabelText("AI questions in the trial")).toHaveValue(50);
    expect(screen.getByLabelText("Payroll employees in the trial")).toHaveValue(10);
    expect(save).toBeDisabled();

    await user.clear(screen.getByLabelText("Trial length (days)"));
    await user.type(screen.getByLabelText("Trial length (days)"), "91");
    expect(save).toBeDisabled(); // above the 90-day bound

    await user.clear(screen.getByLabelText("Trial length (days)"));
    await user.type(screen.getByLabelText("Trial length (days)"), "21");
    expect(save).toBeEnabled();
    await user.click(save);
    expect(h.save).toHaveBeenCalledWith({ days: 21, partnerDays: 30, caps: { aiQuestions: 50, payrollEmployees: 10 } });
  });
});
