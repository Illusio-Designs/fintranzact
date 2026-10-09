import { useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { trpc } from "../../lib/trpc";
import { makeStyles } from "../../lib/makeStyles";
import { formatCurrency } from "../../lib/utils";
import { Card, QueryError, ScreenHeader } from "../ui";
import { EmployeeLoans } from "./EmployeeLoans";

/** Save a base64 PDF to the cache and open the share sheet (so it can be saved, printed or sent). */
export async function shareBase64Pdf(filename: string, base64: string, title: string): Promise<void> {
  const uri = `${FileSystem.cacheDirectory}${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: title });
}

/** My payslips (approved runs only), my Form 16 working copy when HR has released it, and (read only) my loans and advances if I have any. */
export function EmployeePayslips() {
  const styles = useStyles();
  const utils = trpc.useUtils();
  const slips = trpc.payrollSelf.payslips.useQuery();
  const years = trpc.payrollSelf.form16Years.useQuery();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, title: string, load: () => Promise<{ filename: string; base64: string }>) {
    setBusy(key);
    try {
      const f = await load();
      await shareBase64Pdf(f.filename, f.base64, title);
    } catch (e) {
      Alert.alert("Could not open the file", (e as { message?: string }).message ?? "Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.pad}>
        <ScreenHeader title="Payslips" />
        {slips.isLoading ? <ActivityIndicator style={{ marginTop: 24 }} /> : slips.error ? <QueryError message="Could not load your payslips." onRetry={() => void slips.refetch()} /> : (
          <Card>
            {(slips.data ?? []).length === 0 ? (
              <Text style={styles.empty}>No payslips yet. A payslip appears here once the month's payroll is approved.</Text>
            ) : (
              (slips.data ?? []).map((s) => (
                <View key={s.runId} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.main}>{s.monthLabel}</Text>
                    <Text style={styles.sub}>Net pay {formatCurrency(s.netPay)}</Text>
                  </View>
                  <TouchableOpacity style={styles.btn} disabled={busy === s.runId} onPress={() => void run(s.runId, s.monthLabel, () => utils.payrollSelf.payslipPdf.fetch({ runId: s.runId }))} accessibilityRole="button" accessibilityLabel={`Open payslip for ${s.monthLabel}`}>
                    <Text style={styles.btnText}>{busy === s.runId ? "Opening" : "Open"}</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </Card>
        )}
        <Text style={styles.heading}>Form 16</Text>
        <Card>
          {(years.data ?? []).length === 0 ? (
            <Text style={styles.empty}>Your Form 16 is not available yet. HR releases it after the financial year.</Text>
          ) : (
            <>
              {(years.data ?? []).map((y) => (
                <View key={y.financialYear} style={styles.row}>
                  <Text style={[styles.main, { flex: 1 }]}>Financial year {y.label}</Text>
                  <TouchableOpacity style={styles.btn} disabled={busy === `f${y.financialYear}`} onPress={() => void run(`f${y.financialYear}`, `Form 16 ${y.label}`, () => utils.payrollSelf.form16Pdf.fetch({ financialYear: y.financialYear }))} accessibilityRole="button" accessibilityLabel={`Open Form 16 for ${y.label}`}>
                    <Text style={styles.btnText}>Open</Text>
                  </TouchableOpacity>
                </View>
              ))}
              <Text style={styles.sub}>A working copy prepared from your payslips for your employer's CA to review. It is not the certificate issued through TRACES.</Text>
            </>
          )}
        </Card>
        <EmployeeLoans />
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  pad: { paddingHorizontal: 16, paddingBottom: 32 },
  heading: { color: colors.textPrimary, fontSize: 18, fontWeight: "700", marginTop: 20, marginBottom: 8, paddingHorizontal: 4 },
  empty: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 8, gap: 12 },
  main: { color: colors.textPrimary, fontSize: 14, fontWeight: "600" },
  sub: { color: colors.textMuted, fontSize: 12, marginTop: 2, lineHeight: 18 },
  btn: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  btnText: { color: colors.brand, fontWeight: "700", fontSize: 13 },
}));
