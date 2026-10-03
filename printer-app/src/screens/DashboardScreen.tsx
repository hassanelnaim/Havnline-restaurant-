import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, RefreshControl, StyleSheet, ActivityIndicator, TouchableOpacity } from "react-native";
import { fetchDashboard, fetchDaySummary, DashboardDay } from "../lib/api";
import { getPrinterIp } from "../lib/storage";
import { printTicket } from "../lib/printer";
import { DaySummaryCard, buildDaySummaryTicket } from "../components/DaySummaryCard";
import { CalendarPicker } from "../components/CalendarPicker";

interface Props {
  deviceToken: string;
  businessName: string;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * dateKey is a plain "YYYY-MM-DD" calendar date in the BUSINESS's
 * timezone, not an instant — parsed and read back using UTC getters
 * (not local ones) so the label never shifts by a day depending on
 * what timezone this tablet itself happens to be in.
 */
function formatDayLabel(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * Dashboard — Phase 7 of the tablet redesign, reworked: Today and
 * Yesterday are always their own clearly separated sections (not two
 * cards buried in a longer scrolling list), with a calendar below for
 * any other day instead of scrolling further back through history.
 * Each section can print its own summary straight to the paired
 * kitchen printer.
 */
export function DashboardScreen({ deviceToken, businessName }: Props) {
  const [today, setToday] = useState<DashboardDay | null>(null);
  const [yesterday, setYesterday] = useState<DashboardDay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);

  const [showCalendar, setShowCalendar] = useState(false);
  const [otherDateKey, setOtherDateKey] = useState<string | null>(null);
  const [otherDay, setOtherDay] = useState<DashboardDay | null>(null);
  const [otherLoading, setOtherLoading] = useState(false);
  const [otherError, setOtherError] = useState<string | null>(null);

  const [printingKey, setPrintingKey] = useState<string | null>(null);
  const [printMessage, setPrintMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    const result = await fetchDashboard(deviceToken);
    if (!mountedRef.current) return;
    if (result.success && result.days && result.days.length >= 2) {
      setToday(result.days[0]);
      setYesterday(result.days[1]);
      setError(null);
    } else {
      setError(result.error || "Couldn't reach HavnLine.");
    }
    setRefreshing(false);
  }, [deviceToken]);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  function pickOtherDate(dateKey: string) {
    setOtherDateKey(dateKey);
    setOtherError(null);
    setOtherLoading(true);
    fetchDaySummary(deviceToken, dateKey).then((result) => {
      if (!mountedRef.current) return;
      setOtherLoading(false);
      if (result.success && result.summary) {
        setOtherDay(result.summary);
      } else {
        setOtherError(result.error || "Could not load that day.");
        setOtherDay(null);
      }
    });
  }

  async function handlePrint(label: string, day: DashboardDay) {
    setPrintMessage(null);
    const printerIp = await getPrinterIp();
    if (!printerIp) {
      setPrintMessage("Pair a kitchen printer in the Home tab first.");
      return;
    }
    setPrintingKey(day.dateKey);
    try {
      await printTicket(printerIp, buildDaySummaryTicket(businessName, label, day));
      setPrintMessage(`${label} summary sent to the printer.`);
    } catch (err) {
      setPrintMessage(err instanceof Error ? `Print failed: ${err.message}` : "Print failed.");
    } finally {
      setPrintingKey(null);
    }
  }

  const todayKey = today?.dateKey;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor="#60A5FA" />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Dashboard</Text>
        <Text style={styles.subtitle}>Today and yesterday — pick any other day below.</Text>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}
      {printMessage && <Text style={styles.printMessage}>{printMessage}</Text>}

      {today === null || yesterday === null ? (
        <ActivityIndicator color="#2563EB" style={{ marginTop: 40 }} />
      ) : (
        <View style={styles.cardsWrap}>
          <DaySummaryCard label="Today" day={today} isToday onPrint={() => handlePrint("Today", today)} printing={printingKey === today.dateKey} />
          <DaySummaryCard label="Yesterday" day={yesterday} onPrint={() => handlePrint("Yesterday", yesterday)} printing={printingKey === yesterday.dateKey} />

          <TouchableOpacity style={styles.calendarToggle} onPress={() => setShowCalendar((v) => !v)}>
            <Text style={styles.calendarToggleText}>{showCalendar ? "Hide calendar" : "Look up another day"}</Text>
          </TouchableOpacity>

          {showCalendar && todayKey && (
            <View style={styles.calendarWrap}>
              <CalendarPicker maxDateKey={todayKey} selectedDateKey={otherDateKey} onSelect={pickOtherDate} />
            </View>
          )}

          {otherDateKey && (
            <View style={styles.otherSection}>
              {otherLoading && <ActivityIndicator color="#2563EB" style={{ marginTop: 10 }} />}
              {otherError && <Text style={styles.error}>{otherError}</Text>}
              {otherDay && !otherLoading && (
                <DaySummaryCard
                  label={formatDayLabel(otherDay.dateKey)}
                  day={otherDay}
                  onPrint={() => handlePrint(formatDayLabel(otherDay.dateKey), otherDay)}
                  printing={printingKey === otherDay.dateKey}
                />
              )}
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0B1220" },
  header: { marginBottom: 16, marginTop: 8, paddingHorizontal: 20, paddingTop: 20 },
  title: { fontSize: 22, fontWeight: "700", color: "#fff" },
  subtitle: { fontSize: 13, color: "#B8C0D0", marginTop: 2 },
  error: { color: "#F87171", fontSize: 12.5, marginBottom: 10, marginHorizontal: 20 },
  printMessage: { color: "#60A5FA", fontSize: 12.5, marginBottom: 10, marginHorizontal: 20 },
  cardsWrap: { paddingHorizontal: 20 },
  calendarToggle: { marginTop: 4, marginBottom: 14, alignSelf: "flex-start" },
  calendarToggleText: { color: "#60A5FA", fontSize: 13.5, fontWeight: "600" },
  calendarWrap: { marginBottom: 16 },
  otherSection: {},
});
