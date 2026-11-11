import type { PluginTheme } from "@getpaseo/plugin";
import { Modal, Pressable, Text, View } from "react-native";
import { Button, type Styles } from "./styles";

/** A headerless alert dialog, like shadcn's AlertDialog: title, description, actions. */
export function ConfirmDialog({
  open,
  title,
  description,
  detail,
  confirmLabel,
  onConfirm,
  onCancel,
  theme,
  styles,
}: {
  open: boolean;
  title: string;
  description: string;
  detail?: string;
  confirmLabel: string;
  onConfirm(): void;
  onCancel(): void;
  theme: PluginTheme;
  styles: Styles;
}) {
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.dialogBackdrop}>
        <Pressable accessibilityLabel="Cancel" onPress={onCancel} style={styles.dialogDismiss} />
        <View accessibilityRole="alert" style={styles.dialog}>
          <Text style={styles.dialogTitle}>{title}</Text>
          <Text style={styles.dialogDescription}>{description}</Text>
          {detail ? <Text style={styles.dialogDescription}>{detail}</Text> : null}
          <View style={styles.dialogActions}>
            <Button label="Cancel" onPress={onCancel} styles={styles} theme={theme} />
            <Button label={confirmLabel} tone="danger" onPress={onConfirm} styles={styles} theme={theme} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
