import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useKeepAwake } from "expo-keep-awake";
import { getDeviceToken, getBusinessName } from "./src/lib/storage";
import { PairingScreen } from "./src/screens/PairingScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { OrdersScreen } from "./src/screens/OrdersScreen";

type Session = { deviceToken: string; businessName: string | null } | null;
type Tab = "orders" | "setup";

export default function App() {
  // undefined = still checking storage, null = not paired yet
  const [session, setSession] = useState<Session | undefined>(undefined);

  useEffect(() => {
    (async () => {
      const [deviceToken, businessName] = await Promise.all([getDeviceToken(), getBusinessName()]);
      setSession(deviceToken ? { deviceToken, businessName } : null);
    })();
  }, []);

  if (session === undefined) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#2563EB" size="large" />
        <StatusBar style="light" />
      </View>
    );
  }

  if (!session) {
    return (
      <>
        <PairingScreen onPaired={() => { getDeviceToken().then((deviceToken) => getBusinessName().then((businessName) => setSession(deviceToken ? { deviceToken, businessName } : null))); }} />
        <StatusBar style="light" />
      </>
    );
  }

  return (
    <>
      <PairedShell deviceToken={session.deviceToken} businessName={session.businessName} onUnpaired={() => setSession(null)} />
      <StatusBar style="light" />
    </>
  );
}

/**
 * Everything shown once this tablet is paired: a simple two-tab shell
 * (no navigation library pulled in for just two screens) switching
 * between Today's Orders (the default — see the tablet-redesign
 * planning discussion for why orders, not settings, should be what
 * staff see first) and Setup (the original printer-IP/pairing screen).
 * useKeepAwake lives here, once, rather than inside either screen —
 * the whole point is the tablet never sleeping for as long as it's
 * paired, not just while one particular tab is open.
 */
function PairedShell({ deviceToken, businessName, onUnpaired }: { deviceToken: string; businessName: string | null; onUnpaired: () => void }) {
  useKeepAwake();
  const [tab, setTab] = useState<Tab>("orders");

  return (
    <View style={styles.shell}>
      <View style={styles.tabContent}>
        {tab === "orders" ? (
          <OrdersScreen deviceToken={deviceToken} />
        ) : (
          <HomeScreen deviceToken={deviceToken} businessName={businessName} onUnpaired={onUnpaired} />
        )}
      </View>
      <View style={styles.tabBar}>
        <TouchableOpacity style={styles.tabButton} onPress={() => setTab("orders")}>
          <Text style={[styles.tabLabel, tab === "orders" && styles.tabLabelActive]}>Orders</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tabButton} onPress={() => setTab("setup")}>
          <Text style={[styles.tabLabel, tab === "setup" && styles.tabLabelActive]}>Setup</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: "#0B1220", alignItems: "center", justifyContent: "center" },
  shell: { flex: 1, backgroundColor: "#0B1220" },
  tabContent: { flex: 1 },
  tabBar: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#25324A", backgroundColor: "#0B1220" },
  tabButton: { flex: 1, paddingVertical: 14, alignItems: "center" },
  tabLabel: { color: "#5B6472", fontSize: 13, fontWeight: "600" },
  tabLabelActive: { color: "#60A5FA" },
});
