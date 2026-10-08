import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const P1 = "11111111-1111-4111-8111-111111111111";
const L1 = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => ({
  punches: { data: [] as unknown[], error: null as unknown },
  settings: { data: undefined as unknown },
  locations: { data: [] as unknown[] },
  keys: { data: [] as unknown[] },
  review: vi.fn(),
  save: vi.fn(),
  createLoc: vi.fn(),
  updateLoc: vi.fn(),
  deleteLoc: vi.fn(),
  assign: vi.fn(),
  createKey: vi.fn(),
  revokeKey: vi.fn(),
  invalidate: vi.fn(),
  toast: vi.fn(),
  punchesArgs: vi.fn(),
  assigned: [] as string[],
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      payrollPunch: { punches: { invalidate: h.invalidate }, settings: { invalidate: h.invalidate }, locationList: { invalidate: h.invalidate }, deviceKeyList: { invalidate: h.invalidate } },
      payrollAttendance: { month: { invalidate: h.invalidate } },
    }),
    payrollEmployee: { list: { useQuery: () => ({ data: { data: [{ id: "e1", name: "Asha Verma", employeeCode: "E001" }] } }) } },
    payrollPunch: {
      punches: { useQuery: (a: unknown) => { h.punchesArgs(a); return { data: h.punches.data, error: h.punches.error }; } },
      selfie: { useQuery: () => ({ data: { dataUrl: "data:image/png;base64,AAAA" }, isError: false }) },
      review: { useMutation: (o: { onSuccess?: (r: unknown) => void }) => ({ mutate: (v: unknown) => { h.review(v); o.onSuccess?.({ reviewStatus: (v as { decision: string }).decision === "approve" ? "approved" : "rejected", attendanceLocked: false }); }, isPending: false }) },
      settings: { useQuery: () => ({ data: h.settings.data }) },
      updateSettings: { useMutation: () => ({ mutate: h.save, isPending: false }) },
      locationList: { useQuery: () => ({ data: h.locations.data }) },
      locationCreate: { useMutation: (o: { onSuccess?: () => void }) => ({ mutate: (v: unknown) => { h.createLoc(v); o.onSuccess?.(); }, isPending: false }) },
      locationUpdate: { useMutation: (o: { onSuccess?: () => void }) => ({ mutate: (v: unknown) => { h.updateLoc(v); o.onSuccess?.(); }, isPending: false }) },
      locationDelete: { useMutation: (o: { onSuccess?: () => void }) => ({ mutate: (v: unknown) => { h.deleteLoc(v); o.onSuccess?.(); }, isPending: false }) },
      employeeLocations: { useQuery: () => ({ data: h.assigned }) },
      locationAssign: { useMutation: () => ({ mutate: h.assign, isPending: false }) },
      deviceKeyList: { useQuery: () => ({ data: h.keys.data }) },
      deviceKeyCreate: { useMutation: (o: { onSuccess?: (r: unknown) => void }) => ({ mutate: (v: unknown) => { h.createKey(v); o.onSuccess?.({ id: "k1", name: "Gate", key: "fdk_t_" + "ab".repeat(24) }); }, isPending: false }) },
      deviceKeyRevoke: { useMutation: () => ({ mutate: h.revokeKey, isPending: false }) },
    },
  },
}));
vi.mock("@/hooks/useToast", () => ({ toast: h.toast }));

import { PunchesTab } from "../PunchesTab";

const punch = (over: Record<string, unknown> = {}) => ({
  id: P1, employeeId: "e1", employeeName: "Asha Verma", employeeCode: "E001", kind: "in", time: "09:02", workDate: "2026-10-05", source: "mobile", deviceId: "phone-1",
  geofenceResult: "outside", geofenceLabel: "Outside the work location", distanceM: 450, locationName: "Head office", flags: ["outside_geofence"], reviewStatus: "pending", hasSelfie: true, ...over,
});

