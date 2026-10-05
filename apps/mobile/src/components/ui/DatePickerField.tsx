import { useState } from "react";
import { View, Text, TouchableOpacity, Platform } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles } from "../../lib/makeStyles";
import { useColors } from "../../contexts/ThemeContext";
import { formatDate } from "../../lib/utils";

interface Props {
  label: string;
  /** null shows `placeholder` (an optional date that is not set). */
  value: Date | null;
  onChange: (date: Date) => void;
  placeholder?: string;
  /** When given, a set date shows a clear button. */
  onClear?: () => void;
  testID?: string;
  minimumDate?: Date;
  maximumDate?: Date;
}

export function DatePickerField({ label, value, onChange, placeholder = "Not set", onClear, testID, minimumDate, maximumDate }: Props) {
  const [show, setShow] = useState(false);
  const s = useS();
  const colors = useColors();

  const formatted = value ? formatDate(value) : placeholder;

  return (
    <View>
      <Text style={s.label}>{label}</Text>
      <View style={s.fieldRow}>
        <TouchableOpacity
          style={[s.field, s.fieldGrow]}
          onPress={() => setShow(true)}
          activeOpacity={0.7}
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${formatted}`}
        >
          <Text style={value ? s.value : s.placeholder} numberOfLines={1}>{formatted}</Text>
          <Ionicons name="calendar-outline" size={18} color={colors.textMuted} />
        </TouchableOpacity>
        {value && onClear ? (
          <TouchableOpacity onPress={onClear} accessibilityRole="button" accessibilityLabel={`Clear ${label}`} style={s.clearBtn}>
            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {show && (
        <DateTimePicker
          value={value ?? new Date()}
          mode="date"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={(_event, selectedDate) => {
            setShow(Platform.OS === "ios"); // iOS keeps open, Android closes on pick
            if (selectedDate) onChange(selectedDate);
          }}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          themeVariant="dark"
        />
      )}
    </View>
  );
}

const useS = makeStyles((colors) => ({
  label: { fontSize: 12, fontWeight: "600", color: colors.textSecondary, marginBottom: 6 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  value: { fontSize: 14, color: colors.textPrimary, fontWeight: "500" },
  placeholder: { fontSize: 14, color: colors.textMuted },
  fieldRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  fieldGrow: { flex: 1 },
  clearBtn: { padding: 2 },
}));
