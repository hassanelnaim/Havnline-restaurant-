import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useKeepAwake } from "expo-keep-awake";
import { getDeviceToken, getBusinessName } from "./src/lib/storage";
import { PairingScreen } from "./src/screens/PairingScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { OrdersScreen } from "./src/screens/OrdersScreen";
import { DashboardScreen } from "./src/screens/DashboardScreen";

type Session = { deviceToken: string; businessName: string | null } | null;
type Tab = "orders" | "dashboard" | "setup";

export default function App() {
  // undefined = still checking storage, null = not paired yet
  const [session, setSession] = useState<Session | undefined>(undefined);

  useEffect(() => {
    (async () => {
      const [deviceToken, businessName] = await Promise.all([getDeviceToken(), getBusinessName()]);
      setSession(deviceToken ? { deviceToken, businessName } : null);
    })();
  }, []);

  // SafeAreaProvider once, at the root, wrapping every state below — a
  // tablet mounted flush in a kitchen doesn't need this, but testing on
  // a phone (or any Android device drawing its own gesture/nav bar over
  // the app, which newer Android versions do by default) does: without
  // it, bottom-anchored buttons like the tab bar below sit right under
  // the system's back/home/recents area and steal its taps.
  return (
    <SafeAreaProvider>
      {session === undefined ? (
        <View style={styles.loading}>
          <ActivityIndicator color="#2563EB" size="large" />
          <StatusBar style="light" />
        </View>
      ) : !session ? (
        <>
          <PairingScreen onPaired={() => { getDeviceToken().then((deviceToken) => getBusinessName().then((businessName) => setSession(deviceToken ? { deviceToken, businessName } : null))); }} />
          <StatusBar style="light" />
        </>
      ) : (
        <>
          <PairedShell deviceToken={session.deviceToken} businessName={session.businessName} onUnpaired={() => setSession(null)} />
          <StatusBar style="light" />
        </>
      )}
    </SafeAreaProvider>
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

  // edges={["bottom"]} only — the top is already fine (a tablet/phone's
  // status bar doesn't overlap anything here), this is specifically
  // about lifting the tab bar above the device's own gesture/nav area
  // so "Orders"/"Setup" aren't fighting the system's back/home taps.
  return (
    <SafeAreaView style={styles.shell} edges={["bottom"]}>
      <View style={styles.tabContent}>
        {tab === "orders" ? (
          <OrdersScreen deviceToken={deviceToken} />
        ) : tab === "dashboard" ? (
          <DashboardScreen deviceToken={deviceToken} />
        ) : (
          <HomeScreen deviceToken={deviceToken} businessName={businessName} onUnpaired={onUnpaired} />
        )}
      </View>
      <View style={styles.tabBar}>
        <TouchableOpacity style={styles.tabButton} onPress={() => setTab("orders")}>
          <Text style={[styles.tabLabel, tab === "orders" && styles.tabLabelActive]}>Orders</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tabButton} onPress={() => setTab("dashboard")}>
          <Text style={[styles.tabLabel, tab === "dashboard" && styles.tabLabelActive]}>Dashboard</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tabButton} onPress={() => setTab("setup")}>
          <Text style={[styles.tabLabel, tab === "setup" && styles.tabLabelActive]}>Setup</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
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
