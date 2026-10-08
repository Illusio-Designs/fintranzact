import { useState } from "react";
import { IMPORT_MAX_ROWS, guessImportMapping, parseDelimitedText, sheetToRows, type ImportMapping } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { InputField, SelectField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { CheckRow, Panel, TABLE, errorMessage, onError } from "./payroll-ui";

export const IMPORT_FILE_ACCEPT = ".csv,.txt,.dat,.xlsx";

/** The file's text; older browsers and test environments lack File.text(). */
function readText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

/** Read a device export into rows of cells. CSV, tab or pipe separated text and wide-spaced .txt/.dat files, or the first sheet of an .xlsx. */
export async function readImportFile(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xls")) throw new Error("Old Excel (.xls) files are not supported. Save the file as .xlsx or export it as CSV.");
  if (name.endsWith(".xlsx")) {
    const { readSheet } = await import("read-excel-file/browser");
    return sheetToRows(await readSheet(await file.arrayBuffer()));
  }
  return parseDelimitedText(await readText(file));
}

type Mapping = ImportMapping;

/** Import punches from a biometric device's export, with a column mapping and a preview, and the history with undo. */
export function ImportTab() {
  const utils = trpc.useUtils();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState<{ id: string; name: string } | null>(null);
  const preview = trpc.payrollImport.preview.useMutation({ onError: onError("Could not check the file") });
  const commit = trpc.payrollImport.commit.useMutation({
    onSuccess: (r) => {
      toast({ title: "Punches imported", description: `${r.summary.imported} new, ${r.summary.duplicates} already there.`, variant: "success" });
      void utils.payrollImport.history.invalidate();
      void utils.payrollAttendance.month.invalidate();
      preview.reset();
    },
    onError: onError("Could not import the file"),
  });
  const history = trpc.payrollImport.history.useQuery();
  const undo = trpc.payrollImport.undo.useMutation({
    onSuccess: (r) => {
      toast({ title: "Import undone", description: `${r.removed} punches removed.`, variant: "success" });
      setUndoing(null);
      void utils.payrollImport.history.invalidate();
      void utils.payrollAttendance.month.invalidate();
    },
    onError: (e) => {
      setUndoing(null);
      toast({ title: "Could not undo the import", description: errorMessage(e), variant: "error" });
    },
  });

  async function pick(file: File | undefined) {
    preview.reset();
    setReadError(null);
    if (!file) return;
    try {
      const data = await readImportFile(file);
      if (data.length === 0) throw new Error("The file has no rows.");
      if (data.length > IMPORT_MAX_ROWS + 1) throw new Error(`The file has more than ${IMPORT_MAX_ROWS.toLocaleString("en-IN")} rows. Split it by date range.`);
      setFileName(file.name);
      setRows(data);
      setMapping(guessImportMapping(data) ?? { employeeCode: 0, timestamp: 1, hasHeader: false, dateOrder: "dmy" });
    } catch (e) {
      setRows(null);
      setMapping(null);
      setReadError(errorMessage(e));
    }
  }

  const columns = rows ? Math.max(...rows.slice(0, 20).map((r) => r.length)) : 0;
  const colLabel = (i: number) => (mapping?.hasHeader && rows?.[0]?.[i] ? `${i + 1}: ${rows[0][i]}` : `Column ${i + 1}`);
  const colOptions = Array.from({ length: columns }, (_, i) => <option key={i} value={i}>{colLabel(i)}</option>);
  const set = (patch: Partial<Mapping>) => setMapping((m) => (m ? { ...m, ...patch } : m));
  const ready = !!rows && !!mapping && (mapping.timestamp !== undefined || (mapping.date !== undefined && mapping.time !== undefined));
  const num = (v: string): number | undefined => (v === "" ? undefined : Number(v));
  const p = preview.data;

  return (
    <div className="space-y-5">
      <Panel title="Import device attendance" actions={<span className="text-xs text-text-tertiary">CSV, tab or pipe separated .txt/.dat, or .xlsx from your biometric device or its software</span>}>
        <div className="space-y-4 p-4">
          <div>
            <label className="label" htmlFor="import-file">File</label>
            <input id="import-file" type="file" accept={IMPORT_FILE_ACCEPT} onChange={(e) => void pick(e.target.files?.[0])} className="block text-sm" />
            {readError && <p role="alert" className="mt-2 text-sm text-red-600">{readError}</p>}
          </div>
          {rows && mapping && (
            <>
              <p className="text-sm text-text-secondary">{fileName}: {rows.length.toLocaleString("en-IN")} rows. Check which column holds what.</p>
              <CheckRow label="The first row is a header" checked={mapping.hasHeader} onChange={(v) => set({ hasHeader: v })} />
              <div className="grid gap-3 sm:grid-cols-3">
                <SelectField label="Employee code" required value={mapping.employeeCode} onChange={(e) => set({ employeeCode: Number(e.target.value) })}>{colOptions}</SelectField>
                <SelectField label="Date and time together" value={mapping.timestamp ?? ""} onChange={(e) => set({ timestamp: num(e.target.value), ...(e.target.value !== "" ? { date: undefined, time: undefined } : {}) })}>
                  <option value="">Separate columns</option>{colOptions}
                </SelectField>
                <SelectField label="Date order" value={mapping.dateOrder} onChange={(e) => set({ dateOrder: e.target.value as Mapping["dateOrder"] })}>
                  <option value="dmy">Day, month, year</option><option value="mdy">Month, day, year</option><option value="ymd">Year, month, day</option>
                </SelectField>
                {mapping.timestamp === undefined && (
                  <>
                    <SelectField label="Date column" value={mapping.date ?? ""} onChange={(e) => set({ date: num(e.target.value) })}><option value="">Choose...</option>{colOptions}</SelectField>
                    <SelectField label="Time column" value={mapping.time ?? ""} onChange={(e) => set({ time: num(e.target.value) })}><option value="">Choose...</option>{colOptions}</SelectField>
                  </>
                )}
                <SelectField label="In / Out column" value={mapping.direction ?? ""} onChange={(e) => set({ direction: num(e.target.value) })}><option value="">None: alternate in and out</option>{colOptions}</SelectField>
                <SelectField label="Device column" value={mapping.deviceId ?? ""} onChange={(e) => set({ deviceId: num(e.target.value) })}><option value="">None</option>{colOptions}</SelectField>
                <InputField label="Device name when there is no column" value={mapping.defaultDeviceId ?? ""} onChange={(e) => set({ defaultDeviceId: e.target.value || undefined })} />
              </div>
              <p className="text-xs text-text-tertiary">Times without a time zone are read as Indian time. A punch already imported (same employee, time and device) is skipped, so importing a file twice is safe.</p>
              <div className="flex gap-2">
                <button className="btn-secondary" disabled={!ready || preview.isPending} onClick={() => preview.mutate({ rows: rows!, mapping: mapping!, fileName })}>Check the file</button>
                <button className="btn-primary" disabled={!ready || !p || p.summary.imported === 0 || commit.isPending} onClick={() => commit.mutate({ rows: rows!, mapping: mapping!, fileName })}>Import</button>
              </div>
            </>
          )}
          {p && (
            <div className="space-y-3 rounded-lg border border-border-light p-3 text-sm" data-testid="import-preview">
              <p className="font-medium text-text-primary">
                {p.summary.imported} new punches, {p.summary.duplicates} already imported, {p.summary.unknownEmployees} for unknown employees, {p.summary.invalid} rows could not be read.
              </p>
              {p.fromDate && <p className="text-text-secondary">Days from {formatDate(p.fromDate)} to {formatDate(p.toDate)}.</p>}
              {p.unknown.length > 0 && (
                <div>
                  <p className="font-medium text-text-primary">Employee codes not found</p>
                  <p className="text-text-secondary">{p.unknown.map((u) => `${u.code} (row ${u.rows.slice(0, 3).join(", ")}${u.rows.length > 3 ? "..." : ""})`).join("; ")}. Add the employee with that code, or fix the code on the device.</p>
                </div>
              )}
              {p.errors.length > 0 && (
                <div>
                  <p className="font-medium text-text-primary">Rows that could not be read</p>
                  <ul className="list-disc pl-5 text-text-secondary">{p.errors.slice(0, 8).map((e) => <li key={e.row}>Row {e.row}: {e.reason}</li>)}</ul>
                </div>
              )}
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Import history">
        {(history.data ?? []).length === 0 ? (
          <EmptyState title="No imports yet" description="Files you import and punches pushed by a device show up here, and an import can be undone." />
        ) : (
          <div className="overflow-x-auto">
            <table className={TABLE}>
              <thead><tr><th>When</th><th>From</th><th>Days</th><th className="text-right">Punches</th><th>Status</th><th className="text-right"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {(history.data ?? []).map((h) => (
                  <tr key={h.id}>
                    <td className="whitespace-nowrap text-text-secondary">{formatDate(h.createdAt)}</td>
                    <td className="text-text-secondary">{h.source === "device" ? "Device push" : h.fileName ?? "File"}</td>
                    <td className="whitespace-nowrap text-text-secondary">{h.fromDate ? (h.fromDate === h.toDate ? formatDate(h.fromDate) : `${formatDate(h.fromDate)} to ${formatDate(h.toDate)}`) : ""}</td>
                    <td className="text-right tabular-nums">{h.totals.imported ?? 0}{(h.totals.duplicates ?? 0) > 0 && <span className="block text-xs text-text-tertiary">{h.totals.duplicates} skipped</span>}</td>
                    <td><Badge color={h.status === "applied" ? "bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400" : "bg-surface-2 text-text-secondary"}>{h.status === "applied" ? "Applied" : "Undone"}</Badge></td>
                    <td className="text-right">{h.status === "applied" && <button className="btn-secondary btn-sm" onClick={() => setUndoing({ id: h.id, name: h.fileName ?? "this import" })}>Undo</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <ConfirmDialog
        open={!!undoing}
        title="Undo this import?"
        description={undoing ? `The punches from ${undoing.name} are deleted and the days they touched are recalculated. Days you marked by hand are not changed. To replace a file, undo it and import the corrected one.` : ""}
        confirmLabel="Undo import"
        variant="danger"
        onConfirm={() => undoing && undo.mutate({ batchId: undoing.id })}
        onCancel={() => setUndoing(null)}
      />
    </div>
  );
}
