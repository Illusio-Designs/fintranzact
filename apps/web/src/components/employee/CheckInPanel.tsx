import { useEffect, useRef, useState } from "react";
import { ATTENDANCE_CONSENT_ACCEPT_LABEL, ATTENDANCE_CONSENT_POINTS, ATTENDANCE_CONSENT_TITLE } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { captureFrame, cameraAvailable, deviceId, openCamera, readPosition, stopCamera } from "@/lib/selfie-capture";

function messageOf(e: unknown): string {
  return (e as { message?: string } | null)?.message || "Something went wrong. Please try again.";
}

/** The agreement the employee gives once: what is collected, why, for how long. */
export function ConsentDialog({ version, onAccepted }: { version: string; onAccepted: () => void }) {
  const accept = trpc.payrollSelf.acceptConsent.useMutation({ onSuccess: onAccepted, onError: (e) => toast({ title: "Could not save your agreement", description: messageOf(e), variant: "error" }) });
  return (
    <Modal open onClose={() => undefined} title={ATTENDANCE_CONSENT_TITLE} className="max-w-lg">
      <ul className="space-y-2 text-sm text-text-secondary" data-testid="consent-points">
        {ATTENDANCE_CONSENT_POINTS.map((p) => (
          <li key={p} className="leading-relaxed">{p}</li>
        ))}
      </ul>
      <div className="mt-4 flex justify-end">
        <button className="btn-primary" onClick={() => accept.mutate({ version })} disabled={accept.isPending}>
          {ATTENDANCE_CONSENT_ACCEPT_LABEL}
        </button>
      </div>
    </Modal>
  );
}

/** Check in or out: the front camera for a selfie and one reading of the location, asked for only now. */
export function CheckInPanel() {
  const utils = trpc.useUtils();
  const me = trpc.payrollSelf.me.useQuery(undefined, { refetchOnWindowFocus: true });
  const [capturing, setCapturing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const punch = trpc.payrollSelf.punch.useMutation();
  const data = me.data;

  if (me.isLoading || !data) return <p className="text-sm text-text-tertiary">Loading...</p>;
  if (!data.consent.accepted) return <ConsentDialog version={data.consent.version} onAccepted={() => void utils.payrollSelf.me.invalidate()} />;

  async function submit(selfie: string | undefined) {
    if (!data) return;
    setBusy(true);
    try {
      const pos = data.settings.locationNeeded ? await readPosition() : null;
      const r = await punch.mutateAsync({
        kind: data.next,
        clientTime: Date.now(),
        deviceId: deviceId(),
        consentVersion: data.consent.version,
        ...(selfie ? { selfie } : {}),
        ...(pos ? { lat: pos.lat, lng: pos.lng, accuracyM: pos.accuracyM } : {}),
      });
      setNotice(r.warning);
      toast({ title: r.kind === "in" ? "Checked in" : "Checked out", description: r.warning ?? undefined, variant: r.warning ? "info" : "success" });
      setCapturing(false);
      await utils.payrollSelf.me.invalidate();
      await utils.payrollSelf.attendance.invalidate();
    } catch (e) {
      toast({ title: "Could not record your punch", description: messageOf(e), variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  const label = data.next === "in" ? "Check in" : "Check out";
  const since = data.openSince ? new Date(data.openSince) : null;
  return (
    <section className="rounded-xl border border-border-light bg-surface-0 p-5" aria-label="Check in and out">
      <p className="text-sm text-text-secondary">
        {data.next === "out" && since ? `You checked in at ${since.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}.` : "You are not checked in."}
      </p>
      {!data.canPunch && <p className="mt-2 text-sm text-amber-700">Check-in from the app is switched off for your business. Ask HR.</p>}
      <button className="btn-primary mt-3 w-full sm:w-auto" disabled={!data.canPunch || busy} onClick={() => (data.settings.selfieRequired ? setCapturing(true) : void submit(undefined))}>
        {label}
      </button>
      {notice && <p role="status" className="mt-3 rounded-lg bg-amber-600/[0.08] px-3 py-2 text-sm text-amber-800 dark:text-amber-300">{notice}</p>}
      <p className="mt-3 text-xs text-text-tertiary">
        {data.settings.selfieRequired ? "Your camera is used for one selfie. " : ""}
        {data.settings.locationNeeded ? `Your location is read once${data.locationNames.length ? ` and compared with ${data.locationNames.join(", ")}` : ""}. ` : ""}
        Nothing is tracked in the background.
      </p>
      {data.today.length > 0 && (
        <ul className="mt-4 divide-y divide-border-light text-sm" aria-label="Today's punches">
          {data.today.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-1.5">
              <span className="font-medium text-text-primary">{p.kind === "in" ? "In" : "Out"} {p.time}</span>
              <span className="flex items-center gap-2 text-xs text-text-tertiary">
                {p.resultLabel}
                {p.review === "pending" && <Badge color="bg-amber-600/[0.1] text-amber-700">With HR</Badge>}
                {p.review === "rejected" && <Badge color="bg-red-600/[0.08] text-red-700">Not counted</Badge>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {capturing && <SelfieDialog label={label} busy={busy} onCancel={() => setCapturing(false)} onShot={(url) => void submit(url)} />}
    </section>
  );
}

function SelfieDialog({ label, busy, onCancel, onShot }: { label: string; busy: boolean; onCancel: () => void; onShot: (dataUrl: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(cameraAvailable() ? null : "This browser cannot open a camera. Use the mobile app to check in.");

  useEffect(() => {
    if (!cameraAvailable()) return;
    let cancelled = false;
    openCamera().then(
      (s) => {
        if (cancelled) return stopCamera(s);
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play?.();
        }
      },
      () => setError("The camera could not be opened. Allow camera access for this site and try again."),
    );
    return () => {
      cancelled = true;
      stopCamera(stream.current);
    };
  }, []);

  return (
    <Modal open onClose={onCancel} title="Take a selfie" className="max-w-md">
      <div className="space-y-3">
        {error ? (
          <p role="alert" className="text-sm text-red-600">{error}</p>
        ) : (
          <video ref={video} muted playsInline className="aspect-square w-full rounded-lg bg-black object-cover" aria-label="Camera preview" />
        )}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn-primary" disabled={!!error || busy} onClick={() => video.current && onShot(captureFrame(video.current))}>
            Take photo and {label.toLowerCase()}
          </button>
        </div>
      </div>
    </Modal>
  );
}

