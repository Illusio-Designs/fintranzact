import { useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { formatPayrollMonth } from "@fintranzact/shared";
import { trpc } from "../../lib/trpc";
import { makeStyles } from "../../lib/makeStyles";
import { formatCurrency } from "../../lib/utils";
import { Card } from "../ui";

const STATUS: Record<string, string> = { approved: "Approved, not paid out yet", active: "Being repaid", closed: "Closed" };
const monthLabel = (m: string) => (/^\d{4}-\d{2}$/.test(m) ? formatPayrollMonth(m) : m);
const STATUS_OF_INSTALMENT: Record<string, string> = { open: "To come", paid: "Paid", skipped: "Skipped" };

/**
 * My loans and advances (read only), a section under the payslips. Shown only when I have one. HR manages loans; I can only look:
 * the status, the amount, what is left to repay, the instalment and the next one, and a statement. The server finds my loans
 * from my login and refuses any id that is not mine.
 */
export function EmployeeLoans() {
  const styles = useStyles();
  const loans = trpc.payrollSelf.loans.useQuery();
  const [open, setOpen] = useState<string | null>(null);
  const list = loans.data ?? [];
  if (loans.isLoading) return null;
  if (loans.error) {
    return (
      <View>
        <Text style={styles.heading}>Loans and advances</Text>
        <Card><Text style={styles.empty}>Could not load your loans. Please try again later.</Text></Card>
      </View>
    );
  }
  if (list.length === 0) return null;
  return (
    <View>
      <Text style={styles.heading}>Loans and advances</Text>
      {list.map((l) => (
        <Card key={l.id}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.main}>{l.kind === "advance" ? "Advance" : "Loan"} {l.number}</Text>
              <Text style={styles.sub}>{STATUS[l.status] ?? l.status}{l.purpose ? `, ${l.purpose}` : ""}</Text>
            </View>
            <TouchableOpacity style={styles.btn} onPress={() => setOpen(open === l.id ? null : l.id)} accessibilityRole="button" accessibilityLabel={`${open === l.id ? "Hide" : "Show"} statement for ${l.number}`}>
              <Text style={styles.btnText}>{open === l.id ? "Hide" : "Statement"}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.grid}>
            <Fact label="Amount" value={formatCurrency(l.principal)} />
            <Fact label="Still to repay" value={formatCurrency(l.outstanding)} />
            <Fact label="Instalment (EMI)" value={formatCurrency(l.emi)} />
            <Fact label="Instalments left" value={String(l.remainingInstalments)} />
          </View>
          {l.nextInstalmentMonth ? (
            <Text style={styles.sub}>Next instalment: {formatCurrency(l.nextInstalmentAmount ?? "0")} from your {monthLabel(l.nextInstalmentMonth)} salary.</Text>
          ) : null}
          {l.status === "approved" ? <Text style={styles.sub}>This is approved and will start once it has been paid out to you.</Text> : null}
          {open === l.id ? <Statement id={l.id} /> : null}
        </Card>
      ))}
      <Text style={styles.sub}>Instalments are taken from your salary by payroll. For any change or a question, speak to HR.</Text>
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.fact}>
      <Text style={styles.sub}>{label}</Text>
      <Text style={styles.main}>{value}</Text>
    </View>
  );
}

function Statement({ id }: { id: string }) {
  const styles = useStyles();
  const q = trpc.payrollSelf.loanStatement.useQuery({ id });
  if (q.isLoading) return <ActivityIndicator style={{ marginTop: 12 }} />;
  if (q.error || !q.data) return <Text style={styles.empty}>Could not load this statement. Please try again later.</Text>;
  const { schedule, events } = q.data;
  return (
    <View style={styles.statement}>
      <Text style={styles.subHeading}>Repayment schedule</Text>
      {schedule.length === 0 ? <Text style={styles.sub}>No instalments are due.</Text> : schedule.map((s) => (
        <View key={s.seq} style={styles.line}>
          <Text style={[styles.main, { flex: 1 }]}>{monthLabel(s.dueMonth)}</Text>
          <Text style={styles.sub}>{formatCurrency(Number(s.principal) + Number(s.interest))}  {STATUS_OF_INSTALMENT[s.status] ?? s.status}</Text>
        </View>
      ))}
      <Text style={styles.subHeading}>What has happened</Text>
      {events.length === 0 ? <Text style={styles.sub}>Nothing yet.</Text> : events.map((e) => (
        <View key={e.id} style={styles.line}>
          <View style={{ flex: 1 }}>
            <Text style={styles.main}>{e.description}</Text>
            <Text style={styles.sub}>{e.date}  Balance {formatCurrency(e.balanceAfter)}</Text>
          </View>
          <Text style={styles.main}>{Number(e.principal) + Number(e.interest) ? formatCurrency(Number(e.principal) + Number(e.interest)) : ""}</Text>
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  heading: { color: colors.textPrimary, fontSize: 18, fontWeight: "700", marginTop: 20, marginBottom: 8, paddingHorizontal: 4 },
  subHeading: { color: colors.textMuted, fontSize: 12, fontWeight: "700", marginTop: 12, marginBottom: 4, textTransform: "uppercase" },
  empty: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 4, gap: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", marginTop: 8, gap: 8 },
  fact: { width: "47%" },
  line: { flexDirection: "row", alignItems: "center", paddingVertical: 4, gap: 8 },
  statement: { marginTop: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 4 },
  main: { color: colors.textPrimary, fontSize: 14, fontWeight: "600" },
  sub: { color: colors.textMuted, fontSize: 12, marginTop: 2, lineHeight: 18 },
  btn: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  btnText: { color: colors.brand, fontWeight: "700", fontSize: 13 },
}));
