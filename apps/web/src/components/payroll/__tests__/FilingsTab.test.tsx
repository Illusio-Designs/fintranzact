import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const RUN_A = "77777777-7777-4777-8777-777777777777";
const RUN_B = "66666666-6666-4666-8666-666666666666";

const h = vi.hoisted(() => ({
  ecr: vi.fn(), esic: vi.fn(), pt: vi.fn(), q24: vi.fn(), f16pdf: vi.fn(), f16data: vi.fn(), register: vi.fn(),
  download: vi.fn(), downloadText: vi.fn(), toast: vi.fn(),
  runs: { data: [] as unknown[] },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      payrollStatutory: {
        ecrFile: { fetch: h.ecr },
        esicFile: { fetch: h.esic },
        ptSheets: { fetch: h.pt },
        lwfSheets: { fetch: vi.fn() },
        form24q: { fetch: h.q24 },
        form16Pdf: { fetch: h.f16pdf },
        form16Data: { fetch: h.f16data },
        register: { fetch: h.register },
      },
    }),
    payrollRun: { list: { useQuery: () => ({ data: h.runs.data }) } },
    payrollEmployee: { list: { useQuery: () => ({ data: { data: [{ id: "55555555-5555-4555-8555-555555555555", name: "Asha Verma", employeeCode: "E001" }] } }) } },
  },
}));
vi.mock("@/hooks/useToast", () => ({ toast: h.toast }));
vi.mock("../payroll-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../payroll-ui")>();
  return { ...actual, downloadBase64: h.download, downloadText: h.downloadText, currentMonth: () => "2026-10" };
});

import { FilingsTab } from "../FilingsTab";

/** The app's custom select: open it, then pick the option. */
function choose(name: RegExp | string, option: RegExp | string) {
  fireEvent.click(screen.getByRole("combobox", { name }));
  fireEvent.mouseDown(screen.getByRole("option", { name: option }));
}

const run = (id: string, month: string, flags: Record<string, unknown>) => ({ id, month, status: "approved", statutory: { financialYear: 2026, ratesSource: "saved", flags } });

