import { useState, useRef } from "react";
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
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { trpc } from "../../../src/lib/trpc";
import { makeStyles } from "../../../src/lib/makeStyles";
import { useColors } from "../../../src/contexts/ThemeContext";
import { haptic } from "../../../src/lib/haptics";
import {
  GSTIN_REGEX,
  PAN_REGEX,
  IFSC_REGEX,
  UDYAM_REGEX,
  panFromGstin,
  stateCodeFromGstin,
  constitutionFromPan,
  partyGstTypes,
  partyGstTypeLabels,
  partyConstitutions,
  partyConstitutionLabels,
  msmeCategories,
  tdsSections,
  tdsRateFor,
  partyComplianceWarnings,
  type PartyGstType,
  type PartyConstitution,
  type MsmeCategory,
  type GstinStatus,
} from "@fintranzact/shared";

interface ShippingDraft {
  label: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
}

/** A row of tappable options; tapping the selected one clears it. */
function Chips<T extends string>({
  options,
  value,
  onChange,
  labelFor,
}: {
  options: readonly T[];
  value: T | "";
  onChange: (next: T | "") => void;
  labelFor: (option: T) => string;
}) {
  const styles = useStyles();
  return (
    <View style={styles.chips}>
      {options.map((option) => {
        const selected = option === value;
        return (
          <TouchableOpacity
            key={option}
            style={[styles.chip, selected && styles.chipActive]}
            onPress={() => onChange(selected ? "" : option)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ selected }}
          >
            <Text style={[styles.chipText, selected && styles.chipTextActive]}>{labelFor(option)}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

type PartyType = "customer" | "supplier";

export default function CreatePartyScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const utils = trpc.useUtils();

  const [type, setType] = useState<PartyType>("customer");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [gstin, setGstin] = useState("");
  const [pan, setPan] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [legalName, setLegalName] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [gstType, setGstType] = useState<PartyGstType | "">("");
  const [constitution, setConstitution] = useState<PartyConstitution | "">("");
  const [gstinStatus, setGstinStatus] = useState<GstinStatus | null>(null);
  const [gstinVerifiedAt, setGstinVerifiedAt] = useState<string | null>(null);
  const [isMsme, setIsMsme] = useState(false);
  const [udyamNumber, setUdyamNumber] = useState("");
  const [msmeCategory, setMsmeCategory] = useState<MsmeCategory | "">("");
  const [tdsSection, setTdsSection] = useState("");
  const [bankIfsc, setBankIfsc] = useState("");
  const [shipping, setShipping] = useState<ShippingDraft[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const applyGstinDerived = (value: string, currentPan: string) => {
    const detectedPan = panFromGstin(value);
    if (detectedPan && (!currentPan || currentPan === panFromGstin(gstin))) setPan(detectedPan);
    const detectedState = stateCodeFromGstin(value);
    if (detectedState) setStateCode(detectedState);
    const detectedConstitution = constitutionFromPan(detectedPan);
    if (detectedConstitution && !constitution) setConstitution(detectedConstitution);
    if (detectedState && !gstType) setGstType("regular");
  };

  const lookup = trpc.party.lookupGstin.useMutation({
    onSuccess: (result) => {
      if (!result.available) {
        applyGstinDerived(result.derived.gstin, pan);
        Alert.alert("GST lookup not set up", result.reason);
        return;
      }
      const d = result.details;
      applyGstinDerived(d.gstin, pan);
      if (d.legalName) setLegalName(d.legalName);
      if (d.tradeName) setTradeName(d.tradeName);
      if (!name.trim()) setName(d.tradeName || d.legalName || "");
      if (d.billingAddress && !billingAddress) setBillingAddress(d.billingAddress);
      if (d.city && !city) setCity(d.city);
      if (d.gstRegistrationType) setGstType(d.gstRegistrationType);
      if (d.constitution) setConstitution(d.constitution);
      setGstinStatus(d.gstinStatus);
      setGstinVerifiedAt(result.verifiedAt);
      if (d.gstinStatus && d.gstinStatus !== "active") {
        Alert.alert("Check this GSTIN", `The GSTIN is ${d.gstinStatus}.`);
      }
    },
    onError: (error) => Alert.alert("GST lookup failed", error.message),
  });

  const warnings = partyComplianceWarnings({
    type, gstin, pan, stateCode, gstRegistrationType: gstType, gstinStatus, isMsme, udyamNumber, tdsSection,
  });
  const tdsRate = tdsRateFor({ tdsSection, pan, gstin, constitution });

  const phoneRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const gstinRef = useRef<TextInput>(null);
  const panRef = useRef<TextInput>(null);
  const addressRef = useRef<TextInput>(null);
  const cityRef = useRef<TextInput>(null);
  const stateRef = useRef<TextInput>(null);

  const createParty = trpc.party.create.useMutation({
    onSuccess: () => {
      utils.party.list.invalidate();
      router.back();
    },
    onError: (error) => {
      Alert.alert("Error", error.message || "Failed to create party");
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
    if (bankIfsc && !IFSC_REGEX.test(bankIfsc)) {
      newErrors.bankIfsc = "Enter a valid IFSC (e.g. HDFC0001234)";
    }
    if (isMsme && udyamNumber && !UDYAM_REGEX.test(udyamNumber)) {
      newErrors.udyamNumber = "Enter a valid Udyam number (UDYAM-MH-26-0012345)";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    haptic.success();
    createParty.mutate({
      type,
      name: name.trim(),
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      gstin: gstin.trim() || undefined,
      pan: pan.trim() || undefined,
      billingAddress: billingAddress.trim() || undefined,
      city: city.trim() || undefined,
      state: state.trim() || undefined,
      stateCode: stateCode || undefined,
      openingBalance: "0",
      legalName: legalName.trim() || undefined,
      tradeName: tradeName.trim() || undefined,
      gstRegistrationType: gstType || undefined,
      constitution: constitution || undefined,
      gstinStatus: gstinStatus ?? undefined,
      gstinVerifiedAt: gstinVerifiedAt ?? undefined,
      isMsme,
      udyamNumber: isMsme ? udyamNumber || undefined : undefined,
      msmeCategory: isMsme ? msmeCategory || undefined : undefined,
      tdsSection: tdsSection || undefined,
      bankIfsc: bankIfsc || undefined,
      additionalShippingAddresses: shipping.some((a) => a.address.trim())
        ? shipping
          .filter((a) => a.address.trim())
          .map((a) => ({
            label: a.label.trim() || undefined,
            address: a.address.trim(),
            city: a.city.trim() || undefined,
            state: a.state.trim() || undefined,
            pincode: a.pincode.trim() || undefined,
          }))
        : undefined,
    });
  };

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
          <Text style={styles.headerTitle}>New Party</Text>
          <TouchableOpacity
            style={[
              styles.saveButton,
              createParty.isPending && styles.saveButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={createParty.isPending}
            activeOpacity={0.8}
          >
            {createParty.isPending ? (
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
                  returnKeyType="next"
                  onSubmitEditing={() => phoneRef.current?.focus()}
                  blurOnSubmit={false}
                />
                {errors.name && (
                  <Text style={styles.errorText}>{errors.name}</Text>
                )}
              </View>

              <View style={styles.fieldDivider} />

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Phone</Text>
                <TextInput
                  ref={phoneRef}
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
                  returnKeyType="next"
                  onSubmitEditing={() => emailRef.current?.focus()}
                  blurOnSubmit={false}
                />
                {errors.phone && (
                  <Text style={styles.errorText}>{errors.phone}</Text>
                )}
              </View>

              <View style={styles.fieldDivider} />

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Email</Text>
                <TextInput
                  ref={emailRef}
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
                  returnKeyType="next"
                  onSubmitEditing={() => gstinRef.current?.focus()}
                  blurOnSubmit={false}
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
                  ref={gstinRef}
                  style={[styles.input, errors.gstin && styles.inputError]}
                  placeholder="22AAAAA0000A1Z5"
                  placeholderTextColor={colors.textMuted}
                  value={gstin}
                  onChangeText={(t) => {
                    const next = t.toUpperCase().replace(/[^A-Z0-9]/g, "");
                    // Characters 3-12 of a GSTIN are the PAN. Fill it in
                    // unless the user already typed a different PAN.
                    if (GSTIN_REGEX.test(next)) applyGstinDerived(next, pan);
                    if (gstinStatus) {
                      setGstinStatus(null);
                      setGstinVerifiedAt(null);
                    }
                    setGstin(next);
                    if (errors.gstin) setErrors((e) => ({ ...e, gstin: "" }));
                  }}
                  autoCapitalize="characters"
                  maxLength={15}
                  returnKeyType="next"
                  onSubmitEditing={() => panRef.current?.focus()}
                  blurOnSubmit={false}
                />
                {errors.gstin && (
                  <Text style={styles.errorText}>{errors.gstin}</Text>
                )}
                <TouchableOpacity
                  style={[styles.linkButton, (!GSTIN_REGEX.test(gstin) || lookup.isPending) && styles.saveButtonDisabled]}
                  onPress={() => lookup.mutate({ gstin })}
                  disabled={!GSTIN_REGEX.test(gstin) || lookup.isPending}
                  accessibilityRole="button"
                >
                  {lookup.isPending
                    ? <ActivityIndicator size="small" color={colors.brand} />
                    : <Text style={styles.linkButtonText}>Fetch details from GST</Text>}
                </TouchableOpacity>
                {gstinStatus && (
                  <Text style={[styles.hint, { color: gstinStatus === "active" ? colors.success : colors.danger }]}>
                    GSTIN status: {gstinStatus}
                  </Text>
                )}
              </View>

              <View style={styles.fieldDivider} />

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>PAN</Text>
                <TextInput
                  ref={panRef}
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
                  returnKeyType="next"
                  onSubmitEditing={() => addressRef.current?.focus()}
                  blurOnSubmit={false}
                />
                {errors.pan && (
                  <Text style={styles.errorText}>{errors.pan}</Text>
                )}
              </View>

              <View style={styles.fieldDivider} />
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Legal Name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="As registered for GST"
                  placeholderTextColor={colors.textMuted}
                  value={legalName}
                  onChangeText={setLegalName}
                />
              </View>
              <View style={styles.fieldDivider} />
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Trade Name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Name they do business under"
                  placeholderTextColor={colors.textMuted}
                  value={tradeName}
                  onChangeText={setTradeName}
                />
              </View>
              <View style={styles.fieldDivider} />
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>GST Type</Text>
                <Chips options={partyGstTypes} value={gstType} onChange={setGstType} labelFor={(t) => partyGstTypeLabels[t]} />
              </View>
              <View style={styles.fieldDivider} />
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Business Type</Text>
                <Chips options={partyConstitutions} value={constitution} onChange={setConstitution} labelFor={(c) => partyConstitutionLabels[c]} />
              </View>
            </View>
          </View>

          {warnings.length > 0 && (
            <View style={styles.section}>
              <View style={styles.warningBox} accessibilityRole="alert">
                {warnings.map((w) => (
                  <Text key={w} style={styles.warningText}>• {w}</Text>
                ))}
              </View>
            </View>
          )}

          {/* MSME */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>MSME (Udyam)</Text>
            <View style={styles.card}>
              <TouchableOpacity
                style={[styles.fieldGroup, styles.toggleRow]}
                onPress={() => setIsMsme((v) => !v)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isMsme }}
              >
                <Ionicons name={isMsme ? "checkbox" : "square-outline"} size={20} color={isMsme ? colors.brand : colors.textMuted} />
                <Text style={styles.toggleText}>Registered MSME (Udyam)</Text>
              </TouchableOpacity>
              {isMsme && (
                <>
                  <View style={styles.fieldDivider} />
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Udyam Number</Text>
                    <TextInput
                      style={[styles.input, errors.udyamNumber && styles.inputError]}
                      placeholder="UDYAM-MH-26-0012345"
                      placeholderTextColor={colors.textMuted}
                      value={udyamNumber}
                      onChangeText={(t) => setUdyamNumber(t.toUpperCase())}
                      autoCapitalize="characters"
                      autoCorrect={false}
                    />
                    {errors.udyamNumber && <Text style={styles.errorText}>{errors.udyamNumber}</Text>}
                  </View>
                  <View style={styles.fieldDivider} />
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Category</Text>
                    <Chips options={msmeCategories} value={msmeCategory} onChange={setMsmeCategory} labelFor={(c) => c[0]!.toUpperCase() + c.slice(1)} />
                    {msmeCategory !== "medium" && (
                      <Text style={styles.hint}>Pay within 45 days (15 without a written credit period) — Section 43B(h).</Text>
                    )}
                  </View>
                </>
              )}
            </View>
          </View>

          {/* TDS */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>TDS</Text>
            <View style={styles.card}>
              <View style={styles.fieldGroup}>
                <Chips
                  options={tdsSections.map((t) => t.code)}
                  value={tdsSection}
                  onChange={setTdsSection}
                  labelFor={(code) => tdsSections.find((t) => t.code === code)?.label ?? code}
                />
                {tdsRate && (
                  <Text style={styles.hint}>
                    Rate: {tdsRate}%{!pan && !panFromGstin(gstin) ? " (no PAN)" : ""}
                  </Text>
                )}
              </View>
            </View>
          </View>

          {/* Bank */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Bank</Text>
            <View style={styles.card}>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>IFSC</Text>
                <TextInput
                  style={[styles.input, errors.bankIfsc && styles.inputError]}
                  placeholder="HDFC0001234"
                  placeholderTextColor={colors.textMuted}
                  value={bankIfsc}
                  onChangeText={(t) => setBankIfsc(t.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11))}
                  autoCapitalize="characters"
                  autoCorrect={false}
                />
                {errors.bankIfsc && <Text style={styles.errorText}>{errors.bankIfsc}</Text>}
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
                  ref={addressRef}
                  style={[styles.input, styles.textArea]}
                  placeholder="Street address"
                  placeholderTextColor={colors.textMuted}
                  value={billingAddress}
                  onChangeText={setBillingAddress}
                  multiline
                  numberOfLines={3}
                  blurOnSubmit={true}
                  returnKeyType="next"
                  onSubmitEditing={() => cityRef.current?.focus()}
                />
              </View>

              <View style={styles.fieldDivider} />

              <View style={styles.fieldRow}>
                <View style={[styles.fieldGroup, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>City</Text>
                  <TextInput
                    ref={cityRef}
                    style={styles.input}
                    placeholder="City"
                    placeholderTextColor={colors.textMuted}
                    value={city}
                    onChangeText={setCity}
                    autoCapitalize="words"
                    returnKeyType="next"
                    onSubmitEditing={() => stateRef.current?.focus()}
                    blurOnSubmit={false}
                  />
                </View>
                <View style={styles.fieldRowDivider} />
                <View style={[styles.fieldGroup, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>State</Text>
                  <TextInput
                    ref={stateRef}
                    style={styles.input}
                    placeholder="State"
                    placeholderTextColor={colors.textMuted}
                    value={state}
                    onChangeText={setState}
                    autoCapitalize="words"
                    returnKeyType="done"
                    onSubmitEditing={handleSubmit}
                  />
                </View>
              </View>
            </View>
          </View>

          {/* Extra shipping addresses */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Shipping Addresses</Text>
            {shipping.map((draft, index) => {
              const update = (patch: Partial<ShippingDraft>) =>
                setShipping((list) => list.map((d, i) => (i === index ? { ...d, ...patch } : d)));
              return (
                <View key={index} style={[styles.card, { marginBottom: 12 }]}>
                  <View style={[styles.fieldGroup, styles.toggleRow]}>
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      placeholder={`Label (e.g. Warehouse ${index + 1})`}
                      placeholderTextColor={colors.textMuted}
                      value={draft.label}
                      onChangeText={(t) => update({ label: t })}
                    />
                    <TouchableOpacity
                      onPress={() => setShipping((list) => list.filter((_, i) => i !== index))}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove shipping address ${index + 1}`}
                    >
                      <Ionicons name="trash-outline" size={18} color={colors.danger} />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.fieldDivider} />
                  <View style={styles.fieldGroup}>
                    <TextInput
                      style={[styles.input, styles.textArea]}
                      placeholder="Address"
                      placeholderTextColor={colors.textMuted}
                      value={draft.address}
                      onChangeText={(t) => update({ address: t })}
                      multiline
                    />
                  </View>
                  <View style={styles.fieldDivider} />
                  <View style={styles.fieldRow}>
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      placeholder="City"
                      placeholderTextColor={colors.textMuted}
                      value={draft.city}
                      onChangeText={(t) => update({ city: t })}
                    />
                    <View style={styles.fieldRowDivider} />
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      placeholder="State"
                      placeholderTextColor={colors.textMuted}
                      value={draft.state}
                      onChangeText={(t) => update({ state: t })}
                    />
                    <View style={styles.fieldRowDivider} />
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      placeholder="Pincode"
                      placeholderTextColor={colors.textMuted}
                      value={draft.pincode}
                      onChangeText={(t) => update({ pincode: t.replace(/\D/g, "").slice(0, 6) })}
                      keyboardType="number-pad"
                    />
                  </View>
                </View>
              );
            })}
            <TouchableOpacity
              style={styles.addButton}
              onPress={() => setShipping((list) => [...list, { label: "", address: "", city: "", state: "", pincode: "" }])}
              disabled={shipping.length >= 20}
              accessibilityRole="button"
            >
              <Ionicons name="add" size={18} color={colors.brand} />
              <Text style={styles.linkButtonText}>Add shipping address</Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
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
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  chipText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: colors.onBrand,
    fontWeight: "600",
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
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  toggleText: {
    fontSize: 15,
    color: colors.textPrimary,
  },
  warningBox: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.warning,
    padding: 12,
    gap: 4,
  },
  warningText: {
    fontSize: 13,
    color: colors.textPrimary,
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
  },
}));
