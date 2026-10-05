import { useMemo, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, Modal, ScrollView, Switch } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../lib/trpc";
import { makeStyles } from "../lib/makeStyles";
import { useColors } from "../contexts/ThemeContext";
import { useFeature } from "../hooks/useFeature";
import { FeatureNotice } from "./FeatureNotice";
import { DatePickerField } from "./ui/DatePickerField";
import { formatDate } from "../lib/utils";
import {
  expiryStatus,
  expiryWarning,
  fefoPreview,
  formatQty,
  fromDateOnly,
  outwardBatchError,
  sortBatchesFefo,
  toDateOnly,
  batchOutListInput,
  type BatchInValue,
  type BatchOutValue,
  type BatchRow,
} from "../lib/batches";

/** "exp 12 Oct 2026", "expired 3 Sep 2026" or "no expiry". */
export function expiryLabel(b: { expiryDate: string | null; expired?: boolean }) {
  if (!b.expiryDate) return "no expiry";
  return `${b.expired ? "expired" : "exp"} ${formatDate(b.expiryDate)}`;
}

/** Red "Expired 3d ago" / amber "12d left" pill; nothing for a batch that is fine. */
export function ExpiryBadge({ batch }: { batch: { expired?: boolean; daysToExpiry: number | null } }) {
  const s = useS();
  const text = expiryWarning(batch);
  if (!text) return null;
  const expired = expiryStatus(batch) === "expired";
  return (
    <View style={[s.badge, expired ? s.badgeExpired : s.badgeNear]} testID={expired ? "expiry-badge-expired" : "expiry-badge-near"}>
      <Text style={[s.badgeText, expired ? s.textDanger : s.textWarning]}>{text}</Text>
    </View>
  );
}

// ── Inward ─────────────────────────────────────────────────────

interface BatchInFieldsProps {
  itemId: string;
  variantId?: string;
  trackExpiry: boolean;
  value: BatchInValue;
  onChange: (patch: BatchInValue) => void;
}

