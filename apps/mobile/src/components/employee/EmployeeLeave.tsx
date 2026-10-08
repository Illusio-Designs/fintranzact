import { useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { selfLeaveApplySchema } from "@fintranzact/shared";
import { trpc } from "../../lib/trpc";
import { makeStyles } from "../../lib/makeStyles";
import { formatDate } from "../../lib/utils";
import { Card, DatePickerField, QueryError, ScreenHeader } from "../ui";

/** A picked calendar day as "YYYY-MM-DD" (the day the person chose, in the phone's local calendar). */
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** My leave balances, my applications (cancel while pending), and a form to apply. HR or an owner approves. */
export function EmployeeLeave() {
  const styles = useStyles();
  const utils = trpc.useUtils();
  const q = trpc.payrollSelf.leaveOverview.useQuery();
  const [applying, setApplying] = useState(false);
  const [typeId, setTypeId] = useState("");
  const [from, setFrom] = useState(() => new Date());
  const [to, setTo] = useState(() => new Date());
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    void utils.payrollSelf.leaveOverview.invalidate();
    void utils.payrollSelf.attendance.invalidate();
  };
  const apply = trpc.payrollSelf.leaveApply.useMutation({
    onSuccess: () => {
      setApplying(false);
      setReason("");
      Alert.alert("Leave request sent", "HR will approve or reject it. You will get an email.");
      refresh();
    },
    onError: (e) => setError(e.message),
  });
  const cancel = trpc.payrollSelf.leaveCancel.useMutation({ onSuccess: refresh, onError: (e) => Alert.alert("Could not cancel", e.message) });
  const data = q.data;

  function send() {
    const parsed = selfLeaveApplySchema.safeParse({ leaveTypeId: typeId, fromDate: ymd(from), toDate: ymd(to), halfDayStart: false, halfDayEnd: false, reason });
    if (!parsed.success) return setError(parsed.error.issues[0]!.message.includes("Invalid uuid") ? "Choose the leave type." : parsed.error.issues[0]!.message);
    setError(null);
    apply.mutate(parsed.data);
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.pad}>
        <ScreenHeader title="Leave" right={data ? <TouchableOpacity style={styles.btn} onPress={() => setApplying(!applying)} accessibilityRole="button" accessibilityLabel="Apply for leave"><Text style={styles.btnText}>{applying ? "Close" : "Apply"}</Text></TouchableOpacity> : undefined} />
        {q.isLoading ? <ActivityIndicator style={{ marginTop: 24 }} /> : q.error || !data ? <QueryError message="Could not load your leave." onRetry={() => void q.refetch()} /> : (
          <>
            <Card>
              {data.types.map((t) => (
                <View key={t.id} style={styles.row}>
                  <Text style={styles.main}>{t.name}{t.isPaid ? "" : " (unpaid)"}</Text>
                  <Text style={styles.main} testID={`balance-${t.code}`}>{t.balance}</Text>
                </View>
              ))}
            </Card>
            {applying && (
              <Card style={{ marginTop: 12 }}>
                <Text style={styles.heading}>Leave type</Text>
                <View style={styles.chips}>
                  {data.types.map((t) => (
                    <TouchableOpacity key={t.id} style={[styles.chip, typeId === t.id && styles.chipOn]} onPress={() => setTypeId(t.id)} accessibilityRole="button" accessibilityLabel={`Leave type ${t.name}`} accessibilityState={{ selected: typeId === t.id }}>
                      <Text style={[styles.chipText, typeId === t.id && styles.chipTextOn]}>{t.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <DatePickerField label="From" value={from} onChange={setFrom} />
                <DatePickerField label="To" value={to} onChange={setTo} minimumDate={from} />
                <TextInput style={styles.input} placeholder="Reason (optional)" value={reason} onChangeText={setReason} accessibilityLabel="Reason" />
                {error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
                <TouchableOpacity style={styles.primary} onPress={send} disabled={apply.isPending} accessibilityRole="button" accessibilityLabel="Send request"><Text style={styles.primaryText}>Send request</Text></TouchableOpacity>
              </Card>
            )}
            <Text style={styles.heading2}>My applications</Text>
            <Card>
              {data.applications.length === 0 ? <Text style={styles.sub}>You have not applied for leave yet.</Text> : data.applications.map((a) => (
                <View key={a.id} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.main}>{a.leaveName}, {Number(a.days)} day(s)</Text>
                    <Text style={styles.sub}>{a.fromDate === a.toDate ? formatDate(a.fromDate) : `${formatDate(a.fromDate)} to ${formatDate(a.toDate)}`} - {a.status}{a.decisionNote ? ` (${a.decisionNote})` : ""}</Text>
                  </View>
                  {a.status === "pending" && (
                    <TouchableOpacity style={styles.btn} onPress={() => cancel.mutate({ id: a.id })} accessibilityRole="button" accessibilityLabel={`Cancel leave on ${a.fromDate}`}><Text style={styles.btnText}>Cancel</Text></TouchableOpacity>
                  )}
                </View>
              ))}
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  pad: { paddingHorizontal: 16, paddingBottom: 32 },
  heading: { color: colors.textPrimary, fontSize: 14, fontWeight: "700", marginBottom: 8 },
  heading2: { color: colors.textPrimary, fontSize: 18, fontWeight: "700", marginTop: 20, marginBottom: 8, paddingHorizontal: 4 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8, gap: 12 },
  main: { color: colors.textPrimary, fontSize: 14, fontWeight: "600" },
  sub: { color: colors.textMuted, fontSize: 12, marginTop: 2, lineHeight: 18 },
  btn: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  btnText: { color: colors.brand, fontWeight: "700", fontSize: 13 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { color: colors.textPrimary, fontSize: 13 },
  chipTextOn: { color: colors.onBrand },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, color: colors.textPrimary, marginTop: 12 },
  error: { color: colors.danger, marginTop: 10, fontSize: 13 },
  primary: { backgroundColor: colors.brand, paddingVertical: 14, borderRadius: 14, alignItems: "center", marginTop: 14 },
  primaryText: { color: colors.onBrand, fontWeight: "700", fontSize: 15 },
}));
