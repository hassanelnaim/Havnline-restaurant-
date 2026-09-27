import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";
import { pairWithCode } from "../lib/api";
import { setDeviceToken } from "../lib/storage";

/**
 * The very first thing anyone sees on a fresh install: enter the 6-digit
 * code shown on the restaurant's HavnLine Integrations dashboard. On
 * success this is the only screen this tablet ever needs to show
 * again — see App.tsx.
 */
export function PairingScreen({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePair() {
    if (code.trim().length < 4) {
      setError("Enter the code shown on your HavnLine dashboard.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await pairWithCode(code.trim());
      if (!result.success || !result.deviceToken) {
        setError(result.error || "That code didn't work.");
        return;
      }
      await setDeviceToken(result.deviceToken, result.businessName);
      onPaired();
    } catch {
      setError("Couldn't reach HavnLine — check the tablet's Wi-Fi connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Text style={styles.title}>HavnLine Printer</Text>
      <Text style={styles.subtitle}>
        On your computer, go to Integrations → Kitchen printer app → Get pairing code, then type it in below.
      </Text>

      <TextInput
        style={styles.input}
        value={code}
        onChangeText={(text) => setCode(text.replace(/\D/g, "").slice(0, 6))}
        placeholder="000000"
        placeholderTextColor="#9AA3B2"
        keyboardType="number-pad"
        maxLength={6}
        autoFocus
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity style={[styles.button, submitting && styles.buttonDisabled]} onPress={handlePair} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Pair this tablet</Text>}
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0B1220", alignItems: "center", justifyContent: "center", padding: 24 },
  title: { fontSize: 28, fontWeight: "700", color: "#fff", marginBottom: 12 },
  subtitle: { fontSize: 14, color: "#B8C0D0", textAlign: "center", marginBottom: 32, maxWidth: 380, lineHeight: 20 },
  input: {
    width: 220,
    borderWidth: 2,
    borderColor: "#25324A",
    backgroundColor: "#131C30",
    borderRadius: 12,
    paddingVertical: 14,
    fontSize: 32,
    fontWeight: "700",
    letterSpacing: 8,
    textAlign: "center",
    color: "#fff",
    marginBottom: 20,
  },
  error: { color: "#F87171", marginBottom: 16, textAlign: "center", maxWidth: 320 },
  button: { backgroundColor: "#2563EB", paddingVertical: 14, paddingHorizontal: 32, borderRadius: 10, minWidth: 200, alignItems: "center" },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