describe("PunchesTab", () => {
  beforeEach(() => {
    for (const f of [h.review, h.save, h.createLoc, h.updateLoc, h.deleteLoc, h.assign, h.createKey, h.revokeKey, h.invalidate, h.toast, h.punchesArgs]) f.mockReset();
    h.punches = { data: [punch()], error: null };
    h.settings = { data: { punchEnabled: true, geofencePolicy: "record", accuracyThresholdM: 100, selfieRequired: true, selfieRetentionDays: 90, lateGraceMinutes: 15, fullDayMinHours: null, halfDayMinHours: null, overtimeFromPunches: false } };
    h.locations = { data: [{ id: L1, name: "Head office", lat: 19.076, lng: 72.8777, radiusM: 100, isActive: true, assignedEmployees: 2 }] };
    h.keys = { data: [{ id: "k1", name: "Gate terminal", keyPrefix: "fdk_ab12cd34", lastUsedAt: null, revokedAt: null }] };
  });

  it("lists flagged punches with the place and distance, and approves or rejects", () => {
    render(<PunchesTab />);
    const row = screen.getByText("Asha Verma").closest("tr")!;
    expect(within(row).getAllByText("Outside the work location").length).toBeGreaterThan(0);
    expect(within(row).getByText(/about 450 m from Head office/)).toBeInTheDocument();
    expect(within(row).getByText("Pending")).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "Approve" }));
    expect(h.review).toHaveBeenLastCalledWith({ punchId: P1, decision: "approve" });
    fireEvent.click(within(row).getByRole("button", { name: "Reject" }));
    expect(h.review).toHaveBeenLastCalledWith({ punchId: P1, decision: "reject" });
    expect(h.punchesArgs).toHaveBeenCalledWith({ review: "pending", limit: 200 });
  });

  it("shows the photo only when asked, as an image with a description", () => {
    render(<PunchesTab />);
    expect(screen.queryByAltText("Employee check-in selfie")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Photo" }));
    expect(screen.getByAltText("Employee check-in selfie")).toHaveAttribute("src", "data:image/png;base64,AAAA");
  });

  it("tells a role that may not see locations and photos so, instead of an empty table", () => {
    h.punches = { data: [], error: { message: "Only HR, owners and admins can see attendance photos and locations." } };
    render(<PunchesTab />);
    expect(screen.getByRole("alert")).toHaveTextContent("Only HR, owners and admins");
  });

  it("saves the policy, checking the hours first", async () => {
    render(<PunchesTab />);
    fireEvent.click(screen.getByRole("button", { name: "Policy" }));
    await userEvent.click(screen.getByRole("combobox", { name: /Work location rule/ }));
    await userEvent.click(screen.getByRole("option", { name: /Block/ }));
    fireEvent.change(screen.getByLabelText(/Full day from/), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText(/Half day from/), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Save policy" }));
    // The schema accepts both; the server refuses half >= full. Fix the values and save.
    fireEvent.change(screen.getByLabelText(/Full day from/), { target: { value: "6" } });
    fireEvent.change(screen.getByLabelText(/Half day from/), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save policy" }));
    expect(h.save).toHaveBeenLastCalledWith(expect.objectContaining({ geofencePolicy: "block", fullDayMinHours: 6, halfDayMinHours: 3, selfieRetentionDays: 90, selfieRequired: true }));
    expect(screen.getByText(/can fake its location/i)).toBeInTheDocument();
  });

  it("rejects a retention outside 7 to 365 days", () => {
    render(<PunchesTab />);
    fireEvent.click(screen.getByRole("button", { name: "Policy" }));
    fireEvent.change(screen.getByLabelText(/Keep selfies for/), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save policy" }));
    expect(h.save).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("adds a work location after validating the coordinates and radius", () => {
    render(<PunchesTab />);
    fireEvent.click(screen.getByRole("button", { name: "Work locations" }));
    expect(screen.getByText("Head office")).toBeInTheDocument();
    expect(screen.getByText(/2 employee\(s\) assigned/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add location" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: "Warehouse" } });
    fireEvent.change(within(dialog).getByLabelText(/Latitude/), { target: { value: "120" } });
    fireEvent.change(within(dialog).getByLabelText(/Longitude/), { target: { value: "72.9" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(h.createLoc).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Latitude/), { target: { value: "19.1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(h.createLoc).toHaveBeenCalledWith({ name: "Warehouse", lat: 19.1, lng: 72.9, radiusM: 100 });
  });

  it("shows a new device key once and revokes one", () => {
    render(<PunchesTab />);
    fireEvent.click(screen.getByRole("button", { name: "Device keys" }));
    fireEvent.change(screen.getByLabelText(/Device or system name/), { target: { value: "Gate" } });
    fireEvent.click(screen.getByRole("button", { name: "Make a key" }));
    expect(h.createKey).toHaveBeenCalledWith({ name: "Gate" });
    expect(screen.getByLabelText("Device key")).toHaveValue("fdk_t_" + "ab".repeat(24));
    expect(screen.getByText(/shown only once/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(h.revokeKey).toHaveBeenCalledWith({ id: "k1" });
    // The list itself only ever shows the prefix.
    expect(screen.getByText("fdk_ab12cd34...")).toBeInTheDocument();
  });
});
