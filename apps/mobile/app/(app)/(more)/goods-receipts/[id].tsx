import { useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../../src/lib/trpc";
import { formatCurrency, formatDate } from "../../../../src/lib/utils";
import { makeStyles } from "../../../../src/lib/makeStyles";
import { useColors } from "../../../../src/contexts/ThemeContext";
import { StatusBadge } from "../../../../src/components/ui";
import { ExpiryBadge, expiryLabel } from "../../../../src/components/BatchFields";

/** Days from today to a batch's expiry date, for the expiry badge. */
function batchDays(expiryDate: string | null): { expired: boolean; daysToExpiry: number | null } {
  if (!expiryDate) return { expired: false, daysToExpiry: null };
  const [y, m, d] = expiryDate.split("-").map(Number);
  const today = new Date();
  const days = Math.round((new Date(y, m - 1, d).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000);
  return { expired: days < 0, daysToExpiry: days };
}

export default function GoodsReceiptDetailScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const utils = trpc.useUtils();

  const { data: grn, isLoading, isError, refetch } = trpc.goodsReceiptNote.getById.useQuery(
    { id: id! },
    { enabled: !!id }
  );

  const updateMutation = trpc.goodsReceiptNote.updateStatus.useMutation({
    onSuccess: () => {
      utils.goodsReceiptNote.list.invalidate();
      utils.goodsReceiptNote.getById.invalidate({ id: id! });
    },
    onError: (err: { message: string }) => Alert.alert("Error", err.message),
  });

  const convertMutation = trpc.document.convert.useMutation({
    onSuccess: (result) => {
      utils.goodsReceiptNote.list.invalidate();
      utils.goodsReceiptNote.getById.invalidate({ id: id! });
      utils.invoice.list.invalidate();
      utils.dashboard.summary.invalidate();
      utils.party.list.invalidate();
      Alert.alert("Converted", `Purchase invoice created: ${result.invoiceNumber}`, [{ text: "OK" }]);
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const handleMarkSent = useCallback(() => {
    if (!grn) return;
    Alert.alert("Mark as Sent", "Mark this goods receipt as sent?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Mark Sent",
        onPress: () => updateMutation.mutate({ id: grn.id, status: "sent" }),
      },
    ]);
  }, [grn, updateMutation]);

  const handleConvert = useCallback(() => {
    if (!grn) return;
    Alert.alert(
      "Convert to Purchase Invoice",
      `Convert goods receipt ${grn.invoiceNumber} into a purchase invoice?\n\nNote: Stock will not be added again.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Convert",
          onPress: () =>
            convertMutation.mutate({
              sourceDocumentId: grn.id,
              targetDocumentType: "invoice",
            }),
        },
      ]
    );
  }, [grn, convertMutation]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.headerBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.screenTitle}>Goods Receipt</Text>
          <View style={{ width: 44 }} />
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      </SafeAreaView>
    );
  }

  if (isError || !grn) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.headerBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.screenTitle}>Goods Receipt</Text>
          <View style={{ width: 44 }} />
        </View>
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.danger} />
          <Text style={styles.errorText}>Failed to load goods receipt</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const isMutating = updateMutation.isPending || convertMutation.isPending;
  const canConvert = grn.status !== "cancelled";

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.screenTitle}>Goods Receipt</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header card */}
        <View style={styles.docCard}>
          <View style={styles.docCardTop}>
            <View style={styles.docNumberWrap}>
              <Ionicons name="download-outline" size={18} color={colors.brand} style={styles.docIcon} />
              <Text style={styles.docNumber}>{grn.invoiceNumber}</Text>
            </View>
            <StatusBadge status={grn.status} />
          </View>
          <Text style={styles.partyName}>{grn.party?.name}</Text>
          <Text style={styles.docDate}>{formatDate(grn.invoiceDate)}</Text>
        </View>

        {/* Info box */}
        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={16} color={colors.warning} />
          <Text style={styles.infoText}>Stock came in when this goods receipt was recorded. A bill made from it won't add it again.</Text>
        </View>

        {/* Amount summary */}
        <Text style={styles.sectionLabel}>Summary</Text>
        <View style={styles.totalsCard}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>{formatCurrency(grn.subtotal)}</Text>
          </View>
          {parseFloat(grn.totalAmount) - parseFloat(grn.subtotal) > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Tax</Text>
              <Text style={styles.totalValue}>{formatCurrency(parseFloat(grn.totalAmount) - parseFloat(grn.subtotal))}</Text>
            </View>
          )}
          <View style={styles.totalDivider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabelBold}>Total</Text>
            <Text style={styles.totalValueBold}>{formatCurrency(grn.totalAmount)}</Text>
          </View>
        </View>

        {/* Line items */}
        {grn.lineItems && grn.lineItems.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Items</Text>
            <View style={styles.lineItemsCard}>
              {grn.lineItems.map((li: any, idx: number) => (
                <View key={li.id ?? idx} style={[styles.lineItem, idx < grn.lineItems.length - 1 && styles.lineItemBorder]}>
                  <View style={styles.lineItemLeft}>
                    {/* Bug B: primary display is itemName; description is
                        the optional italic notes line beneath. */}
                    <Text style={styles.lineItemName} numberOfLines={2}>{li.itemName}</Text>
                    {li.description && li.description.trim().length > 0 && (
                      <Text style={styles.lineItemNotes} numberOfLines={3}>{li.description}</Text>
                    )}
                    {li.batch ? (
                      <View style={styles.batchRow} testID="grn-line-batch">
                        <Text style={styles.lineItemMeta}>
                          Batch {li.batch.batchNumber} · {expiryLabel(li.batch)}
                        </Text>
                        <ExpiryBadge batch={batchDays(li.batch.expiryDate)} />
                      </View>
                    ) : null}
                    <Text style={styles.lineItemMeta}>
                      {li.quantity} x {formatCurrency(li.unitPrice)}
                      {parseFloat(li.taxPercent ?? "0") > 0 ? ` + ${li.taxPercent}% GST` : ""}
                    </Text>
                  </View>
                  <Text style={styles.lineItemAmount}>{formatCurrency(li.amount)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Notes */}
        {grn.notes ? (
          <>
            <Text style={styles.sectionLabel}>Notes</Text>
            <View style={styles.notesCard}>
              <Text style={styles.notesText}>{grn.notes}</Text>
            </View>
          </>
        ) : null}

        {/* Actions */}
        <Text style={styles.sectionLabel}>Actions</Text>
        <View style={styles.actionsCard}>
          {grn.status === "draft" && (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={handleMarkSent}
              activeOpacity={0.7}
              disabled={isMutating}
            >
              <Ionicons name="send-outline" size={18} color={colors.brand} />
              <Text style={styles.actionBtnText}>Mark as Sent</Text>
              {updateMutation.isPending && <ActivityIndicator size="small" color={colors.brand} style={styles.actionSpinner} />}
            </TouchableOpacity>
          )}

          {canConvert && (
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnConvert]}
              onPress={handleConvert}
              activeOpacity={0.7}
              disabled={isMutating}
            >
              {convertMutation.isPending ? (
                <ActivityIndicator size="small" color={colors.onBrand} />
              ) : (
                <>
                  <Ionicons name="swap-horizontal-outline" size={18} color={colors.onBrand} />
                  <Text style={styles.actionBtnConvertText}>Convert to Purchase Invoice</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 32 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: 12,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  screenTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: "700",
    color: colors.textPrimary,
    textAlign: "center",
  },
  errorText: { fontSize: 16, color: colors.textSecondary, textAlign: "center" },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: colors.brand,
    borderRadius: 12,
  },
  retryBtnText: { fontSize: 14, fontWeight: "600", color: colors.onBrand },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 8,
  },
  docCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 6,
  },
  docCardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  docNumberWrap: { flexDirection: "row", alignItems: "center", gap: 8 },
  docIcon: {},
  docNumber: { fontSize: 16, fontWeight: "700", color: colors.textPrimary },
  partyName: { fontSize: 15, fontWeight: "600", color: colors.textSecondary },
  docDate: { fontSize: 12, color: colors.textMuted },
  infoBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.warningBg,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.warning + "30",
  },
  infoText: { fontSize: 12, color: colors.warning, flex: 1 },
  totalsCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5 },
  totalLabel: { fontSize: 14, color: colors.textSecondary },
  totalValue: { fontSize: 14, color: colors.textPrimary, fontWeight: "500" },
  totalDivider: { height: 1, backgroundColor: colors.border, marginVertical: 8 },
  totalLabelBold: { fontSize: 16, fontWeight: "700", color: colors.textPrimary },
  totalValueBold: { fontSize: 18, fontWeight: "700", color: colors.textPrimary },
  lineItemsCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  lineItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  lineItemBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  lineItemLeft: { flex: 1, paddingRight: 12 },
  lineItemName: { fontSize: 13, fontWeight: "600", color: colors.textPrimary },
  lineItemNotes: { fontSize: 11, fontStyle: "italic", color: colors.textSecondary, marginTop: 2, lineHeight: 14 },
  batchRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 2 },
  lineItemMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  lineItemAmount: { fontSize: 13, fontWeight: "700", color: colors.textPrimary },
  notesCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  notesText: { fontSize: 13, color: colors.textSecondary, lineHeight: 20 },
  actionsCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 12,
  },
  actionBtnText: { fontSize: 14, fontWeight: "600", color: colors.brand, flex: 1 },
  actionSpinner: { marginLeft: "auto" },
  actionBtnConvert: {
    backgroundColor: colors.brand,
    borderBottomWidth: 0,
    justifyContent: "center",
  },
  actionBtnConvertText: { fontSize: 14, fontWeight: "700", color: colors.onBrand, flex: 1 },
}));
