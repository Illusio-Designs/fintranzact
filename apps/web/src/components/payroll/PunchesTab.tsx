import { useEffect, useState } from "react";
import {
  GEOFENCE_POLICIES,
  GEOFENCE_POLICY_LABELS,
  MAX_SELFIE_RETENTION_DAYS,
  MIN_SELFIE_RETENTION_DAYS,
  SELF_ATTENDANCE_FLAG_LABELS,
  attendanceSettingsSchema,
  workLocationSchema,
  type GeofencePolicy,
} from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { InputField, SelectField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
import { PillTabs } from "@/components/ui/Tabs";
import { Badge } from "@/components/ui/Badge";
import { CheckRow, Panel, TABLE, onError } from "./payroll-ui";

type View = "review" | "settings" | "locations" | "devices";

/** Check-ins from the employee app and devices: review flagged punches; the policy, work locations and device keys. */
export function PunchesTab() {
  const [view, setView] = useState<View>("review");
  return (
    <div className="space-y-4">
      <PillTabs
        value={view}
        onChange={(v) => setView(v as View)}
        tabs={[{ value: "review", label: "Review" }, { value: "settings", label: "Policy" }, { value: "locations", label: "Work locations" }, { value: "devices", label: "Device keys" }]}
      />
      {view === "review" && <Review />}
      {view === "settings" && <Settings />}
      {view === "locations" && <Locations />}
      {view === "devices" && <Devices />}
    </div>
  );
}

const REVIEW_COLOR: Record<string, string> = {
  pending: "bg-amber-600/[0.1] text-amber-700 dark:text-amber-400",
  approved: "bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400",
  rejected: "bg-red-600/[0.08] text-red-700 dark:text-red-400",
};

function Review() {
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<"pending" | "flagged" | "all">("pending");
  const list = trpc.payrollPunch.punches.useQuery({ review: filter, limit: 200 });
  const [photo, setPhoto] = useState<string | null>(null);
  const selfie = trpc.payrollPunch.selfie.useQuery({ punchId: photo ?? "" }, { enabled: !!photo, retry: false });
  const review = trpc.payrollPunch.review.useMutation({
    onSuccess: (r) => {
      toast({ title: r.reviewStatus === "approved" ? "Punch approved" : "Punch rejected", description: r.attendanceLocked ? "The month is locked by its payroll run, so attendance was not changed." : undefined, variant: "success" });
      void utils.payrollPunch.punches.invalidate();
      void utils.payrollAttendance.month.invalidate();
    },
    onError: onError("Could not save the decision"),
  });
  if (list.error) {
    return <p role="alert" className="rounded-lg border border-border-light px-4 py-3 text-sm text-text-secondary">Only HR, owners and admins can see check-in locations and photos.</p>;
  }
  const rows = list.data ?? [];
  return (
    <Panel
      title="Check-ins"
      actions={<PillTabs size="sm" value={filter} onChange={(v) => setFilter(v as typeof filter)} tabs={[{ value: "pending", label: "To review" }, { value: "flagged", label: "Flagged" }, { value: "all", label: "All" }]} />}
    >
      {rows.length === 0 ? (
        <EmptyState title="Nothing here" description={filter === "pending" ? "Punches outside the work location, without a location or with a poor one wait here for your decision." : "No check-ins in this view yet."} />
      ) : (
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead><tr><th>Employee</th><th>When</th><th>Where</th><th>Flags</th><th>Review</th><th className="text-right"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium text-text-primary">{p.employeeName} <span className="text-xs font-normal text-text-tertiary">{p.employeeCode}</span></td>
                  <td className="whitespace-nowrap text-text-secondary">{formatDate(p.workDate)} {p.kind === "in" ? "In" : "Out"} {p.time}<span className="block text-xs text-text-tertiary">{p.source}{p.deviceId ? `, ${p.deviceId}` : ""}</span></td>
                  <td className="text-text-secondary">
                    {p.geofenceLabel}
                    {p.distanceM != null && p.geofenceResult !== "inside" && <span className="block text-xs text-text-tertiary">about {p.distanceM} m from {p.locationName ?? "the nearest location"}</span>}
                  </td>
                  <td className="text-xs text-text-secondary">{p.flags.map((f) => SELF_ATTENDANCE_FLAG_LABELS[f] ?? f).join(", ")}</td>
                  <td>{p.reviewStatus ? <Badge color={REVIEW_COLOR[p.reviewStatus]}>{p.reviewStatus[0]!.toUpperCase() + p.reviewStatus.slice(1)}</Badge> : <span className="text-xs text-text-tertiary">None needed</span>}</td>
                  <td className="whitespace-nowrap text-right">
                    {p.hasSelfie && <button className="btn-secondary btn-sm mr-2" onClick={() => setPhoto(p.id)}>Photo</button>}
                    {p.reviewStatus && (
                      <>
                        <button className="btn-primary btn-sm mr-2" onClick={() => review.mutate({ punchId: p.id, decision: "approve" })} disabled={review.isPending || p.reviewStatus === "approved"}>Approve</button>
                        <button className="btn-secondary btn-sm" onClick={() => review.mutate({ punchId: p.id, decision: "reject" })} disabled={review.isPending || p.reviewStatus === "rejected"}>Reject</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!photo} onClose={() => setPhoto(null)} title="Check-in photo" className="max-w-sm">
        {selfie.data ? <img src={selfie.data.dataUrl} alt="Employee check-in selfie" className="w-full rounded-lg" /> : <p className="text-sm text-text-secondary">{selfie.isError ? "This photo was deleted after the retention period." : "Loading..."}</p>}
      </Modal>
    </Panel>
  );
}

function Settings() {
  const utils = trpc.useUtils();
  const q = trpc.payrollPunch.settings.useQuery();
  const [f, setF] = useState<null | {
    punchEnabled: boolean; geofencePolicy: GeofencePolicy; accuracyThresholdM: string; selfieRequired: boolean; selfieRetentionDays: string;
    lateGraceMinutes: string; fullDayMinHours: string; halfDayMinHours: string; overtimeFromPunches: boolean;
  }>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const s = q.data;
    if (s && !f) {
      setF({
        punchEnabled: s.punchEnabled, geofencePolicy: s.geofencePolicy, accuracyThresholdM: String(s.accuracyThresholdM), selfieRequired: s.selfieRequired,
        selfieRetentionDays: String(s.selfieRetentionDays), lateGraceMinutes: String(s.lateGraceMinutes),
        fullDayMinHours: s.fullDayMinHours == null ? "" : String(s.fullDayMinHours), halfDayMinHours: s.halfDayMinHours == null ? "" : String(s.halfDayMinHours),
        overtimeFromPunches: s.overtimeFromPunches,
      });
    }
  }, [q.data, f]);
  const save = trpc.payrollPunch.updateSettings.useMutation({
    onSuccess: (r) => {
      toast({ title: "Check-in policy saved", description: r.purged ? `${r.purged} photo(s) older than the retention period were deleted.` : undefined, variant: "success" });
      void utils.payrollPunch.settings.invalidate();
    },
    onError: onError("Could not save the policy"),
  });
  if (!f) return <p className="text-sm text-text-tertiary">Loading...</p>;
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });
  function submit() {
    if (!f) return;
    const parsed = attendanceSettingsSchema.safeParse({
      punchEnabled: f.punchEnabled, geofencePolicy: f.geofencePolicy, accuracyThresholdM: Number(f.accuracyThresholdM), selfieRequired: f.selfieRequired,
      selfieRetentionDays: Number(f.selfieRetentionDays), lateGraceMinutes: Number(f.lateGraceMinutes),
      fullDayMinHours: f.fullDayMinHours === "" ? null : Number(f.fullDayMinHours), halfDayMinHours: f.halfDayMinHours === "" ? null : Number(f.halfDayMinHours),
      overtimeFromPunches: f.overtimeFromPunches,
    });
    if (!parsed.success) return setError(parsed.error.issues[0]!.message);
    setError(null);
    save.mutate(parsed.data);
  }
  return (
    <Panel title="Check-in policy">
      <div className="space-y-4 p-4">
        <CheckRow label="Employees can check in and out from the app" checked={f.punchEnabled} onChange={(v) => set("punchEnabled", v)} />
        <SelectField label="Work location rule" value={f.geofencePolicy} onChange={(e) => set("geofencePolicy", e.target.value as GeofencePolicy)}>
          {GEOFENCE_POLICIES.map((p) => <option key={p} value={p}>{GEOFENCE_POLICY_LABELS[p]}</option>)}
        </SelectField>
        <p className="text-xs text-text-tertiary">A phone can fake its location, and the server cannot tell. Use the review list and the selfie together, and treat the location as one signal.</p>
        <InputField label="Location accuracy needed (metres)" type="number" min={10} max={1000} value={f.accuracyThresholdM} onChange={(e) => set("accuracyThresholdM", e.target.value)} />
        <CheckRow label="Require a selfie" checked={f.selfieRequired} onChange={(v) => set("selfieRequired", v)} />
        <InputField label={`Keep selfies for (days, ${MIN_SELFIE_RETENTION_DAYS} to ${MAX_SELFIE_RETENTION_DAYS})`} type="number" value={f.selfieRetentionDays} onChange={(e) => set("selfieRetentionDays", e.target.value)} />
        <p className="text-xs text-text-tertiary">After this the photo is deleted and the punch (time and place result) stays as the attendance record.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <InputField label="Late after (minutes of grace)" type="number" value={f.lateGraceMinutes} onChange={(e) => set("lateGraceMinutes", e.target.value)} />
          <InputField label="Full day from (hours)" type="number" step="0.25" placeholder="75% of shift" value={f.fullDayMinHours} onChange={(e) => set("fullDayMinHours", e.target.value)} />
          <InputField label="Half day from (hours)" type="number" step="0.25" placeholder="50% of shift" value={f.halfDayMinHours} onChange={(e) => set("halfDayMinHours", e.target.value)} />
        </div>
        <CheckRow label="Count time beyond the shift as overtime" hint="Off by default: overtime is paid at the configured rate, so turn this on only if you want it from punches." checked={f.overtimeFromPunches} onChange={(v) => set("overtimeFromPunches", v)} />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end"><button className="btn-primary" onClick={submit} disabled={save.isPending}>Save policy</button></div>
      </div>
    </Panel>
  );
}

