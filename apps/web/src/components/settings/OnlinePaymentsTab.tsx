/**
 * Settings, Online payments (Razorpay): the business connects ITS OWN
 * Razorpay account so customers can pay invoices online and the money lands
 * straight in that account. Keys are sent to the server once and never come
 * back: this page only ever sees the masked key id and whether a webhook
 * secret is saved. Owner and admin only (the server enforces it too).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { InputField } from "@/components/ui/FormField";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function formatWhen(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function OnlinePaymentsTab() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.onlinePayments.getSettings.useQuery();
  const [editing, setEditing] = useState(false);
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const connect = trpc.onlinePayments.connect.useMutation({
    onSuccess: () => {
      utils.onlinePayments.getSettings.invalidate();
      setKeyId("");
      setKeySecret("");
      setWebhookSecret("");
      setEditing(false);
      setTestResult(null);
      toast.success("Razorpay keys saved", "Use Test connection to check them.");
    },
    onError: (err) => toast.error("Could not save the keys", err.message),
  });

  const test = trpc.onlinePayments.testConnection.useMutation({
    onSuccess: (res) => {
      setTestResult(res);
      utils.onlinePayments.getSettings.invalidate();
    },
    onError: (err) => toast.error("Could not test the connection", err.message),
  });

  const disconnect = trpc.onlinePayments.disconnect.useMutation({
    onSuccess: () => {
      utils.onlinePayments.getSettings.invalidate();
      setConfirmDisconnect(false);
      setTestResult(null);
      toast.success("Razorpay disconnected", "Open payment links were cancelled.");
    },
    onError: (err) => toast.error("Could not disconnect", err.message),
  });

  if (isLoading || !data) return <div className="skeleton h-48 rounded-xl" />;

  const showForm = !data.connected || editing;
  const canSubmit = keyId.trim().length > 0 && keySecret.trim().length > 0 && !connect.isPending;

  return (
    <div className="space-y-4" data-testid="online-payments-tab">
      <section className="card p-5">
        <h3 className="text-sm font-semibold text-text-primary">Online payments (Razorpay)</h3>
        <p className="mt-1 text-xs text-text-tertiary">
          Let customers pay your invoices online with UPI, cards and net banking. Payments go straight to your own Razorpay account and bank, not through Fintranzact. You need a Razorpay account with Payment Links enabled.
        </p>

        {data.connected && (
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-surface-1 px-4 py-3 text-sm" data-testid="razorpay-connected">
            <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
              Connected
            </span>
            <span className="font-mono text-xs text-text-secondary" data-testid="razorpay-key-masked">{data.keyIdMasked}</span>
            <span className="text-xs text-text-tertiary">{data.mode === "live" ? "Live mode" : "Test mode (no real money)"}</span>
            {data.lastTestedAt && (
              <span className="text-xs text-text-tertiary">
                Last tested {formatWhen(data.lastTestedAt)}: {data.lastTestOk ? "worked" : "failed"}
              </span>
            )}
          </div>
        )}

        {testResult && (
          <p
            role="status"
            className={testResult.ok ? "mt-3 text-sm text-emerald-700 dark:text-emerald-400" : "mt-3 text-sm text-red-600"}
            data-testid="razorpay-test-result"
          >
            {testResult.message}
          </p>
        )}

        {showForm ? (
          <form
            className="mt-4 grid gap-3 sm:max-w-md"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) connect.mutate({ keyId: keyId.trim(), keySecret: keySecret.trim(), webhookSecret: webhookSecret.trim() || undefined });
            }}
          >
            <InputField
              label="Key ID"
              value={keyId}
              onChange={(e) => setKeyId(e.target.value)}
              placeholder="rzp_live_..."
              autoComplete="off"
              spellCheck={false}
              required
            />
            <InputField
              label="Key secret"
              type="password"
              value={keySecret}
              onChange={(e) => setKeySecret(e.target.value)}
              autoComplete="new-password"
              required
            />
            <InputField
              label={data.hasWebhookSecret ? "Webhook secret (leave blank to keep the saved one)" : "Webhook secret"}
              type="password"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              autoComplete="new-password"
            />
            <p className="text-xs text-text-tertiary">
              Find the keys in your Razorpay dashboard under Account &amp; Settings, API keys. The secrets are stored encrypted and are never shown again.
            </p>
            <div className="flex gap-2">
              <button type="submit" className="btn-primary px-4 py-2" disabled={!canSubmit}>
                {data.connected ? "Save new keys" : "Connect Razorpay"}
              </button>
              {data.connected && (
                <button type="button" className="btn-secondary px-4 py-2" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              )}
            </div>
          </form>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-secondary px-4 py-2" onClick={() => test.mutate()} disabled={test.isPending}>
              {test.isPending ? "Testing..." : "Test connection"}
            </button>
            <button className="btn-secondary px-4 py-2" onClick={() => setEditing(true)}>
              Change keys
            </button>
            <button className="px-4 py-2 text-sm font-medium text-red-600 hover:underline" onClick={() => setConfirmDisconnect(true)}>
              Disconnect
            </button>
          </div>
        )}
      </section>

      {data.connected && data.webhookUrl && (
        <section className="card p-5" data-testid="razorpay-webhook-setup">
          <h3 className="text-sm font-semibold text-text-primary">Webhook: so paid invoices update by themselves</h3>
          {!data.hasWebhookSecret && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300" role="alert">
              Add the webhook secret above (step 3). Until then, payments are not recorded automatically.
            </p>
          )}
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-text-secondary">
            <li>
              In your Razorpay dashboard open Settings, then Webhooks, then Add New Webhook, and paste this URL:
              <div className="mt-2 flex items-center gap-2">
                <input readOnly value={data.webhookUrl} onFocus={(e) => e.currentTarget.select()} aria-label="Webhook URL" className="input min-w-0 flex-1 font-mono text-xs" />
                <button
                  className="btn-secondary shrink-0 px-3 py-1.5 text-xs"
                  onClick={async () => ((await copyText(data.webhookUrl!)) ? toast.success("Webhook URL copied") : toast.error("Could not copy"))}
                >
                  Copy
                </button>
              </div>
              <p className="mt-1 text-xs text-text-tertiary">This address is unique to your business. Do not share it.</p>
            </li>
            <li>
              Choose a secret of your own and enter it in Razorpay. Tick these events:
              <ul className="mt-1 list-disc pl-5 font-mono text-xs">
                {data.webhookEvents.map((ev) => (
                  <li key={ev}>{ev}</li>
                ))}
              </ul>
            </li>
            <li>Paste the same secret in the Webhook secret field above (Change keys).</li>
          </ol>
        </section>
      )}

      <ConfirmDialog
        open={confirmDisconnect}
        onCancel={() => setConfirmDisconnect(false)}
        onConfirm={() => disconnect.mutate()}
        title="Disconnect Razorpay?"
        description="Your keys are deleted and open payment links are cancelled. Payments already made stay recorded. You can connect again any time."
        confirmLabel="Disconnect"
        variant="danger"
        loading={disconnect.isPending}
      />
    </div>
  );
}
