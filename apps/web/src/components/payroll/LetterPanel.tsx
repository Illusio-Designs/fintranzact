import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@fintranzact/api";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { InputField, TextareaField } from "@/components/ui/FormField";
import { Panel, TABLE, downloadBase64, errorMessage, onError } from "./payroll-ui";

/**
 * The relieving letter: the wording is yours (placeholders such as {{employee_name}} are filled in), the letter is a PDF
 * on your letterhead data (name, logo, and the signature image if you uploaded one). The signature line is left blank
 * for a person to sign: Fintranzact does not sign for anyone. Every letter generated is recorded in the audit log.
 */
export function LetterPanel() {
  const template = trpc.payrollLetter.template.useQuery({ kind: "relieving" });
  const exited = trpc.payrollEmployee.list.useQuery({ status: "exited", page: 1, limit: 200 });
  return (
    <Panel title="Relieving letters">
      <div className="space-y-5 p-4">
        {template.data ? <TemplateForm key={String(template.data.updatedAt ?? "default")} t={template.data} /> : <p className="text-sm text-text-tertiary">Loading the wording...</p>}
        <div>
          <h3 className="mb-2 text-sm font-medium text-text-primary">Employees who have left</h3>
          {exited.isLoading ? (
            <p className="text-sm text-text-tertiary">Loading...</p>
          ) : (exited.data?.data ?? []).length === 0 ? (
            <p className="text-sm text-text-tertiary">Nobody has left yet. A letter is available once an employee's exit is recorded.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className={TABLE} aria-label="Employees who have left">
                <thead><tr><th>Employee</th><th>Last working day</th><th className="text-right"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {(exited.data?.data ?? []).map((e) => <LetterRow key={e.id} id={e.id} name={e.name} code={e.employeeCode} lastWorkingDay={e.lastWorkingDay} />)}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

function LetterRow({ id, name, code, lastWorkingDay }: { id: string; name: string; code: string; lastWorkingDay: string | null }) {
  const make = trpc.payrollLetter.relievingPdf.useMutation({
    onSuccess: (r) => downloadBase64(r.filename, r.contentType, r.base64),
    onError: (e) => toast({ title: "Could not make the letter", description: errorMessage(e), variant: "error" }),
  });
  return (
    <tr>
      <td>{name} <span className="text-xs text-text-tertiary">{code}</span></td>
      <td className="whitespace-nowrap">{formatDate(lastWorkingDay)}</td>
      <td className="text-right"><button className="btn-secondary btn-sm" disabled={make.isPending} onClick={() => make.mutate({ employeeId: id, kind: "relieving" })}>Relieving letter</button></td>
    </tr>
  );
}

type Template = inferRouterOutputs<AppRouter>["payrollLetter"]["template"];

function TemplateForm({ t }: { t: Template }) {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState(t.title);
  const [body, setBody] = useState(t.body);
  const [signatoryName, setName] = useState(t.signatoryName ?? "");
  const [signatoryTitle, setTitleText] = useState(t.signatoryTitle ?? "");
  const [place, setPlace] = useState(t.place ?? "");
  const save = trpc.payrollLetter.saveTemplate.useMutation({
    onSuccess: () => {
      toast({ title: "Wording saved", variant: "success" });
      void utils.payrollLetter.template.invalidate();
    },
    onError: onError("Could not save the wording"),
  });
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-secondary">
        {t.isDefault ? "Using the standard wording. Edit it and save to make it yours." : "Your wording."} You can use: {t.placeholders.map((p) => `{{${p}}}`).join(", ")}.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <InputField label="Letter title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <InputField label="Place" value={place} onChange={(e) => setPlace(e.target.value)} />
      </div>
      <TextareaField label="Letter text" rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="grid gap-3 sm:grid-cols-2">
        <InputField label="Signatory name" value={signatoryName} onChange={(e) => setName(e.target.value)} />
        <InputField label="Signatory title" value={signatoryTitle} onChange={(e) => setTitleText(e.target.value)} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-text-tertiary">The letter has a blank signature line (or your uploaded signature image). It is not digitally signed.</p>
        <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate({ kind: "relieving", title, body, signatoryName, signatoryTitle, place })}>Save wording</button>
      </div>
    </div>
  );
}
