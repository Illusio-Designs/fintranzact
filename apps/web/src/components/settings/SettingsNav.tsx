import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/Icon";
import {
  BarCode02Icon,
  Building03Icon,
  CashierIcon,
  CreditCardIcon,
  Database01Icon,
  DeliveryTruck01Icon,
  File01Icon,
  Notification01Icon,
  SquareLock02Icon,
  Store01Icon,
  Target02Icon,
  UserGroupIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";

interface SettingsTab {
  value: string;
  label: string;
  icon: React.ReactNode;
  /** Hidden for everyone except owner + superadmin (most restrictive). */
  ownerOnly?: boolean;
  /** Hidden for everyone except owner/admin (matches server `requireTenantAdmin`). */
  adminOnly?: boolean;
}

const SETTINGS_TABS: SettingsTab[] = [
  { value: "business", label: "Business", icon: <Icon icon={Building03Icon} size={18} /> },
  { value: "documents", label: "Documents", icon: <Icon icon={File01Icon} size={18} /> },
  { value: "reminders", label: "Payment reminders", icon: <Icon icon={Notification01Icon} size={18} />, adminOnly: true },
  { value: "shipping", label: "Shipping", icon: <Icon icon={DeliveryTruck01Icon} size={18} /> },
  { value: "team", label: "Team", icon: <Icon icon={UserGroupIcon} size={18} /> },
  { value: "targets", label: "Sales Targets", icon: <Icon icon={Target02Icon} size={18} /> },
  { value: "locks", label: "Period Locks", icon: <Icon icon={SquareLock02Icon} size={18} /> },
  { value: "data", label: "Data", icon: <Icon icon={Database01Icon} size={18} /> },
  { value: "account", label: "Account", icon: <Icon icon={UserIcon} size={18} /> },
  { value: "billing", label: "Billing", icon: <Icon icon={CreditCardIcon} size={18} />, ownerOnly: true },
  { value: "store", label: "Online Store", icon: <Icon icon={Store01Icon} size={18} /> },
  { value: "pos", label: "Point-of-Sale", icon: <Icon icon={CashierIcon} size={18} />, adminOnly: true },
  { value: "barcodes", label: "Barcodes", icon: <Icon icon={BarCode02Icon} size={18} />, adminOnly: true },
];

interface SettingsNavProps {
  value: string;
  onChange: (value: string) => void;
  role?: string | null;
}

export function SettingsNav({ value, onChange, role }: SettingsNavProps) {
  const isOwner = role === "owner" || role === "superadmin";
  // `admin` and `owner` both pass adminOnly. superadmin inherits admin privileges.
  const isAdmin = isOwner || role === "admin";
  const visibleTabs = SETTINGS_TABS.filter((tab) => {
    if (tab.ownerOnly && !isOwner) return false;
    if (tab.adminOnly && !isAdmin) return false;
    return true;
  });

  return (
    <>
      {/* Desktop: vertical sidebar — sticky */}
      <nav className="hidden md:block w-[220px] shrink-0 sticky top-0 self-start">
        <div className="space-y-0.5">
          {visibleTabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => onChange(tab.value)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-left",
                tab.value === value
                  ? "bg-surface-2 text-text-primary font-medium"
                  : "text-text-secondary hover:bg-surface-1 hover:text-text-primary"
              )}
            >
              <span className="w-[18px] h-[18px] shrink-0">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Mobile: horizontal scrollable tabs — sticky */}
      <div className="md:hidden flex gap-1 overflow-x-auto pb-4 -mx-1 px-1 sticky top-0 z-10 bg-surface-1">
        {visibleTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => onChange(tab.value)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors",
              tab.value === value
                ? "bg-brand-600/10 text-brand-700 dark:text-brand-400"
                : "text-text-tertiary hover:text-text-secondary hover:bg-surface-2"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </>
  );
}
