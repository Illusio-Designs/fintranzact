import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { trpc } from "@/lib/trpc";
import { isDesktop } from "@/lib/isDesktop";
import { clearTrustedDeviceToken, getTrustedDeviceToken } from "@/lib/desktop-session";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast } from "@/hooks/useToast";

const fmt = (d: Date | string | null) => (d ? dayjs(d).format("D MMM YYYY") : "Never");

/** Devices that skip the second step for 30 days, with revoke and revoke-all. */
export function TrustedDevicesCard() {
  const utils = trpc.useUtils();
  // Desktop has no cookie: the server needs the keychain token to mark "This device".
  const [token, setToken] = useState<string | null | undefined>(isDesktop() ? undefined : null);
  useEffect(() => {
    if (!isDesktop()) return;
    getTrustedDeviceToken().then((t) => setToken(t));
  }, []);

  const { data: devices, isLoading, isError } = trpc.auth.listTrustedDevices.useQuery(
    token ? { trustedDeviceToken: token } : {},
    { enabled: token !== undefined },
  );
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [revokeAll, setRevokeAll] = useState(false);

  const revoke = trpc.auth.revokeTrustedDevice.useMutation({
    onSuccess: async (_data, vars) => {
      const wasCurrent = devices?.find((d) => d.id === vars.id)?.current;
      if (wasCurrent) await clearTrustedDeviceToken();
      if (wasCurrent) setToken(null);
      utils.auth.listTrustedDevices.invalidate();
      utils.auth.twoFactorStatus.invalidate();
      toast.success("Device removed", "It will ask for a code the next time it signs in.");
    },
    onError: (e) => toast.error("Could not remove the device", e.message),
  });
  const revokeAllMut = trpc.auth.revokeAllTrustedDevices.useMutation({
    onSuccess: async () => {
      await clearTrustedDeviceToken();
      setToken(null);
      utils.auth.listTrustedDevices.invalidate();
      utils.auth.twoFactorStatus.invalidate();
      toast.success("All trusted devices removed");
    },
    onError: (e) => toast.error("Could not remove the devices", e.message),
  });

  const list = devices ?? [];

  return (
    <>
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-border-light px-6 py-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-text-primary">Trusted devices</h3>
            <p className="text-xs text-text-tertiary">These skip the code for 30 days. Your password is still needed.</p>
          </div>
          {list.length > 0 && (
            <button type="button" className="btn-ghost shrink-0 text-xs text-red-600 hover:text-red-700" onClick={() => setRevokeAll(true)}>
              Revoke all
            </button>
          )}
        </div>
        {isLoading || token === undefined ? (
          <p className="px-6 py-6 text-sm text-text-tertiary">Loading…</p>
        ) : isError ? (
          <p className="px-6 py-6 text-sm text-red-600">Could not load your trusted devices.</p>
        ) : list.length === 0 ? (
          <p className="px-6 py-6 text-sm text-text-tertiary">No trusted devices. Tick "Trust this device for 30 days" when you sign in to add one.</p>
        ) : (
          <ul className="divide-y divide-border-light">
            {list.map((d) => (
              <li key={d.id} className="flex flex-wrap items-start justify-between gap-3 px-6 py-3">
                <div className="min-w-0 text-sm">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-text-primary">
                    <span className="break-words">{d.label}</span>
                    {d.current && (
                      <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                        This device
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-text-tertiary">
                    {d.ip ? `${d.ip} · ` : ""}Added {fmt(d.createdAt)} · Last used {fmt(d.lastUsedAt)} · Expires {fmt(d.expiresAt)}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-ghost shrink-0 text-xs text-red-600 hover:text-red-700"
                  onClick={() => setRevokeId(d.id)}
                  aria-label={`Revoke ${d.label}`}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={!!revokeId}
        title="Remove this trusted device?"
        description="It will ask for a code the next time you sign in on it."
        confirmLabel="Revoke"
        variant="danger"
        loading={revoke.isPending}
        onConfirm={() => {
          if (revokeId) revoke.mutate({ id: revokeId });
          setRevokeId(null);
        }}
        onCancel={() => setRevokeId(null)}
      />
      <ConfirmDialog
        open={revokeAll}
        title="Revoke all trusted devices?"
        description="Every device will ask for a code the next time you sign in."
        confirmLabel="Revoke all"
        variant="danger"
        loading={revokeAllMut.isPending}
        onConfirm={() => {
          revokeAllMut.mutate();
          setRevokeAll(false);
        }}
        onCancel={() => setRevokeAll(false)}
      />
    </>
  );
}
