import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ATTENDANCE_STATUS_LABELS, SELF_ATTENDANCE_FLAG_LABELS, formatPayrollMonth, type AttendanceStatus } from "@fintranzact/shared";
import { trpc } from "../../lib/trpc";
import { makeStyles } from "../../lib/makeStyles";
import { Card, QueryError, ScreenHeader } from "../ui";

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The current month as "YYYY-MM" in Indian time. */
export function currentIstMonth(now = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 7);
}

/** My month: each day's status and times, with week offs, holidays and my punches. */
export function EmployeeAttendance({ now = new Date() }: { now?: Date }) {
  const styles = useStyles();
  const [month, setMonth] = useState(currentIstMonth(now));
  const q = trpc.payrollSelf.attendance.useQuery({ month });
  const data = q.data;
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.pad}>
        <ScreenHeader title="Attendance" subtitle={formatPayrollMonth(month)} />
        <View style={styles.nav}>
          <TouchableOpacity onPress={() => setMonth(shiftMonth(month, -1))} accessibilityRole="button" accessibilityLabel="Previous month"><Text style={styles.link}>Previous</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setMonth(shiftMonth(month, 1))} disabled={month >= currentIstMonth(now)} accessibilityRole="button" accessibilityLabel="Next month"><Text style={[styles.link, month >= currentIstMonth(now) && styles.off]}>Next</Text></TouchableOpacity>
        </View>
        {q.isLoading ? <ActivityIndicator style={{ marginTop: 24 }} /> : q.error || !data ? <QueryError message="Could not load your attendance." onRetry={() => void q.refetch()} /> : (
          <>
            <Card>
              <Text style={styles.summary} testID="attendance-summary">Present {data.summary.present}, half days {data.summary.halfDay}, absent {data.summary.absent}, on leave {data.summary.leave}</Text>
              {data.days.filter((d) => d.employed).map((d) => {
                const label = d.status ? ATTENDANCE_STATUS_LABELS[d.status as AttendanceStatus] ?? d.status : d.holiday ?? (d.weekOff ? "Week off" : "");
                return (
                  <View key={d.date} style={styles.row}>
                    <Text style={styles.day}>{d.date.slice(8)}</Text>
                    <Text style={styles.label}>{label}</Text>
                    <Text style={styles.times}>{d.checkIn ? `${d.checkIn}${d.checkOut ? `-${d.checkOut}` : ""}` : ""}</Text>
                  </View>
                );
              })}
            </Card>
            {data.punches.length > 0 && (
              <Card style={{ marginTop: 12 }}>
                <Text style={styles.heading}>My punches</Text>
                {[...data.punches].reverse().map((p) => (
                  <View key={p.id} style={styles.row}>
                    <Text style={styles.label}>{p.date.slice(8)}/{p.date.slice(5, 7)} {p.kind === "in" ? "In" : "Out"} {p.time}</Text>
                    <Text style={styles.times}>{p.flags.map((f) => SELF_ATTENDANCE_FLAG_LABELS[f] ?? f).join(", ")}{p.review === "rejected" ? " Not counted" : p.review === "pending" ? " With HR" : ""}</Text>
                  </View>
                ))}
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  pad: { paddingHorizontal: 16, paddingBottom: 32 },
  nav: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 4, marginBottom: 8 },
  link: { color: colors.brand, fontWeight: "700", fontSize: 14 },
  off: { opacity: 0.3 },
  summary: { color: colors.textPrimary, fontSize: 14, fontWeight: "600", marginBottom: 8 },
  heading: { color: colors.textPrimary, fontSize: 14, fontWeight: "700", marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 5, gap: 8 },
  day: { width: 26, color: colors.textMuted, fontSize: 13 },
  label: { flex: 1, color: colors.textPrimary, fontSize: 13 },
  times: { color: colors.textMuted, fontSize: 12 },
}));
