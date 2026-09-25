import { useNavigate } from "@tanstack/react-router";
import { Modal } from "@/components/ui/Modal";

function PlanIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M4 7h16M7 12h10M9 17h6" />
      <path d="M5 4h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z" />
    </svg>
  );
}

interface WhatsNextModalProps {
  open: boolean;
  businessName: string;
  onImport: () => void;
}

export function WhatsNextModal({ open, businessName, onImport: _onImport }: WhatsNextModalProps) {
  const navigate = useNavigate();

  return (
    <Modal open={open} onClose={() => { }} className="max-w-md">
      <div className="text-center mb-6">
        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
          <svg className="w-6 h-6 text-emerald-600" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-text-primary">Your business is ready!</h2>
        <p className="text-sm text-text-tertiary mt-1">
          <span className="font-medium text-text-secondary">{businessName}</span> has been set up. Choose the plan before entering the dashboard.
        </p>
      </div>

      <button
        type="button"
        onClick={() => navigate({ to: "/auth/plan-selection" })}
        className="w-full flex items-start gap-3 px-4 py-3 rounded-xl border border-brand-400 bg-brand-600/[0.03] hover:border-brand-500 hover:bg-brand-600/[0.05] transition-colors text-left group"
      >
        <span className="w-9 h-9 shrink-0 rounded-lg bg-brand-600/10 group-hover:bg-brand-600/15 flex items-center justify-center text-brand-600">
          <PlanIcon />
        </span>
        <div>
          <p className="text-sm font-medium text-text-primary">Choose a plan</p>
          <p className="text-xs text-text-tertiary mt-0.5">Select the plan that fits your business before continuing.</p>
        </div>
      </button>

      <div className="mt-4 text-xs text-text-tertiary text-center">
        Other sections stay locked until you complete plan selection.
      </div>
    </Modal>
  );
}
