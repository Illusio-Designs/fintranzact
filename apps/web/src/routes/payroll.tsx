import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { PayrollPage, type PayrollTab } from "@/components/payroll/PayrollPage";

export const Route = createFileRoute("/payroll")({
  validateSearch: z.object({ tab: z.enum(["employees", "salary", "attendance", "leave", "punches", "import", "access", "runs", "bonus", "gratuity", "loans", "fnf", "statutory", "dues", "filings"]).optional().catch(undefined) }),
  component: PayrollRoute,
});

function PayrollRoute() {
  const navigate = useNavigate();
  const { tab = "employees" } = Route.useSearch();
  return <PayrollPage tab={tab} onTabChange={(t: PayrollTab) => void navigate({ to: "/payroll", search: { tab: t } })} />;
}
