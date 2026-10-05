import { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../src/lib/trpc";
import { makeStyles } from "../../../src/lib/makeStyles";
import { useColors } from "../../../src/contexts/ThemeContext";
import { haptic } from "../../../src/lib/haptics";
import { GSTIN_REGEX, PAN_REGEX, panFromGstin, planGstinFill, type GstinDetails } from "@fintranzact/shared";
import { QueryError } from "../../../src/components/ui";

type PartyType = "customer" | "supplier";

export default function EditPartyScreen() {
  const styles = useStyles();
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();

  const { data: party, isLoading } = trpc.party.getById.useQuery(
    { id: id ?? "" },
    { enabled: !!id }
  );

  const [type, setType] = useState<PartyType>("customer");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [gstin, setGstin] = useState("");
  const [pan, setPan] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [doNotRemind, setDoNotRemind] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (party && !initialized) {
      setType((party.type as PartyType) ?? "customer");
      setName(party.name ?? "");
      setPhone(party.phone ?? "");
      setEmail(party.email ?? "");
      setGstin(party.gstin ?? "");
      setPan(party.pan ?? "");
      setBillingAddress(party.billingAddress ?? "");
      setCity(party.city ?? "");
      setState(party.state ?? "");
      setDoNotRemind(party.doNotRemind ?? false);
      setInitialized(true);
    }
  }, [party, initialized]);

  // Search the GST portal: empty fields are filled; a field that already differs is only replaced when confirmed.
  const [lookupNote, setLookupNote] = useState<{ text: string; tone: "ok" | "warn" | "muted" } | null>(null);
  const lastSearched = useRef("");
  const manualSearch = useRef(true);
  const lookup = trpc.party.lookupGstin.useMutation({
    onSuccess: (result) => {
      const manual = manualSearch.current;
      if (!result.available) {
        if (result.sandboxStatus === "not_configured") {
          if (manual) setLookupNote({ text: "GST search is not set up here, so nothing was fetched.", tone: "muted" });
        } else if (result.sandboxStatus === "unavailable") {
          setLookupNote({ text: "Could not reach the GST portal; you can still save.", tone: "warn" });
        } else {
          setLookupNote({ text: `${result.reason} You can still save.`, tone: "warn" });
        }
        return;
      }
      const d = result.details as GstinDetails;
      const plan = planGstinFill(d, { name, legalName: "", tradeName: "", billingAddress, city, state, stateCode: "", pincode: "", gstType: "", constitution: "" });
      // This screen edits only the name, address, city and state.
      const mine = new Set(["name", "billingAddress", "city", "state"]);
      const apply = (patch: Record<string, string | undefined>) => {
        if (patch.name !== undefined) setName(patch.name);
        if (patch.billingAddress !== undefined) setBillingAddress(patch.billingAddress);
        if (patch.city !== undefined) setCity(patch.city);
        if (patch.state !== undefined) setState(patch.state);
      };
      apply(Object.fromEntries(Object.entries(plan.fills).filter(([k]) => mine.has(k))));
      const label = result.profile?.statusRaw || d.gstinStatus || "";
      setLookupNote({
        text: `GST record found${d.legalName ? `: ${d.legalName}` : ""}${label ? ` (${label})` : ""}.${result.warnings.length ? ` ${result.warnings.join(" ")}` : ""}`,
        tone: result.warnings.length || (d.gstinStatus && d.gstinStatus !== "active") ? "warn" : "ok",
      });
      const conflicts = plan.conflicts.filter((c) => mine.has(c.key));
      if (conflicts.length && manual) {
        const patch = conflicts.reduce<Record<string, string | undefined>>((acc, c) => ({ ...acc, ...c.patch }), {});
        Alert.alert(
          "Use the GST record?",
          conflicts.map((c) => `${c.label}: yours "${c.current}", GST record "${c.incoming}"`).join("\n"),
          [
            { text: "Keep mine", style: "cancel" },
            { text: "Use GST record", onPress: () => apply(patch) },
          ],
        );
      }
    },
    onError: (error) => {
      setLookupNote({ text: error.data?.code === "TOO_MANY_REQUESTS" ? error.message : "Could not reach the GST portal; you can still save.", tone: "warn" });
    },
  });
  const searchGst = (manual: boolean) => {
    if (!GSTIN_REGEX.test(gstin)) return;
    lastSearched.current = gstin;
    manualSearch.current = manual;
    setLookupNote(null);
    lookup.mutate({ gstin });
  };

  const updateParty = trpc.party.update.useMutation({
    onSuccess: (updated) => {
      utils.party.list.invalidate();
      utils.party.getById.invalidate({ id: id ?? "" });
      // The party is saved either way; a GSTIN note is advisory only.
      const note = updated?.gstinCheck?.warning;
      if (note && updated.gstinCheck?.status !== "not_configured") Alert.alert("GSTIN note", note, [{ text: "OK", onPress: () => router.back() }]);
      else router.back();
    },
    onError: (error) => {
      Alert.alert("Error", error.message || "Failed to update party");
    },
  });

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = "Name is required";
    if (phone && !/^\d{7,15}$/.test(phone.replace(/[\s+\-()]/g, ""))) {
      newErrors.phone = "Enter a valid phone number";
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = "Enter a valid email";
    }
    if (gstin && !GSTIN_REGEX.test(gstin)) {
      newErrors.gstin = "Enter a valid GSTIN";
    }
    if (pan && !PAN_REGEX.test(pan)) {
      newErrors.pan = "Enter a valid PAN";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    haptic.success();
    updateParty.mutate({
      id: id ?? "",
      data: {
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        gstin: gstin.trim() || undefined,
        pan: pan.trim() || undefined,
        billingAddress: billingAddress.trim() || undefined,
        city: city.trim() || undefined,
        state: state.trim() || undefined,
        doNotRemind,
      },
    });
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (!party) {
    return (
      <SafeAreaView style={styles.container}>
        <QueryError message="Party not found" onRetry={() => {}} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Party</Text>
          <TouchableOpacity
            style={[
              styles.saveButton,
              updateParty.isPending && styles.saveButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={updateParty.isPending}
            activeOpacity={0.8}
          >
            {updateParty.isPending ? (
              <ActivityIndicator size="small" color={colors.onBrand} />
            ) : (
              <Text style={styles.saveButtonText}>Save</Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Type Toggle */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Party Type</Text>
            <View style={styles.typeToggle}>
              <TouchableOpacity
                style={[
                  styles.typeOption,
                  type === "customer" && styles.typeOptionActive,
                ]}
                onPress={() => setType("customer")}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="person-outline"
                  size={18}
                  color={type === "customer" ? colors.textPrimary : colors.textMuted}
                />
                <Text
                  style={[
                    styles.typeOptionText,
                    type === "customer" && styles.typeOptionTextActive,
                  ]}
                >
                  Customer
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.typeOption,
                  type === "supplier" && styles.typeOptionActive,
                ]}
                onPress={() => setType("supplier")}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="business-outline"
                  size={18}
                  color={type === "supplier" ? colors.textPrimary : colors.textMuted}
                />
                <Text
                  style={[
                    styles.typeOptionText,
                    type === "supplier" && styles.typeOptionTextActive,
                  ]}
                >
                  Supplier
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Basic Info */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Basic Information</Text>
            <View style={styles.card}>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>
                  Name <Text style={styles.required}>*</Text>
                </Text>
                <TextInput
                  style={[styles.input, errors.name && styles.inputError]}
                  placeholder={`${type === "customer" ? "Customer" : "Supplier"} name`}
                  placeholderTextColor={colors.textMuted}
                  value={name}
                  onChangeText={(t) => {
                    setName(t);
                    if (errors.name) setErrors((e) => ({ ...e, name: "" }));
                  }}
                  autoCapitalize="words"
                />
                {errors.name && (
                  <Text style={styles.errorText}>{errors.name}</Text>
                )}
              </View>

              <View style={styles.fieldDivider} />

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Phone</Text>
                <TextInput
                  style={[styles.input, errors.phone && styles.inputError]}
                  placeholder="Mobile number"
                  placeholderTextColor={colors.textMuted}
                  value={phone}
                  onChangeText={(t) => {
                    setPhone(t);
                    if (errors.phone) setErrors((e) => ({ ...e, phone: "" }));
                  }}
                  keyboardType="phone-pad"
                  autoCorrect={false}
                />
                {errors.phone && (
                  <Text style={styles.errorText}>{errors.phone}</Text>
                )}
              </View>

              <View style={styles.fieldDivider} />

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Email</Text>
                <TextInput
                  style={[styles.input, errors.email && styles.inputError]}
                  placeholder="email@example.com"
                  placeholderTextColor={colors.textMuted}
                  value={email}
                  onChangeText={(t) => {
                    setEmail(t);
                    if (errors.email) setErrors((e) => ({ ...e, email: "" }));
                  }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {errors.email && (
                  <Text style={styles.errorText}>{errors.email}</Text>
                )}
              </View>
            </View>
          </View>

          {/* Tax Info */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Tax Information</Text>
            <View style={styles.card}>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>GSTIN</Text>
                <TextInput
                  style={[styles.input, errors.gstin && styles.inputError]}
                  placeholder="22AAAAA0000A1Z5"
                  placeholderTextColor={colors.textMuted}
                  value={gstin}
                  onChangeText={(t) => {
                    const next = t.toUpperCase().replace(/[^A-Z0-9]/g, "");
                    // Characters 3-12 of a GSTIN are the PAN. Fill it in
                    // unless the user already typed a different PAN.
                    const detected = panFromGstin(next);
                    if (detected && (!pan || pan === panFromGstin(gstin))) {
                      setPan(detected);
                    }
                    setGstin(next);
                    setLookupNote(null);
                    if (errors.gstin) setErrors((e) => ({ ...e, gstin: "" }));
                  }}
                  onBlur={() => {
                    // A GSTIN already on the saved party is not searched again on open.
                    if (GSTIN_REGEX.test(gstin) && gstin !== (party?.gstin ?? "") && gstin !== lastSearched.current && !lookup.isPending) searchGst(false);
                  }}
                  autoCapitalize="characters"
                  maxLength={15}
                />
                {errors.gstin && (
                  <Text style={styles.errorText}>{errors.gstin}</Text>
                )}
                <TouchableOpacity
                  style={[styles.linkButton, (!GSTIN_REGEX.test(gstin) || lookup.isPending) && { opacity: 0.5 }]}
                  onPress={() => searchGst(true)}
                  disabled={!GSTIN_REGEX.test(gstin) || lookup.isPending}
                  accessibilityRole="button"
                >
                  {lookup.isPending
                    ? <ActivityIndicator size="small" color={colors.brand} />
                    : <Text style={styles.linkButtonText}>Search GST</Text>}
                </TouchableOpacity>
                {lookupNote && (
                  <Text
                    accessibilityLiveRegion="polite"
                    style={[styles.hint, { color: lookupNote.tone === "warn" ? colors.danger : lookupNote.tone === "ok" ? colors.success : colors.textMuted }]}
                  >
                    {lookupNote.text}
                  </Text>
                )}
              </View>

              <View style={styles.fieldDivider} />

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>PAN</Text>
                <TextInput
                  style={[styles.input, errors.pan && styles.inputError]}
                  placeholder="AAAAA0000A"
                  placeholderTextColor={colors.textMuted}
                  value={pan}
                  onChangeText={(t) => {
                    setPan(t.toUpperCase().replace(/[^A-Z0-9]/g, ""));
                    if (errors.pan) setErrors((e) => ({ ...e, pan: "" }));
                  }}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={10}
                />
                {errors.pan && (
                  <Text style={styles.errorText}>{errors.pan}</Text>
                )}
              </View>
            </View>
          </View>

          {/* Address */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Address</Text>
            <View style={styles.card}>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Billing Address</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Street address"
                  placeholderTextColor={colors.textMuted}
                  value={billingAddress}
                  onChangeText={setBillingAddress}
                  multiline
                  numberOfLines={3}
                />
              </View>

              <View style={styles.fieldDivider} />

              <View style={styles.fieldRow}>
                <View style={[styles.fieldGroup, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>City</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="City"
                    placeholderTextColor={colors.textMuted}
                    value={city}
                    onChangeText={setCity}
                    autoCapitalize="words"
                  />
                </View>
                <View style={styles.fieldRowDivider} />
                <View style={[styles.fieldGroup, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>State</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="State"
                    placeholderTextColor={colors.textMuted}
                    value={state}
                    onChangeText={setState}
                    autoCapitalize="words"
                  />
                </View>
              </View>
            </View>
          </View>

          {/* Payment reminders */}
          {type === "customer" && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Payment Reminders</Text>
              <View style={styles.card}>
                <TouchableOpacity
                  style={[styles.fieldGroup, styles.toggleRow]}
                  onPress={() => setDoNotRemind((v) => !v)}
                  accessibilityRole="checkbox"
                  accessibilityLabel="Do not remind"
                  accessibilityState={{ checked: doNotRemind }}
                >
                  <Ionicons name={doNotRemind ? "checkbox" : "square-outline"} size={20} color={doNotRemind ? colors.brand : colors.textMuted} />
                  <Text style={styles.toggleText}>Do not remind this customer</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  toggleText: { fontSize: 15, color: colors.textPrimary },
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  saveButton: {
    backgroundColor: colors.brand,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    minWidth: 72,
    alignItems: "center",
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.onBrand,
  },
  scrollView: {
    flex: 1,
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 10,
  },
  typeToggle: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeOption: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 9,
    gap: 8,
  },
  typeOptionActive: {
    backgroundColor: colors.brand,
  },
  typeOptionText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.textMuted,
  },
  typeOptionTextActive: {
    color: colors.onBrand,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
  },
  fieldGroup: {
    paddingVertical: 12,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textSecondary,
    marginBottom: 6,
  },
  required: {
    color: colors.danger,
  },
  input: {
    fontSize: 15,
    color: colors.textPrimary,
    padding: 0,
  },
  inputError: {
    color: colors.danger,
  },
  textArea: {
    height: 72,
    textAlignVertical: "top",
  },
  errorText: {
    fontSize: 12,
    color: colors.danger,
    marginTop: 4,
  },
  linkButton: {
    marginTop: 10,
    alignSelf: "flex-start",
    paddingVertical: 6,
  },
  linkButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.brand,
  },
  hint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 8,
  },
  fieldDivider: {
    height: 1,
    backgroundColor: colors.border,
  },
  fieldRow: {
    flexDirection: "row",
    paddingVertical: 12,
  },
  fieldRowDivider: {
    width: 1,
    backgroundColor: colors.border,
    marginHorizontal: 16,
  },
}));
