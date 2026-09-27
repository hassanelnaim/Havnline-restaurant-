import { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert } from "react-native";
import { useKeepAwake } from "expo-keep-awake";
import { reportPrinterIp } from "../lib/api";
import { getPrinterIp, setPrinterIp as savePrinterIp, clearPairing } from "../lib/storage";
import { createPoller, PollLogEntry, Poller } from "../lib/poller";
import { printTicket } from "../lib/printer";

interface Props {
  deviceToken: string;
  businessName: string | null;
  onUnpaired: () => void;
}

export function HomeScreen({ deviceToken, businessName, onUnpaired }: Props) {
  // A kitchen tablet that falls asleep is a tablet that stops
  // printing orders — this is the one screen where that actually
  // matters, so the whole point of the app depends on it staying awake.
  useKeepAwake();

  const [printerIp, setPrinterIpState] = useState("");
  const [savingIp, setSavingIp] = useState(false);
  const [testingPrint, setTestingPrint] = useState(false);
  const [ipMessage, setIpMessage] = useState<string | null>(null);
  const [log, setLog] = useState<PollLogEntry[]>([]);
  const printerIpRef = useRef<string | null>(null);
  const pollerRef = useRef<Poller | null>(null);

  useEffect(() => {
    getPrinterIp().then((ip) => {
      if (ip) {
        setPrinterIpState(ip);
        printerIpRef.current = ip;
      }
    });
  }, []);

  useEffect(() => {
    pollerRef.current = createPoller({
      deviceToken,
      getPrinterIp: () => printerIpRef.current,
      onLog: (entry) => setLog((prev) => [entry, ...prev].slice(0, 30)),
    });
    return () => pollerRef.current?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceToken]);

  async function handleSavePrinterIp() {
    const trimmed = printerIp.trim();
    if (!trimmed) {
      setIpMessage("Enter the printer's IP address first.");
      return;
    }
    setSavingIp(true);
    setIpMessage(null);
    try {
      await savePrinterIp(trimmed);
      printerIpRef.current = trimmed;
      const result = await reportPrinterIp(deviceToken, trimmed);
      setIpMessage(result.success ? "Saved." : result.error || "Saved locally, but HavnLine couldn't be reached.");
    } finally {
      setSavingIp(false);
    }
  }

  async function handleTestPrint() {
    if (!printerIpRef.current) {
      setIpMessage("Save the printer's IP address first.");
      return;
    }
    setTestingPrint(true);
    try {
      await printTicket(printerIpRef.current, "HAVNLINE TEST PRINT\n\nIf you can read this,\nyour printer is set up correctly.");
      setIpMessage("Test ticket sent.");
    } catch (err) {
      setIpMessage(err instanceof Error ? `Test print failed: ${err.message}` : "Test print failed.");
    } finally {
      setTestingPrint(false);
    }
  }

  function handleUnpair() {
    Alert.alert("Unpair this tablet?", "You'll need a new pairing code from the dashboard to reconnect.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Unpair",
        style: "destructive",
        onPress: async () => {
          pollerRef.current?.stop();
          await clearPairing();
          onUnpaired();
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>HavnLine Printer</Text>
        <Text style={styles.subtitle}>{businessName ? `Paired with ${businessName}` : "Paired"}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Kitchen printer IP address</Text>
        <View style={styles.row}>
          <TextInput
            style={styles.input}
            value={printerIp}
            onChangeText={setPrinterIpState}
            placeholder="e.g. 192.168.1.50"
            placeholderTextColor="#9AA3B2"
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity style={styles.smallButton} onPress={handleSavePrinterIp} disabled={savingIp}>
            <Text style={styles.smallButtonText}>{savingIp ? "Saving…" : "Save"}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.testButton} onPress={handleTestPrint} disabled={testingPrint}>
          <Text style={styles.testButtonText}>{testingPrint ? "Printing…" : "Send test print"}</Text>
        </TouchableOpacity>
        {ipMessage && <Text style={styles.message}>{ipMessage}</Text>}
      </View>

      <Text style={styles.logHeading}>Recent activity</Text>
      <ScrollView style={styles.log}>
        {log.length === 0 ? (
          <Text style={styles.logEmpty}>Waiting for orders…</Text>
        ) : (
          log.map((entry, i) => (
            <View key={`${entry.id}-${i}`} style={styles.logRow}>
              <Text style={[styles.logDot, { color: entry.ok ? "#22C55E" : "#F87171" }]}>●</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.logMessage}>{entry.message}</Text>
                <Text style={styles.logTime}>{new Date(entry.at).toLocaleTimeString()}</Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <TouchableOpacity style={styles.unpairButton} onPress={handleUnpair}>
        <Text style={styles.unpairText}>Unpair this tablet</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0B1220", padding: 20 },
  header: { marginBottom: 20, marginTop: 8 },
  title: { fontSize: 22, fontWeight: "700", color: "#fff" },
  subtitle: { fontSize: 13, color: "#B8C0D0", marginTop: 2 },
  card: { backgroundColor: "#131C30", borderRadius: 14, padding: 16, borderWidth: 1, borderColor: "#25324A" },
  cardLabel: { color: "#B8C0D0", fontSize: 13, fontWeight: "600", marginBottom: 8 },
  row: { flexDirection: "row", gap: 8 },
  input: { flex: 1, backgroundColor: "#0B1220", borderWidth: 1, borderColor: "#25324A", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: "#fff", fontSize: 15 },
  smallButton: { backgroundColor: "#2563EB", borderRadius: 8, paddingHorizontal: 16, justifyContent: "center" },
  smallButtonText: { color: "#fff", fontWeight: "600" },
  testButton: { marginTop: 10, alignSelf: "flex-start" },
  testButtonText: { color: "#60A5FA", fontSize: 13, fontWeight: "600" },
  message: { marginTop: 10, color: "#B8C0D0", fontSize: 12.5 },
  logHeading: { color: "#B8C0D0", fontSize: 13, fontWeight: "600", marginTop: 20, marginBottom: 8 },
  log: { flex: 1 },
  logEmpty: { color: "#5B6472", fontSize: 13, paddingVertical: 12 },
  logRow: { flexDirection: "row", gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#131C30" },
  logDot: { fontSize: 10, marginTop: 4 },
  logMessage: { color: "#fff", fontSize: 13.5 },
  logTime: { color: "#5B6472", fontSize: 11, marginTop: 2 },
  unpairButton: { marginTop: 12, alignItems: "center", paddingVertical: 10 },
  unpairText: { color: "#F87171", fontSize: 13 },
});
