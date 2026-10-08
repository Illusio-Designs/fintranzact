import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const B1 = "33333333-3333-4333-8333-333333333333";

const h = vi.hoisted(() => ({
  preview: vi.fn(),
  commit: vi.fn(),
  undo: vi.fn(),
  previewData: { current: undefined as unknown },
  history: { data: [] as unknown[] },
  invalidate: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ payrollImport: { history: { invalidate: h.invalidate } }, payrollAttendance: { month: { invalidate: h.invalidate } } }),
    payrollImport: {
      preview: { useMutation: () => ({ mutate: h.preview, isPending: false, data: h.previewData.current, reset: () => undefined }) },
      commit: { useMutation: () => ({ mutate: h.commit, isPending: false }) },
      history: { useQuery: () => ({ data: h.history.data }) },
      undo: { useMutation: () => ({ mutate: h.undo, isPending: false }) },
    },
  },
}));
vi.mock("@/hooks/useToast", () => ({ toast: h.toast }));

import { ImportTab, readImportFile } from "../ImportTab";

const csv = (text: string, name = "punches.csv") => new File([text], name, { type: "text/csv" });
const CSV = "Employee Code,Date,Time,In/Out,Device\nE001,05/10/2026,09:01:10,IN,gate-1\nE001,05/10/2026,18:02:00,OUT,gate-1\nE999,05/10/2026,09:00:00,IN,gate-1\n";

describe("readImportFile", () => {
  it("reads comma, tab and wide-spaced exports into rows", async () => {
    expect(await readImportFile(csv(CSV))).toHaveLength(4);
    expect(await readImportFile(csv("7\t2026-10-05 09:00:00\t0\n7\t2026-10-05 18:00:00\t1\n", "log.txt"))).toEqual([["7", "2026-10-05 09:00:00", "0"], ["7", "2026-10-05 18:00:00", "1"]]);
    expect(await readImportFile(csv("7    2026-10-05 09:00:00    1\n", "att.dat"))).toEqual([["7", "2026-10-05 09:00:00", "1"]]);
  });
  it("refuses an old .xls file with a clear message", async () => {
    await expect(readImportFile(csv("x", "old.xls"))).rejects.toThrow(/\.xls/);
  });
});

describe("ImportTab", () => {
  beforeEach(() => {
    for (const f of [h.preview, h.commit, h.undo, h.invalidate, h.toast]) f.mockReset();
    h.previewData.current = undefined;
    h.history.data = [];
  });

  async function pickFile(text = CSV) {
    const input = screen.getByLabelText("File") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [csv(text)] } });
    await screen.findByText(/Check which column holds what/);
  }

  it("guesses the mapping from the header and sends it with the rows for a preview", async () => {
    render(<ImportTab />);
    await pickFile();
    fireEvent.click(screen.getByRole("button", { name: "Check the file" }));
    expect(h.preview).toHaveBeenCalledTimes(1);
    const arg = h.preview.mock.calls[0]![0] as { rows: string[][]; mapping: Record<string, unknown>; fileName: string };
    expect(arg.rows).toHaveLength(4);
    expect(arg.mapping).toMatchObject({ employeeCode: 0, date: 1, time: 2, direction: 3, deviceId: 4, hasHeader: true, dateOrder: "dmy" });
    expect(arg.fileName).toBe("punches.csv");
  });

  it("keeps Import off until a preview shows something to import, then imports the same file", async () => {
    h.previewData.current = {
      summary: { rows: 3, imported: 2, duplicates: 0, unknownEmployees: 1, invalid: 0 }, unknown: [{ code: "E999", rows: [4] }], errors: [], sample: [], fromDate: "2026-10-05", toDate: "2026-10-05", batchId: null, lockedDates: [], totalRows: 3,
    };
    render(<ImportTab />);
    await pickFile();
    expect(screen.getByTestId("import-preview")).toHaveTextContent("2 new punches");
    expect(screen.getByTestId("import-preview")).toHaveTextContent("1 for unknown employees");
    expect(screen.getByText(/E999 \(row 4\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(h.commit).toHaveBeenCalledWith(expect.objectContaining({ fileName: "punches.csv", mapping: expect.objectContaining({ employeeCode: 0 }) }));
  });

  it("disables Import when nothing new would be imported", async () => {
    h.previewData.current = { summary: { rows: 3, imported: 0, duplicates: 3, unknownEmployees: 0, invalid: 0 }, unknown: [], errors: [], sample: [], fromDate: null, toDate: null, batchId: null, lockedDates: [], totalRows: 3 };
    render(<ImportTab />);
    await pickFile();
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  });

  it("lists unreadable rows with their reasons", async () => {
    h.previewData.current = { summary: { rows: 3, imported: 1, duplicates: 0, unknownEmployees: 0, invalid: 2 }, unknown: [], errors: [{ row: 5, reason: 'Date and time "garbage" could not be read.' }], sample: [], fromDate: "2026-10-05", toDate: "2026-10-05", batchId: null, lockedDates: [], totalRows: 3 };
    render(<ImportTab />);
    await pickFile();
    expect(screen.getByText(/Row 5: Date and time "garbage" could not be read/)).toBeInTheDocument();
  });

  it("shows a file that cannot be read", async () => {
    render(<ImportTab />);
    fireEvent.change(screen.getByLabelText("File"), { target: { files: [csv("x", "old.xls")] } });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/\.xls/));
  });

  it("shows the history and undoes an import after confirming", () => {
    h.history.data = [{ id: B1, source: "file", fileName: "october.csv", status: "applied", fromDate: "2026-10-01", toDate: "2026-10-31", createdAt: new Date("2026-11-01"), totals: { imported: 120, duplicates: 4 } }];
    render(<ImportTab />);
    expect(screen.getByText("october.csv")).toBeInTheDocument();
    expect(screen.getByText("4 skipped")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(h.undo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Undo import" }));
    expect(h.undo).toHaveBeenCalledWith({ batchId: B1 });
  });
});
