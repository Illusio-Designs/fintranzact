import { useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ATTENDANCE_CONSENT_ACCEPT_LABEL, ATTENDANCE_CONSENT_POINTS, ATTENDANCE_CONSENT_TITLE } from "@fintranzact/shared";
import { trpc } from "../../lib/trpc";
import { makeStyles } from "../../lib/makeStyles";
import { Card, QueryError, ScreenHeader } from "../ui";
import { performPunch } from "../../lib/punch";
import { getDeviceId, readForegroundPosition } from "../../lib/device-capture";
import { SelfieCamera } from "./SelfieCamera";
import { useAuthStore } from "../../stores/auth";

/** The employee's home: check in or out with a selfie and one location reading, and today's punches. */
export function EmployeeHome() {
  const styles = useStyles();
  const utils = trpc.useUtils();
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);
  // An employee has no Settings tab, so signing out lives here.
  const signOut = trpc.auth.logout.useMutation({
    onSettled: async () => {
      await logout();
      router.replace("/(auth)/login");
    },
  });
  const me = trpc.payrollSelf.me.useQuery(undefined, { refetchOnWindowFocus: true });
  const accept = trpc.payrollSelf.acceptConsent.useMutation({ onSuccess: () => void utils.payrollSelf.me.invalidate() });
  const punch = trpc.payrollSelf.punch.useMutation();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "warn" | "error" } | null>(null);
  const resolver = useRef<((dataUrl: string | null) => void) | null>(null);

  const data = me.data;
  if (me.isLoading) return <SafeAreaView style={styles.container}><ActivityIndicator style={{ marginTop: 40 }} /></SafeAreaView>;
  if (me.error || !data) return <SafeAreaView style={styles.container}><QueryError message="Could not load your check-in." onRetry={() => void me.refetch()} /></SafeAreaView>;

  if (!data.consent.accepted) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.pad}>
          <ScreenHeader title={ATTENDANCE_CONSENT_TITLE} />
          <Card>
            {ATTENDANCE_CONSENT_POINTS.map((p) => (
              <Text key={p} style={styles.point}>{p}</Text>
            ))}
            <TouchableOpacity style={styles.primary} onPress={() => accept.mutate({ version: data.consent.version })} disabled={accept.isPending} accessibilityRole="button" accessibilityLabel={ATTENDANCE_CONSENT_ACCEPT_LABEL}>
              <Text style={styles.primaryText}>{ATTENDANCE_CONSENT_ACCEPT_LABEL}</Text>
            </TouchableOpacity>
          </Card>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const captureSelfie = () =>
    new Promise<string | null>((resolve) => {
      resolver.current = resolve;
      setCameraOpen(true);
    });

  async function go() {
    if (!data) return;
    setBusy(true);
    setMessage(null);
    const outcome = await performPunch(
      { kind: data.next, consentVersion: data.consent.version, selfieRequired: data.settings.selfieRequired, locationNeeded: data.settings.locationNeeded },
      {
        captureSelfie,
        readPosition: readForegroundPosition,
        deviceId: getDeviceId,
        now: () => Date.now(),
        send: (request) => punch.mutateAsync(request),
      },
    );
    setBusy(false);
    if (outcome.ok) {
      setMessage(outcome.warning ? { text: outcome.warning, tone: "warn" } : { text: outcome.kind === "in" ? "You are checked in." : "You are checked out.", tone: "ok" });
      await utils.payrollSelf.me.invalidate();
      await utils.payrollSelf.attendance.invalidate();
    } else {
      setMessage({ text: outcome.message, tone: "error" });
    }
  }

  const label = data.next === "in" ? "Check in" : "Check out";
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.pad}>
        <ScreenHeader title={`Hello, ${data.employee.name.split(" ")[0]}`} subtitle={data.businessName} />
        <Card>
          <Text style={styles.status}>{data.next === "out" && data.openSince ? "You are checked in." : "You are not checked in."}</Text>
          {!data.canPunch && <Text style={styles.warn}>Check-in from the app is switched off for your business. Ask HR.</Text>}
          <TouchableOpacity style={[styles.primary, (!data.canPunch || busy) && styles.disabled]} disabled={!data.canPunch || busy} onPress={() => void go()} accessibilityRole="button" accessibilityLabel={label} testID="punch-button">
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{label}</Text>}
          </TouchableOpacity>
          {message && <Text style={message.tone === "error" ? styles.error : message.tone === "warn" ? styles.warn : styles.ok} accessibilityRole="alert" testID="punch-message">{message.text}</Text>}
          <Text style={styles.note}>
            {data.settings.selfieRequired ? "The camera takes one selfie. " : ""}
            {data.settings.locationNeeded ? "Your location is read once. " : ""}
            Nothing is tracked in the background.
          </Text>
        </Card>
        {data.today.length > 0 && (
          <Card style={{ marginTop: 12 }}>
            <Text style={styles.heading}>Today</Text>
            {data.today.map((p) => (
              <View key={p.id} style={styles.row}>
                <Text style={styles.rowMain}>{p.kind === "in" ? "In" : "Out"} {p.time}</Text>
                <Text style={styles.rowSub}>{p.resultLabel}{p.review === "pending" ? ", with HR" : p.review === "rejected" ? ", not counted" : ""}</Text>
              </View>
            ))}
          </Card>
        )}
        <TouchableOpacity style={styles.signOut} onPress={() => signOut.mutate()} accessibilityRole="button" accessibilityLabel="Sign out">
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>
      <SelfieCamera
        visible={cameraOpen}
        onDone={(dataUrl) => {
          setCameraOpen(false);
          resolver.current?.(dataUrl);
          resolver.current = null;
        }}
      />
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  pad: { paddingHorizontal: 16, paddingBottom: 32 },
  point: { fontSize: 14, color: colors.textPrimary, lineHeight: 21, marginBottom: 10 },
  status: { fontSize: 16, fontWeight: "700", color: colors.textPrimary, marginBottom: 12 },
  heading: { fontSize: 14, fontWeight: "700", color: colors.textPrimary, marginBottom: 8 },
  primary: { backgroundColor: colors.brand, paddingVertical: 16, borderRadius: 14, alignItems: "center", marginTop: 8 },
  primaryText: { color: colors.onBrand, fontWeight: "700", fontSize: 16 },
  disabled: { opacity: 0.5 },
  ok: { color: colors.textPrimary, marginTop: 12, fontSize: 14 },
  warn: { color: colors.amber, marginTop: 12, fontSize: 14 },
  error: { color: colors.danger, marginTop: 12, fontSize: 14 },
  note: { color: colors.textMuted, marginTop: 12, fontSize: 12, lineHeight: 18 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  signOut: { alignSelf: "center", paddingVertical: 16, marginTop: 8 },
  signOutText: { color: colors.textMuted, fontSize: 14, fontWeight: "600" },
  rowMain: { color: colors.textPrimary, fontSize: 14, fontWeight: "600" },
  rowSub: { color: colors.textMuted, fontSize: 12 },
}));
