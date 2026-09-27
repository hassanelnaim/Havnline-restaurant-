import { useEffect, useState } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { getDeviceToken, getBusinessName } from "./src/lib/storage";
import { PairingScreen } from "./src/screens/PairingScreen";
import { HomeScreen } from "./src/screens/HomeScreen";

type Session = { deviceToken: string; businessName: string | null } | null;

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
      <HomeScreen deviceToken={session.deviceToken} businessName={session.businessName} onUnpaired={() => setSession(null)} />
      <StatusBar style="light" />
    </>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: "#0B1220", alignItems: "center", justifyContent: "center" },
});
