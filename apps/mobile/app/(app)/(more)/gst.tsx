import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { canFileGstReturns, fyStartOf, gstnPeriodOf, returnName, wizardPeriodLabel, type FilingKind } from "@fintranzact/shared";
import { trpc } from "../../../src/lib/trpc";
import { makeStyles } from "../../../src/lib/makeStyles";
import { useBusinessStore } from "../../../src/stores/business";
import { Card, ScreenHeader, QueryError } from "../../../src/components/ui";
import { GstFilingFlow } from "../../../src/components/gst/GstFilingFlow";
import { Btn, KV, Note, P } from "../../../src/components/gst/parts";

/** The month before today: the usual one to file. */
function defaultPeriod(d = new Date()) {
  const m = d.getMonth(); // 0-based: previous calendar month is m (1-based)
  return m === 0 ? { year: d.getFullYear() - 1, month: 12 } : { year: d.getFullYear(), month: m };
}

export default function GSTReturnsScreen() {
  const styles = useStyles();
  const businessId = useBusinessStore((s) => s.businessId);
  const initial = defaultPeriod();
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [kind, setKind] = useState<FilingKind>("gstr1");
  const [filing, setFiling] = useState(false);

  const { data: me } = trpc.auth.me.useQuery(undefined);
  const canFile = canFileGstReturns(me?.role);
  const { data: biz } = trpc.business.getById.useQuery({ id: businessId ?? "" }, { enabled: !!businessId });
  const gstin = biz?.gstin ?? "";
  const composition = biz?.gstRegistrationType === "composition";
  const ready = !!gstin && !composition;

  const status = trpc.gstReturns.filingStatus.useQuery(
    { fyStartYear: fyStartOf(year, month), refresh: false },
    { enabled: ready, retry: false, refetchOnWindowFocus: false },
  );
  const attempt = trpc.gstReturns.filingAttempt.useQuery({ kind, year, month }, { enabled: ready && canFile, retry: false, refetchOnWindowFocus: false });

  const step = (delta: number) => {
    const idx = year * 12 + (month - 1) + delta;
    setYear(Math.floor(idx / 12));
    setMonth((idx % 12) + 1);
  };

  if (filing && ready) {
    return (
      <GstFilingFlow
        key={`${kind}:${year}:${month}`}
        kind={kind}
        year={year}
        month={month}
        gstin={gstin}
        onExit={() => {
          setFiling(false);
          void status.refetch();
          void attempt.refetch();
        }}
        onSwitch={(k, y, m) => {
          setKind(k);
          setYear(y);
          setMonth(m);
        }}
      />
    );
  }

  const label = wizardPeriodLabel(year, month);
  const name = returnName(kind);
  const row = status.data?.status === "ok" ? status.data.months.find((m) => m.period === gstnPeriodOf(year, month)) : null;
  const started = !!attempt.data && attempt.data.state !== "draft" && attempt.data.state !== "filed";
  const filed = attempt.data?.state === "filed";

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.body}>
        <ScreenHeader title="GST Returns" subtitle="File GSTR-1 and GSTR-3B step by step" />

        <View style={styles.pickerRow} accessibilityRole="toolbar">
          <Btn label="Previous month" variant="secondary" onPress={() => step(-1)} />
          <Text accessibilityLabel={`Return period ${label}`} style={styles.period}>{label}</Text>
          <Btn label="Next month" variant="secondary" onPress={() => step(1)} />
        </View>

        <View style={styles.kindRow}>
          <Btn label="GSTR-1" variant={kind === "gstr1" ? "primary" : "secondary"} onPress={() => setKind("gstr1")} />
          <Btn label="GSTR-3B" variant={kind === "gstr3b" ? "primary" : "secondary"} onPress={() => setKind("gstr3b")} />
        </View>

        <View style={styles.pad}>
          {!gstin ? <Note tone="info">Add the business GSTIN in Settings to see return status and file returns.</Note> : null}
          {composition ? <Note tone="info">Composition dealers file CMP-08 and GSTR-4; monthly GSTR-1 and GSTR-3B do not apply. Use the web app for those.</Note> : null}
        </View>

        {ready ? (
          <View style={styles.pad}>
          <Card>
            <Text style={styles.cardTitle}>Return status for {label}</Text>
            {status.isLoading ? <P muted>Checking the GST portal...</P> : null}
            {status.error ? <QueryError message={status.error.message} onRetry={() => void status.refetch()} /> : null}
            {status.data?.status === "unavailable" ? <P muted>{`Could not check the GST portal: ${status.data.reason}`}</P> : null}
            {status.data?.status === "ok" ? (
              <>
                <KV k="GSTR-1" v={row?.gstr1 ? `Filed${row.gstr1.arn ? `, ARN ${row.gstr1.arn}` : ""}` : "Not filed"} />
                <KV k="GSTR-3B" v={row?.gstr3b ? `Filed${row.gstr3b.arn ? `, ARN ${row.gstr3b.arn}` : ""}` : "Not filed"} />
              </>
            ) : null}
            <Btn label="Refresh status" variant="link" onPress={() => void status.refetch()} />
          </Card>
          </View>
        ) : null}

        {ready && canFile ? (
          <View style={styles.cta}>
            <P muted>
              {filed ? `${name} for ${label} is filed.` : started ? `${name} for ${label} is in progress. Resume where you stopped.` : `Nothing is filed until you confirm at the very end.`}
            </P>
            <Btn label={filed ? `View ${name} result` : started ? `Resume ${name} filing` : `File ${name} for ${label}`} onPress={() => setFiling(true)} />
          </View>
        ) : null}
        {ready && me && !canFile ? (
          <View style={styles.pad}>
            <Note tone="info">Your role can see the return status but cannot file returns. Ask the business owner or a filing accountant.</Note>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { paddingBottom: 32, gap: 12 },
  pickerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingHorizontal: 20 },
  period: { fontSize: 18, fontWeight: "700", color: colors.textPrimary },
  kindRow: { flexDirection: "row", gap: 8, paddingHorizontal: 20 },
  cardTitle: { fontSize: 14, fontWeight: "700", color: colors.textPrimary, marginBottom: 6 },
  pad: { paddingHorizontal: 20, gap: 8 },
  cta: { paddingHorizontal: 20, gap: 8 },
}));
