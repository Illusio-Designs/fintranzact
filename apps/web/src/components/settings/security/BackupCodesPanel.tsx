import { useState } from "react";
import { Alert02Icon, Copy01Icon, Download01Icon, PrinterIcon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/Icon";
import { toast } from "@/hooks/useToast";
import { BACKUP_CODES_FILENAME, backupCodesFileContent, downloadTextFile, printBackupCodes } from "@/lib/two-factor";

/**
 * Backup codes, shown once. The parent holds `saved` so it can keep the
 * dialog open until the person confirms they have stored the codes.
 */
export function BackupCodesPanel({
  codes,
  email,
  saved,
  onSavedChange,
  children,
}: {
  codes: string[];
  email: string;
  saved: boolean;
  onSavedChange: (saved: boolean) => void;
  /** Extra notes shown above the codes (what else happened). */
  children?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy", "Select the codes and copy them by hand, or download the file.");
    }
  }

  return (
    <div className="space-y-4">
      {children}
      <div className="flex gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-600/40 dark:bg-amber-900/20 dark:text-amber-300">
        <Icon icon={Alert02Icon} size={18} className="mt-px shrink-0" />
        <p>
          <strong>Save these codes now. They will not be shown again.</strong> Each code works once if you lose access to your authenticator app.
        </p>
      </div>
      <ul
        aria-label="Backup codes"
        className="grid grid-cols-1 gap-2 rounded-lg bg-surface-2 p-3 font-mono text-sm text-text-primary min-[420px]:grid-cols-2"
      >
        {codes.map((c) => (
          <li key={c} className="select-all rounded-md bg-surface-0 px-3 py-1.5 text-center tracking-wider">
            {c}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary btn-sm" onClick={copy}>
          <Icon icon={Copy01Icon} size={15} />
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => downloadTextFile(BACKUP_CODES_FILENAME, backupCodesFileContent(codes, email))}
        >
          <Icon icon={Download01Icon} size={15} />
          Download (.txt)
        </button>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => {
            if (!printBackupCodes(codes, email)) toast.error("Could not open the print window", "Allow pop-ups for this site, or download the file instead.");
          }}
        >
          <Icon icon={PrinterIcon} size={15} />
          Print
        </button>
      </div>
      <label className="flex cursor-pointer items-start gap-2.5 text-sm text-text-primary">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4"
          checked={saved}
          onChange={(e) => onSavedChange(e.target.checked)}
        />
        I have saved these codes
      </label>
    </div>
  );
}
