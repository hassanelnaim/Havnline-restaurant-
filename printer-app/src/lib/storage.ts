import AsyncStorage from "@react-native-async-storage/async-storage";

// Everything this app needs to remember across restarts: the
// device_token it got back from pairing (its whole identity — see
// lib/integrations/printer-app.ts on the backend) and the kitchen
// printer's IP, kept locally too so the app can show it in Settings
// without an extra round trip.
const KEYS = {
  deviceToken: "havnline_device_token",
  businessName: "havnline_business_name",
  printerIp: "havnline_printer_ip",
} as const;

export async function getDeviceToken(): Promise<string | null> {
  return AsyncStorage.getItem(KEYS.deviceToken);
}

export async function setDeviceToken(token: string, businessName?: string): Promise<void> {
  await AsyncStorage.setItem(KEYS.deviceToken, token);
  if (businessName) await AsyncStorage.setItem(KEYS.businessName, businessName);
}

export async function getBusinessName(): Promise<string | null> {
  return AsyncStorage.getItem(KEYS.businessName);
}

export async function getPrinterIp(): Promise<string | null> {
  return AsyncStorage.getItem(KEYS.printerIp);
}

export async function setPrinterIp(ip: string): Promise<void> {
  await AsyncStorage.setItem(KEYS.printerIp, ip);
}

/** Clears everything — used by "Unpair this tablet" in Settings. */
export async function clearPairing(): Promise<void> {
  await AsyncStorage.removeMany([KEYS.deviceToken, KEYS.businessName, KEYS.printerIp]);
}