function Locations() {
  const utils = trpc.useUtils();
  const list = trpc.payrollPunch.locationList.useQuery();
  const [editing, setEditing] = useState<{ id?: string; name: string; lat: string; lng: string; radiusM: string } | null>(null);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const refresh = () => void utils.payrollPunch.locationList.invalidate();
  const del = trpc.payrollPunch.locationDelete.useMutation({ onSuccess: () => { setRemoving(null); refresh(); }, onError: onError("Could not delete the location") });
  const toggle = trpc.payrollPunch.locationUpdate.useMutation({ onSuccess: refresh, onError: onError("Could not change the location") });
  const rows = list.data ?? [];
  return (
    <Panel title="Work locations" actions={<button className="btn-primary btn-sm" onClick={() => setEditing({ name: "", lat: "", lng: "", radiusM: "100" })}>Add location</button>}>
      {rows.length === 0 ? (
        <EmptyState title="No work locations" description="Add your office, shop or site with its coordinates and a radius. Without one, the location is recorded but never checked." />
      ) : (
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead><tr><th>Name</th><th>Position</th><th className="text-right">Radius</th><th>Status</th><th className="text-right"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td className="font-medium text-text-primary">{l.name}{l.assignedEmployees > 0 && <span className="block text-xs font-normal text-text-tertiary">{l.assignedEmployees} employee(s) assigned</span>}</td>
                  <td className="tabular-nums text-text-secondary">{l.lat.toFixed(5)}, {l.lng.toFixed(5)}</td>
                  <td className="text-right tabular-nums">{l.radiusM} m</td>
                  <td>{l.isActive ? "In use" : "Off"}</td>
                  <td className="whitespace-nowrap text-right">
                    <button className="btn-secondary btn-sm mr-2" onClick={() => setEditing({ id: l.id, name: l.name, lat: String(l.lat), lng: String(l.lng), radiusM: String(l.radiusM) })}>Edit</button>
                    <button className="btn-secondary btn-sm mr-2" onClick={() => toggle.mutate({ id: l.id, isActive: !l.isActive })}>{l.isActive ? "Turn off" : "Turn on"}</button>
                    <button className="btn-secondary btn-sm" onClick={() => setRemoving({ id: l.id, name: l.name })}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="px-4 pb-3 text-xs text-text-tertiary">Everyone may punch at any active location unless you assign locations to an employee. To find coordinates, open the place in a map app, press and hold, and copy the numbers.</p>
      {rows.length > 0 && <AssignLocations locations={rows} onSaved={refresh} />}
      {editing && <LocationDialog value={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      <ConfirmDialog open={!!removing} title="Delete this location?" description={removing ? `${removing.name} will no longer be used to check punches. Past punches are not changed.` : ""} confirmLabel="Delete" variant="danger" onConfirm={() => removing && del.mutate({ id: removing.id })} onCancel={() => setRemoving(null)} />
    </Panel>
  );
}

function AssignLocations({ locations, onSaved }: { locations: Array<{ id: string; name: string }>; onSaved: () => void }) {
  const emps = trpc.payrollEmployee.list.useQuery({ status: "active", page: 1, limit: 200 });
  const [employeeId, setEmployeeId] = useState("");
  const current = trpc.payrollPunch.employeeLocations.useQuery({ employeeId }, { enabled: !!employeeId });
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => setPicked(current.data ?? []), [current.data]);
  const assign = trpc.payrollPunch.locationAssign.useMutation({
    onSuccess: () => {
      toast({ title: "Locations saved", variant: "success" });
      onSaved();
    },
    onError: onError("Could not save the locations"),
  });
  return (
    <div className="border-t border-border-light p-4">
      <h3 className="text-sm font-semibold text-text-primary">Who may punch where</h3>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <SelectField label="Employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">Choose...</option>
          {(emps.data?.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.name} ({e.employeeCode})</option>)}
        </SelectField>
        {employeeId && (
          <div className="space-y-1.5 pt-6">
            {locations.map((l) => (
              <CheckRow key={l.id} label={l.name} checked={picked.includes(l.id)} onChange={(v) => setPicked(v ? [...picked, l.id] : picked.filter((x) => x !== l.id))} />
            ))}
            <p className="text-xs text-text-tertiary">With none ticked, the employee may punch at any active location.</p>
            <button className="btn-primary btn-sm" onClick={() => assign.mutate({ employeeId, locationIds: picked })} disabled={assign.isPending}>Save</button>
          </div>
        )}
      </div>
    </div>
  );
}

function LocationDialog({ value, onClose, onSaved }: { value: { id?: string; name: string; lat: string; lng: string; radiusM: string }; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const done = { onSuccess: () => { toast({ title: "Location saved", variant: "success" }); onSaved(); onClose(); }, onError: (e: unknown) => setError((e as { message?: string }).message ?? "Could not save.") };
  const create = trpc.payrollPunch.locationCreate.useMutation(done);
  const update = trpc.payrollPunch.locationUpdate.useMutation(done);
  function save() {
    const parsed = workLocationSchema.safeParse({ name: v.name, lat: Number(v.lat), lng: Number(v.lng), radiusM: Number(v.radiusM) });
    if (!parsed.success || v.lat === "" || v.lng === "") return setError(parsed.success ? "Enter the latitude and longitude." : parsed.error.issues[0]!.message);
    setError(null);
    if (v.id) update.mutate({ id: v.id, ...parsed.data });
    else create.mutate(parsed.data);
  }
  return (
    <Modal open onClose={onClose} title={v.id ? "Edit location" : "Add location"} className="max-w-md">
      <div className="space-y-3">
        <InputField label="Name" required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        <div className="grid gap-3 sm:grid-cols-2">
          <InputField label="Latitude" required inputMode="decimal" value={v.lat} onChange={(e) => setV({ ...v, lat: e.target.value })} />
          <InputField label="Longitude" required inputMode="decimal" value={v.lng} onChange={(e) => setV({ ...v, lng: e.target.value })} />
        </div>
        <InputField label="Radius (metres)" required type="number" value={v.radiusM} onChange={(e) => setV({ ...v, radiusM: e.target.value })} />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={create.isPending || update.isPending}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

function Devices() {
  const utils = trpc.useUtils();
  const list = trpc.payrollPunch.deviceKeyList.useQuery();
  const [name, setName] = useState("");
  const [made, setMade] = useState<string | null>(null);
  const refresh = () => void utils.payrollPunch.deviceKeyList.invalidate();
  const create = trpc.payrollPunch.deviceKeyCreate.useMutation({
    onSuccess: (r) => {
      setMade(r.key);
      setName("");
      refresh();
    },
    onError: onError("Could not make the key"),
  });
  const revoke = trpc.payrollPunch.deviceKeyRevoke.useMutation({ onSuccess: refresh, onError: onError("Could not revoke the key") });
  const rows = list.data ?? [];
  return (
    <Panel title="Device keys" actions={<span className="text-xs text-text-tertiary">For biometric middleware that pushes punches to Fintranzact</span>}>
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[14rem] flex-1"><InputField label="Device or system name" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <button className="btn-primary" onClick={() => create.mutate({ name })} disabled={!name.trim() || create.isPending}>Make a key</button>
        </div>
        {made && (
          <div role="status" className="rounded-lg border border-amber-600/30 bg-amber-600/[0.06] p-3 text-sm">
            <p className="font-medium text-text-primary">Copy this key now. It is shown only once.</p>
            <input readOnly className="input mt-2 w-full font-mono text-xs" value={made} aria-label="Device key" onFocus={(e) => e.currentTarget.select()} />
            <p className="mt-2 text-xs text-text-tertiary">Send punches as JSON to POST /api/attendance/push with the header Authorization: Bearer (the key). At most 500 punches a request; sending the same punch again is harmless.</p>
          </div>
        )}
        {rows.length === 0 ? (
          <p className="text-sm text-text-secondary">No device keys yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className={TABLE}>
              <thead><tr><th>Name</th><th>Key</th><th>Last used</th><th className="text-right"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((k) => (
                  <tr key={k.id}>
                    <td className="font-medium text-text-primary">{k.name}</td>
                    <td className="font-mono text-xs text-text-secondary">{k.keyPrefix}...</td>
                    <td className="text-text-secondary">{k.revokedAt ? "Revoked" : k.lastUsedAt ? formatDate(k.lastUsedAt) : "Never"}</td>
                    <td className="text-right">{!k.revokedAt && <button className="btn-secondary btn-sm" onClick={() => revoke.mutate({ id: k.id })}>Revoke</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Panel>
  );
}