describe("FilingsTab", () => {
  beforeEach(() => {
    for (const f of [h.ecr, h.esic, h.pt, h.q24, h.f16pdf, h.f16data, h.register, h.download, h.downloadText, h.toast]) f.mockReset();
    h.runs.data = [
      run(RUN_A, "2026-04", { pfRegistered: true, esiRegistered: true, ptStates: ["27"], lwfState: null, tdsEnabled: true }),
      run(RUN_B, "2026-03", { pfRegistered: false, esiRegistered: true, ptStates: [], lwfState: null, tdsEnabled: false }),
      { id: "draft", month: "2026-05", status: "calculated", statutory: null },
    ];
  });

  it("says nothing is filed and the layouts must be checked", () => {
    render(<FilingsTab />);
    expect(screen.getByTestId("verify-with-ca")).toHaveTextContent(/files nothing/);
  });

  it("offers a file only for the schemes the run was calculated with", () => {
    render(<FilingsTab />);
    expect(screen.getByRole("button", { name: "PF ECR file" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ESIC contribution file" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Professional tax sheets" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /labour welfare/i })).not.toBeInTheDocument();
    // Only approved runs are listed; the one without PF has no PF file.
    choose("Payroll run", "March 2026");
    expect(screen.queryByRole("button", { name: "PF ECR file" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ESIC contribution file" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("combobox", { name: "Payroll run" }));
    expect(screen.queryByRole("option", { name: /May 2026/ })).not.toBeInTheDocument(); // a run that is not approved has no files
  });

  it("downloads the ECR text and reports members left out", async () => {
    h.ecr.mockResolvedValue({ filename: "ECR-2026-04.txt", text: "1#~#A\n", note: "Check it against the EPFO portal.", skipped: [{ employeeCode: "E5", reason: "No UAN" }] });
    render(<FilingsTab />);
    fireEvent.click(screen.getByRole("button", { name: "PF ECR file" }));
    await waitFor(() => expect(h.downloadText).toHaveBeenCalledWith("ECR-2026-04.txt", "text/plain", "1#~#A\n"));
    expect(h.ecr).toHaveBeenCalledWith({ runId: RUN_A }, { staleTime: 0 });
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "PF ECR file ready", variant: "warning", description: expect.stringContaining("E5 (No UAN)") }));
  });

  it("shows a refusal as a message", async () => {
    h.esic.mockRejectedValue(new Error("This payroll run was calculated for a business with no ESI registration"));
    render(<FilingsTab />);
    fireEvent.click(screen.getByRole("button", { name: "ESIC contribution file" }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error", description: expect.stringContaining("no ESI registration") })));
  });

  it("downloads one professional tax sheet per state", async () => {
    h.pt.mockResolvedValue({ note: "n", sheets: [{ filename: "PT-27-2026-04.csv", text: "a" }, { filename: "PT-29-2026-04.csv", text: "b" }] });
    render(<FilingsTab />);
    fireEvent.click(screen.getByRole("button", { name: "Professional tax sheets" }));
    await waitFor(() => expect(h.downloadText).toHaveBeenCalledTimes(2));
  });

  it("downloads Form 24Q data for the quarter and a Form 16 working copy labelled for CA review", async () => {
    h.q24.mockResolvedValue({ deducteeFilename: "d.csv", deducteeCsv: "x", challanFilename: "c.csv", challanCsv: "y", note: "not an FVU file" });
    h.f16pdf.mockResolvedValue({ filename: "f16.pdf", contentType: "application/pdf", base64: "JVBERi0=", label: "Working copy for CA review." });
    render(<FilingsTab />);
    choose("Quarter", /Q3/);
    fireEvent.click(screen.getByRole("button", { name: "Form 24Q data" }));
    await waitFor(() => expect(h.downloadText).toHaveBeenCalledTimes(2));
    expect(h.q24).toHaveBeenCalledWith({ financialYear: 2026, quarter: 3 }, { staleTime: 0 });

    expect(screen.getByRole("button", { name: "Form 16 (PDF)" })).toBeDisabled();
    choose("Employee", /Asha Verma/);
    fireEvent.click(screen.getByRole("button", { name: "Form 16 (PDF)" }));
    await waitFor(() => expect(h.download).toHaveBeenCalledWith("f16.pdf", "application/pdf", "JVBERi0="));
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining("Working copy for CA review") }));
    expect(screen.getByText(/not generated by TRACES/)).toBeInTheDocument();
  });

  it("downloads the registers", async () => {
    h.register.mockResolvedValue({ filename: "wages-register-2026-10.csv", text: "csv" });
    render(<FilingsTab />);
    fireEvent.click(screen.getByRole("button", { name: "Wages register" }));
    await waitFor(() => expect(h.register).toHaveBeenCalledWith({ register: "wages", month: "2026-10" }, { staleTime: 0 }));
    fireEvent.click(screen.getByRole("button", { name: "Gratuity register" }));
    await waitFor(() => expect(h.register).toHaveBeenCalledWith({ register: "gratuity", financialYear: 2026 }, { staleTime: 0 }));
    expect(screen.getByText(/paid from the Bonus, Gratuity and Full and final tabs/)).toBeInTheDocument();
    expect(screen.getByText(/not statutory forms/)).toBeInTheDocument();
  });

  it("downloads the Phase 4 working registers", async () => {
    h.register.mockResolvedValue({ filename: "employment-register.csv", text: "csv", note: "Working copy for CA or legal review." });
    render(<FilingsTab />);
    for (const [name, register] of [["Register of employees (employment)", "employment"], ["Register of deductions, fines and advances", "deductions"], ["Register of overtime", "overtime"], ["Register of full and final settlements", "fnf"]] as const) {
      fireEvent.click(screen.getByRole("button", { name }));
      await waitFor(() => expect(h.register).toHaveBeenCalledWith({ register, financialYear: 2026 }, { staleTime: 0 }));
    }
    expect(h.downloadText).toHaveBeenCalledWith("employment-register.csv", "text/csv", "csv");
  });

  it("with no approved run says files need one", () => {
    h.runs.data = [];
    render(<FilingsTab />);
    expect(screen.getByText(/once a payroll run is approved/)).toBeInTheDocument();
  });
});
