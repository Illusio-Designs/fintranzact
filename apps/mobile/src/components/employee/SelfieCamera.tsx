import { useRef, useState } from "react";
import { ActivityIndicator, Modal, Text, TouchableOpacity, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImageManipulator from "expo-image-manipulator";
import { makeStyles } from "../../lib/makeStyles";

interface Props {
  visible: boolean;
  /** A JPEG data URL (about 640 px wide), or null when the person cancels. */
  onDone: (dataUrl: string | null) => void;
}

/** The front camera for one selfie, shown only while checking in or out. The photo is resized before it leaves the phone. */
export function SelfieCamera({ visible, onDone }: Props) {
  const styles = useStyles();
  const ref = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);

  async function shoot() {
    if (!ref.current || busy) return;
    setBusy(true);
    try {
      const shot = await ref.current.takePictureAsync({ quality: 0.5, skipProcessing: true });
      const small = await ImageManipulator.manipulateAsync(shot.uri, [{ resize: { width: 640 } }], { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      onDone(small.base64 ? `data:image/jpeg;base64,${small.base64}` : null);
    } catch {
      onDone(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => onDone(null)}>
      <View style={styles.container}>
        {!permission?.granted ? (
          <View style={styles.center}>
            <Text style={styles.title}>Camera access</Text>
            <Text style={styles.body}>The camera is used only to take one selfie when you check in or out.</Text>
            <TouchableOpacity style={styles.primary} onPress={() => void requestPermission()} accessibilityRole="button" accessibilityLabel="Allow camera">
              <Text style={styles.primaryText}>Allow camera</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <CameraView ref={ref} style={styles.camera} facing="front" />
        )}
        <View style={styles.bar}>
          <TouchableOpacity style={styles.secondary} onPress={() => onDone(null)} accessibilityRole="button" accessibilityLabel="Cancel">
            <Text style={styles.secondaryText}>Cancel</Text>
          </TouchableOpacity>
          {permission?.granted && (
            <TouchableOpacity style={styles.primary} onPress={() => void shoot()} disabled={busy} accessibilityRole="button" accessibilityLabel="Take photo">
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Take photo</Text>}
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  camera: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  title: { fontSize: 20, fontWeight: "700", color: colors.textPrimary },
  body: { fontSize: 14, color: colors.textMuted, textAlign: "center", lineHeight: 20 },
  bar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, gap: 12 },
  primary: { backgroundColor: colors.brand, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 14, minWidth: 140, alignItems: "center" },
  primaryText: { color: colors.onBrand, fontWeight: "700", fontSize: 15 },
  secondary: { paddingHorizontal: 20, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  secondaryText: { color: colors.textPrimary, fontWeight: "600", fontSize: 15 },
}));