/** Batch number, expiry and manufacturing date for a line that brings batch-tracked stock in. */
export function BatchInFields({ itemId, variantId, trackExpiry, value, onChange }: BatchInFieldsProps) {
  const s = useS();
  const colors = useColors();
  const { data } = trpc.batch.list.useQuery(
    { itemId, variantId: variantId ?? null, includeEmpty: true },
    { staleTime: 15_000 },
  );
  const batches = sortBatchesFefo((data?.data ?? []) as BatchRow[]);
  const typed = value.batchNumber?.trim() ?? "";
  const existing = batches.find((b) => b.batchNumber === typed);
  const suggestions = typed
    ? batches.filter((b) => b.batchNumber !== typed && b.batchNumber.toLowerCase().includes(typed.toLowerCase())).slice(0, 4)
    : batches.slice(0, 4);

  function pick(b: BatchRow) {
    // An existing batch brings its dates along.
    onChange({ batchNumber: b.batchNumber, mfgDate: b.mfgDate ?? "", expiryDate: b.expiryDate ?? "", batchMrp: b.mrp ?? "" });
  }
  function setNumber(batchNumber: string) {
    const match = batches.find((b) => b.batchNumber === batchNumber.trim());
    if (match) pick({ ...match, batchNumber });
    else onChange({ batchNumber });
  }

  const datesBackwards = !!value.mfgDate && !!value.expiryDate && value.expiryDate < value.mfgDate;

  return (
    <View style={s.box} testID="batch-in-fields">
      <Text style={s.title}>Batch</Text>
      <Text style={s.fieldLabel}>Batch no.{" *"}</Text>
      <TextInput
        style={s.input}
        value={value.batchNumber ?? ""}
        onChangeText={setNumber}
        placeholder="e.g. B2407"
        placeholderTextColor={colors.textMuted}
        maxLength={60}
        autoCapitalize="characters"
        autoCorrect={false}
        testID="batch-number-input"
        accessibilityLabel="Batch number"
      />
      {existing ? (
        <Text style={s.hint} testID="batch-existing-note">
          Existing batch · {formatQty(existing.quantity)} in stock · {expiryLabel(existing)}
        </Text>
      ) : suggestions.length > 0 ? (
        <View style={s.chipRow}>
          {suggestions.map((b) => (
            <TouchableOpacity
              key={b.id}
              style={s.chip}
              onPress={() => pick(b)}
              accessibilityRole="button"
              accessibilityLabel={`Use batch ${b.batchNumber}`}
            >
              <Text style={s.chipText}>{b.batchNumber}</Text>
              <Text style={s.chipSub}>{expiryLabel(b)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
      <View style={s.dateRow}>
        <View style={s.dateCol}>
          <DatePickerField
            label={trackExpiry ? "Expiry *" : "Expiry"}
            value={fromDateOnly(value.expiryDate)}
            onChange={(d) => onChange({ expiryDate: toDateOnly(d) })}
            onClear={() => onChange({ expiryDate: "" })}
            testID="batch-expiry-field"
          />
        </View>
        <View style={s.dateCol}>
          <DatePickerField
            label="Mfg date"
            value={fromDateOnly(value.mfgDate)}
            onChange={(d) => onChange({ mfgDate: toDateOnly(d) })}
            onClear={() => onChange({ mfgDate: "" })}
            testID="batch-mfg-field"
          />
        </View>
      </View>
      {datesBackwards ? (
        <Text style={s.error} accessibilityRole="alert" testID="batch-date-error">Expiry must be after the manufacturing date</Text>
      ) : null}
      {value.expiryDate ? <BatchDateWarning expiryDate={value.expiryDate} /> : null}
    </View>
  );
}

/** Warning under an inward expiry date that is already past or close. */
function BatchDateWarning({ expiryDate }: { expiryDate: string }) {
  const s = useS();
  const expiry = fromDateOnly(expiryDate);
  if (!expiry) return null;
  const today = fromDateOnly(toDateOnly(new Date()))!;
  const days = Math.round((expiry.getTime() - today.getTime()) / 86_400_000);
  const text = expiryWarning({ daysToExpiry: days });
  if (!text) return null;
  const expired = days < 0;
  return (
    <Text style={[s.hint, expired ? s.textDanger : s.textWarning]} testID="batch-expiry-warning">
      {expired ? "This batch has already expired" : `Near expiry: ${text}`}
    </Text>
  );
}

// ── Outward ────────────────────────────────────────────────────

interface BatchOutPickerProps {
  itemId: string;
  variantId?: string;
  /** Document date (YYYY-MM-DD): a batch counts as expired after its expiry. */
  date: string;
  /** Quantity the line takes, in the item's base unit. */
  needed: number;
  unit?: string | null;
  value: BatchOutValue;
  onChange: (patch: BatchOutValue) => void;
}

/** Pick which batch a line sells from; "Earliest expiry first" lets the server split it (FEFO). */
export function BatchOutPicker({ itemId, variantId, date, needed, unit, value, onChange }: BatchOutPickerProps) {
  const s = useS();
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const { data, isLoading } = trpc.batch.list.useQuery(batchOutListInput(itemId, variantId, date), { staleTime: 15_000 });
  const batches = useMemo(() => sortBatchesFefo((data?.data ?? []) as BatchRow[]), [data]);
  const picked = batches.find((b) => b.id === value.batchId);
  const preview = useMemo(() => fefoPreview(batches, needed), [batches, needed]);
  const hasExpired = batches.some((b) => b.expired);
  const pickedError = outwardBatchError(value, batches, needed);
  const firstPiece = !value.batchId ? batches.find((b) => preview.pieces[0]?.batchNumber === b.batchNumber) : undefined;

  return (
    <View style={s.box} testID="batch-out-picker">
      <Text style={s.title}>Batch</Text>
      <TouchableOpacity
        style={s.selector}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Choose batch"
        testID="batch-out-select"
      >
        <View style={s.selectorBody}>
          <Text style={s.selectorValue} numberOfLines={1}>
            {picked ? picked.batchNumber : "Earliest expiry first"}
          </Text>
          <Text style={s.selectorSub} numberOfLines={2}>
            {picked
              ? `${expiryLabel(picked)} · ${formatQty(picked.quantity, unit)} left`
              : isLoading
                ? "Loading batches…"
                : preview.pieces.length > 0
                  ? preview.pieces.map((p) => `${p.batchNumber} × ${formatQty(p.quantity)}`).join(", ")
                  : "No unexpired batch in stock"}
          </Text>
        </View>
        {picked ? <ExpiryBadge batch={picked} /> : firstPiece ? <ExpiryBadge batch={firstPiece} /> : null}
        <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
      </TouchableOpacity>
      {!value.batchId && preview.short > 0.0005 && batches.length > 0 ? (
        <Text style={s.error} accessibilityRole="alert" testID="batch-short-warning">
          Unexpired batches are {formatQty(preview.short, unit)} short
        </Text>
      ) : null}
      {pickedError ? (
        <Text style={s.error} accessibilityRole="alert" testID="batch-picked-error">{pickedError}</Text>
      ) : null}

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <View style={s.sheetHeader}>
              <Text style={s.sheetTitle}>Choose batch</Text>
              <TouchableOpacity onPress={() => setOpen(false)} style={s.closeBtn} accessibilityLabel="Close batch picker">
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={s.sheetList} keyboardShouldPersistTaps="handled">
              <TouchableOpacity
                style={[s.row, !value.batchId && s.rowActive]}
                onPress={() => {
                  onChange({ batchId: "", allowExpired: false });
                  setOpen(false);
                }}
                accessibilityRole="button"
                accessibilityLabel="Earliest expiry first"
              >
                <View style={s.rowBody}>
                  <Text style={s.rowTitle}>Earliest expiry first</Text>
                  <Text style={s.rowSub}>
                    {preview.pieces.length > 0
                      ? preview.pieces.map((p) => `${p.batchNumber} × ${formatQty(p.quantity)}`).join(", ")
                      : "No unexpired batch in stock"}
                  </Text>
                </View>
              </TouchableOpacity>
              {batches.length === 0 && !isLoading ? <Text style={s.empty}>No batches in stock for this item.</Text> : null}
              {batches.map((b) => {
                const short = needed - parseFloat(b.quantity) > 0.0005;
                const blockedByExpiry = b.expired && !value.allowExpired && value.batchId !== b.id;
                const disabled = short || blockedByExpiry;
                return (
                  <TouchableOpacity
                    key={b.id}
                    style={[s.row, value.batchId === b.id && s.rowActive, disabled && s.rowDisabled]}
                    disabled={disabled}
                    onPress={() => {
                      onChange({ batchId: b.id, allowExpired: b.expired ? true : false });
                      setOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ disabled }}
                    accessibilityLabel={`Batch ${b.batchNumber}, ${formatQty(b.quantity, unit)} left, ${expiryLabel(b)}`}
                    testID={`batch-option-${b.batchNumber}`}
                  >
                    <View style={s.rowBody}>
                      <Text style={s.rowTitle}>{b.batchNumber}</Text>
                      <Text style={s.rowSub}>
                        {expiryLabel(b)} · {formatQty(b.quantity, unit)} left{b.mrp ? ` · MRP ₹${b.mrp}` : ""}
                      </Text>
                      {short && !blockedByExpiry ? (
                        <Text style={s.rowNote}>Only {formatQty(b.quantity, unit)} left; this line needs {formatQty(needed, unit)}</Text>
                      ) : null}
                      {blockedByExpiry ? <Text style={s.rowNote}>Expired: allow expired stock to use it</Text> : null}
                    </View>
                    <ExpiryBadge batch={b} />
                  </TouchableOpacity>
                );
              })}
              {hasExpired ? (
                <View style={s.switchRow}>
                  <Text style={s.rowSub}>Allow expired stock</Text>
                  <Switch
                    value={!!value.allowExpired}
                    onValueChange={(v) => onChange({ allowExpired: v, ...(!v && picked?.expired ? { batchId: "" } : {}) })}
                    accessibilityLabel="Allow expired stock"
                    testID="allow-expired-switch"
                  />
                </View>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Gate + switch ──────────────────────────────────────────────

interface BatchLineFieldsProps {
  direction: "in" | "out";
  itemId: string;
  variantId?: string;
  trackExpiry: boolean;
  /** Document date, YYYY-MM-DD (outward). */
  date: string;
  /** Line quantity in the base unit (outward). */
  needed: number;
  unit?: string | null;
  batchIn?: BatchInValue;
  batchOut?: BatchOutValue;
  onBatchIn: (patch: BatchInValue) => void;
  onBatchOut: (patch: BatchOutValue) => void;
}

/**
 * The batch block of a line of a batch-tracked item. Without the plan's
 * batches-and-expiry feature it shows the shared plan notice and no fields
 * (nothing batch-related is sent); while billing status loads it counts as
 * allowed.
 */
export function BatchLineFields(p: BatchLineFieldsProps) {
  const s = useS();
  const feature = useFeature("batchesExpiry");
  if (!feature.allowed) {
    return (
      <View testID="batch-plan-note">
        <FeatureNotice flag="batchesExpiry" />
        <Text style={[s.hint, s.planHint]}>
          {p.direction === "out"
            ? "Batches are picked for you, earliest expiry first."
            : "Batch details can't be recorded on this plan."}
        </Text>
      </View>
    );
  }
  return p.direction === "in" ? (
    <BatchInFields itemId={p.itemId} variantId={p.variantId} trackExpiry={p.trackExpiry} value={p.batchIn ?? {}} onChange={p.onBatchIn} />
  ) : (
    <BatchOutPicker itemId={p.itemId} variantId={p.variantId} date={p.date} needed={p.needed} unit={p.unit} value={p.batchOut ?? {}} onChange={p.onBatchOut} />
  );
}

const useS = makeStyles((colors) => ({
  box: { backgroundColor: colors.bg, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 10, marginBottom: 10, gap: 6 },
  title: { fontSize: 11, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  fieldLabel: { fontSize: 10, color: colors.textMuted, fontWeight: "500" },
  input: { backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: colors.textPrimary },
  hint: { fontSize: 12, color: colors.textMuted },
  planHint: { marginHorizontal: 16, marginBottom: 8 },
  error: { fontSize: 12, color: colors.danger },
  textDanger: { color: colors.danger },
  textWarning: { color: colors.warning },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 8, paddingVertical: 4, minHeight: 36, justifyContent: "center" },
  chipText: { fontSize: 12, fontWeight: "600", color: colors.textPrimary },
  chipSub: { fontSize: 10, color: colors.textMuted },
  dateRow: { flexDirection: "row", gap: 8 },
  dateCol: { flex: 1 },
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeExpired: { backgroundColor: colors.dangerBg },
  badgeNear: { backgroundColor: colors.warningBg },
  badgeText: { fontSize: 11, fontWeight: "700" },
  selector: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 8, minHeight: 44 },
  selectorBody: { flex: 1 },
  selectorValue: { fontSize: 13, fontWeight: "600", color: colors.textPrimary },
  selectorSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: colors.border, maxHeight: "80%", paddingBottom: 32 },
  sheetHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 },
  sheetTitle: { flex: 1, fontSize: 17, fontWeight: "700", color: colors.textPrimary },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  sheetList: { paddingHorizontal: 16, paddingBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, minHeight: 48 },
  rowActive: { backgroundColor: colors.brand + "12" },
  rowDisabled: { opacity: 0.5 },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  rowSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  rowNote: { fontSize: 11, color: colors.danger, marginTop: 2 },
  empty: { textAlign: "center", paddingVertical: 24, fontSize: 14, color: colors.textMuted },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12 },
}));
